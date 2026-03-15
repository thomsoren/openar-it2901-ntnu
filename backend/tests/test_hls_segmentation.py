"""Tests for HLS segmentation pipeline — backend.

Covers:
  1. DB model: MediaAsset has hls_s3_prefix and hls_status columns
  2. HLS key derivation: _hls_prefix_for() builds correct S3 prefix
  3. segment_to_hls(): calls FFmpeg correctly, uploads segments to S3
  4. Presigned HLS playlist rewrite: .ts paths → presigned URLs
  5. build_stream_playback_payload() includes hls_s3_url when HLS ready
"""

from __future__ import annotations

import textwrap
from pathlib import Path, PurePosixPath
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base
from db.models import MediaAsset


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite://",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    TestSession = sessionmaker(bind=db_engine, autocommit=False, autoflush=False, class_=Session)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


# ── 1. DB model columns ────────────────────────────────────────────────────


class TestMediaAssetHlsColumns:
    def test_hls_s3_prefix_exists(self, db_session: Session):
        asset = MediaAsset(
            id="test-1",
            s3_key="videos/private/g1/u1/s1/video.mp4",
            hls_s3_prefix="videos/private/g1/u1/s1/video_hls/",
            hls_status="complete",
        )
        db_session.add(asset)
        db_session.commit()
        db_session.refresh(asset)
        assert asset.hls_s3_prefix == "videos/private/g1/u1/s1/video_hls/"
        assert asset.hls_status == "complete"

    def test_hls_columns_default_to_none(self, db_session: Session):
        asset = MediaAsset(id="test-2", s3_key="videos/private/g1/u1/s1/other.mp4")
        db_session.add(asset)
        db_session.commit()
        db_session.refresh(asset)
        assert asset.hls_s3_prefix is None
        assert asset.hls_status is None


# ── 2. HLS key derivation ──────────────────────────────────────────────────


class TestHlsKeyDerivation:
    def test_hls_prefix_from_original_key(self):
        from services.transcode_service import _hls_prefix_for

        result = _hls_prefix_for("videos/private/g1/u1/s1/clip-abc123.mp4")
        assert result == "videos/private/g1/u1/s1/clip-abc123_hls/"

    def test_hls_prefix_from_transcoded_key(self):
        from services.transcode_service import _hls_prefix_for

        result = _hls_prefix_for("videos/private/g1/u1/s1/clip-abc123_h264.mp4")
        assert result == "videos/private/g1/u1/s1/clip-abc123_h264_hls/"


# ── 3. segment_to_hls() ────────────────────────────────────────────────────


class TestSegmentToHls:
    @patch("services.transcode_service.s3")
    @patch("services.transcode_service.subprocess.run")
    def test_segment_to_hls_happy_path(self, mock_run, mock_s3):
        """segment_to_hls downloads, runs ffmpeg, uploads segments."""
        from services.transcode_service import segment_to_hls

        s3_key = "videos/private/g1/u1/s1/clip_h264.mp4"

        # Mock S3 download
        def fake_download(key, dest):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"fake-mp4-data")
            return dest
        mock_s3.download_to_path.side_effect = fake_download
        mock_s3.upload_from_path.return_value = "short_key"

        # FFmpeg "runs" and creates HLS output files
        def fake_ffmpeg_run(cmd, **kwargs):
            for arg in cmd:
                if str(arg).endswith("index.m3u8"):
                    outdir = Path(arg).parent
                    outdir.mkdir(parents=True, exist_ok=True)
                    (outdir / "index.m3u8").write_text(
                        "#EXTM3U\n#EXT-X-TARGETDURATION:4\n"
                        "#EXTINF:4.0,\n000.ts\n#EXTINF:4.0,\n001.ts\n#EXT-X-ENDLIST\n"
                    )
                    (outdir / "000.ts").write_bytes(b"ts-data-0")
                    (outdir / "001.ts").write_bytes(b"ts-data-1")
                    break
            return MagicMock(returncode=0, stderr="", stdout="")

        mock_run.side_effect = fake_ffmpeg_run

        result = segment_to_hls(s3_key)

        # FFmpeg was called with correct HLS args
        ffmpeg_cmd = mock_run.call_args[0][0]
        assert "-hls_time" in ffmpeg_cmd
        assert "4" in ffmpeg_cmd
        assert "-hls_playlist_type" in ffmpeg_cmd
        assert "vod" in ffmpeg_cmd
        assert "-c:v" in ffmpeg_cmd
        assert "copy" in ffmpeg_cmd

        # S3 uploads for m3u8 + ts files
        upload_calls = mock_s3.upload_from_path.call_args_list
        uploaded_keys = [c[0][1] for c in upload_calls]
        assert any("index.m3u8" in k for k in uploaded_keys)
        assert any("000.ts" in k for k in uploaded_keys)
        assert any("001.ts" in k for k in uploaded_keys)

        # Returns the HLS prefix
        assert result.endswith("_hls/")

    @patch("services.transcode_service.s3")
    @patch("services.transcode_service.subprocess.run")
    def test_segment_to_hls_ffmpeg_failure(self, mock_run, mock_s3):
        """segment_to_hls raises on FFmpeg failure."""
        from services.transcode_service import segment_to_hls

        def fake_download(key, dest):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"fake")
            return dest
        mock_s3.download_to_path.side_effect = fake_download
        mock_run.return_value = MagicMock(returncode=1, stderr="error", stdout="")

        with pytest.raises(RuntimeError, match="HLS segmentation failed"):
            segment_to_hls("videos/private/g1/u1/s1/clip.mp4")


# ── 4. Presigned HLS playlist rewrite ──────────────────────────────────────


class TestPresignedHlsPlaylist:
    def test_rewrite_m3u8_replaces_ts_lines(self):
        """The rewrite function replaces .ts filenames with presigned URLs."""
        from services.hls_service import rewrite_m3u8_with_presigned_urls

        original = textwrap.dedent("""\
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-TARGETDURATION:4
            #EXT-X-MEDIA-SEQUENCE:0
            #EXT-X-PLAYLIST-TYPE:VOD
            #EXTINF:4.000000,
            000.ts
            #EXTINF:4.000000,
            001.ts
            #EXTINF:2.500000,
            002.ts
            #EXT-X-ENDLIST
        """)

        hls_prefix = "videos/private/g1/u1/s1/clip_hls/"

        def fake_presign(key, expires=7200):
            return f"https://s3.example.com/{key}?sig=abc&expires={expires}"

        result = rewrite_m3u8_with_presigned_urls(original, hls_prefix, presign_fn=fake_presign)

        lines = result.strip().split("\n")
        # Header lines preserved
        assert lines[0] == "#EXTM3U"
        # .ts lines replaced with presigned URLs
        ts_lines = [l for l in lines if "s3.example.com" in l]
        assert len(ts_lines) == 3
        assert "clip_hls/000.ts" in ts_lines[0]
        assert "clip_hls/001.ts" in ts_lines[1]
        assert "clip_hls/002.ts" in ts_lines[2]
        # No bare .ts filenames remain
        bare_ts = [l for l in lines if l.strip().endswith(".ts") and not l.startswith("http")]
        assert len(bare_ts) == 0

    def test_rewrite_preserves_comments_and_tags(self):
        """Comment and tag lines are preserved unchanged."""
        from services.hls_service import rewrite_m3u8_with_presigned_urls

        m3u8 = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\n000.ts\n#EXT-X-ENDLIST\n"
        hls_prefix = "prefix/"
        fake_presign = lambda key, expires=7200: f"https://s3/{key}"

        result = rewrite_m3u8_with_presigned_urls(m3u8, hls_prefix, presign_fn=fake_presign)
        lines = result.strip().split("\n")
        assert lines[0] == "#EXTM3U"
        assert lines[1] == "#EXT-X-TARGETDURATION:4"
        assert lines[2] == "#EXTINF:4.0,"
        assert lines[3] == "https://s3/prefix/000.ts"
        assert lines[4] == "#EXT-X-ENDLIST"


# ── 5. HLS backfill ────────────────────────────────────────────────────────


class TestHlsBackfill:
    def test_run_hls_only_task_skips_already_complete(self, db_session: Session):
        """run_hls_only_task does nothing if hls_status is already complete."""
        from services.transcode_service import run_hls_only_task

        asset = MediaAsset(
            id="bf-1",
            s3_key="videos/private/g1/u1/s1/done.mp4",
            transcode_status="complete",
            hls_status="complete",
            hls_s3_prefix="videos/private/g1/u1/s1/done_hls/",
        )
        db_session.add(asset)
        db_session.commit()

        with patch("services.transcode_service.SessionLocal", return_value=db_session):
            with patch("services.transcode_service.segment_to_hls") as mock_seg:
                run_hls_only_task("videos/private/g1/u1/s1/done.mp4")
                mock_seg.assert_not_called()

    def test_run_hls_only_task_skips_untranscoded(self, db_session: Session):
        """run_hls_only_task skips assets that aren't transcoded yet."""
        from services.transcode_service import run_hls_only_task

        asset = MediaAsset(
            id="bf-2",
            s3_key="videos/private/g1/u1/s1/raw.mp4",
            transcode_status=None,
        )
        db_session.add(asset)
        db_session.commit()

        with patch("services.transcode_service.SessionLocal", return_value=db_session):
            with patch("services.transcode_service.segment_to_hls") as mock_seg:
                run_hls_only_task("videos/private/g1/u1/s1/raw.mp4")
                mock_seg.assert_not_called()

    def test_backfill_hls_all_queues_correct_assets(self, db_session: Session):
        """backfill_hls_all finds transcoded assets missing HLS and queues them."""
        from services.transcode_service import backfill_hls_all

        # Needs HLS (transcode done, no HLS)
        a1 = MediaAsset(id="bf-3", s3_key="key-needs-hls", transcode_status="complete", hls_status=None)
        # Needs HLS (transcode done, HLS failed)
        a2 = MediaAsset(id="bf-4", s3_key="key-failed-hls", transcode_status="complete", hls_status="failed")
        # Already done (should be skipped)
        a3 = MediaAsset(id="bf-5", s3_key="key-done", transcode_status="complete", hls_status="complete")
        # Not transcoded yet (should be skipped)
        a4 = MediaAsset(id="bf-6", s3_key="key-raw", transcode_status=None)
        db_session.add_all([a1, a2, a3, a4])
        db_session.commit()

        with patch("services.transcode_service.SessionLocal", return_value=db_session):
            with patch("services.transcode_service._TRANSCODE_POOL") as mock_pool:
                keys = backfill_hls_all()

        assert sorted(keys) == ["key-failed-hls", "key-needs-hls"]
        assert mock_pool.submit.call_count == 2
