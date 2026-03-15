"""Transcode uploaded videos to H.264 MP4 with faststart for efficient streaming."""
from __future__ import annotations

import json
import logging
import struct
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath

from sqlalchemy import or_, select, update

from common.config.mediamtx import FFMPEG_BIN, FFPROBE_BIN
from db.database import SessionLocal
from db.models import MediaAsset
from settings import app_settings
from storage import s3

logger = logging.getLogger(__name__)

_TRANSCODE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="transcode")

HLS_SEGMENT_DURATION_S = 4


def _transcoded_key_for(original_key: str) -> str:
    p = PurePosixPath(original_key)
    return str(p.with_name(f"{p.stem}_h264.mp4"))


def hls_prefix_for(s3_key: str) -> str:
    """Derive the HLS S3 prefix from a video S3 key.

    Example: 'videos/.../clip_h264.mp4' → 'videos/.../clip_h264_hls/'
    """
    p = PurePosixPath(s3_key)
    return str(p.with_name(f"{p.stem}_hls")) + "/"


def _probe_codec_and_faststart(source_path: str) -> tuple[str | None, bool]:
    """Return (codec_name, has_faststart) for the first video stream."""
    try:
        result = subprocess.run(
            [
                FFPROBE_BIN,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_name",
                "-show_entries", "format_tags=major_brand",
                "-of", "json",
                source_path,
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode != 0:
            return None, False
        data = json.loads(result.stdout)
        streams = data.get("streams", [])
        codec = streams[0].get("codec_name") if streams else None

        has_faststart = False
        fmt_tags = data.get("format", {}).get("tags", {})
        major_brand = fmt_tags.get("major_brand", "")
        if major_brand in {"isom", "mp42", "M4V ", "avc1"}:
            has_faststart = _check_moov_before_mdat(source_path)

        return codec, has_faststart
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        logger.debug("ffprobe failed for %s: %s", source_path, exc)
        return None, False


def _check_moov_before_mdat(source_path: str) -> bool:
    """Check if the moov atom appears before mdat by parsing top-level MP4 box headers."""
    try:
        with open(source_path, "rb") as f:
            while True:
                header = f.read(8)
                if len(header) < 8:
                    break
                size, box_type = struct.unpack(">I4s", header)
                box_type_str = box_type.decode("ascii", errors="replace")
                if box_type_str == "moov":
                    return True
                if box_type_str == "mdat":
                    return False
                if size == 1:
                    ext = f.read(8)
                    if len(ext) < 8:
                        break
                    size = struct.unpack(">Q", ext)[0]
                    if size < 16:
                        break
                    f.seek(size - 16, 1)
                elif size == 0:
                    break
                elif size < 8:
                    break
                else:
                    f.seek(size - 8, 1)
    except OSError:
        pass
    return False


def set_transcode_status(
    s3_key: str,
    status: str,
    transcoded_key: str | None = None,
) -> None:
    """Update transcode status on the MediaAsset row."""
    with SessionLocal() as db:
        row = db.execute(
            select(MediaAsset).where(MediaAsset.s3_key == s3_key)
        ).scalar_one_or_none()
        if row:
            row.transcode_status = status
            if transcoded_key:
                row.transcoded_s3_key = transcoded_key
            db.commit()


def set_hls_status(
    s3_key: str,
    status: str,
    hls_prefix: str | None = None,
) -> None:
    """Update HLS segmentation status on the MediaAsset row."""
    with SessionLocal() as db:
        row = db.execute(
            select(MediaAsset).where(MediaAsset.s3_key == s3_key)
        ).scalar_one_or_none()
        if row:
            row.hls_status = status
            if hls_prefix:
                row.hls_s3_prefix = hls_prefix
            db.commit()


def get_transcoded_key(s3_key: str) -> str | None:
    """Return the transcoded S3 key for an asset if transcode is complete.

    If the original was already H.264, returns the original key itself
    (transcode verified it's suitable, no separate file needed).
    """
    with SessionLocal() as db:
        row = db.execute(
            select(MediaAsset).where(MediaAsset.s3_key == s3_key)
        ).scalar_one_or_none()
        if row and row.transcode_status == "complete":
            return row.transcoded_s3_key or s3_key
    return None


def transcode_to_h264(s3_key: str) -> str | None:
    """Download from S3, transcode to H.264 MP4 with faststart, upload back.

    Returns the new S3 key, or None if the original is already suitable.
    """
    meta = s3.head_object(s3_key)
    if not meta:
        raise RuntimeError(f"S3 object not found: {s3_key}")
    file_size = int(meta.get("ContentLength", 0))
    max_bytes = app_settings.transcode_max_file_bytes
    if file_size > max_bytes:
        raise RuntimeError(
            f"File too large for transcoding: {file_size / (1024 * 1024):.1f} MB "
            f"(max {max_bytes / (1024 * 1024):.0f} MB)"
        )

    with tempfile.TemporaryDirectory(prefix="openar_transcode_") as tmpdir:
        tmp = Path(tmpdir)
        original_name = PurePosixPath(s3_key).name
        input_path = tmp / original_name
        output_path = tmp / f"{Path(original_name).stem}_h264.mp4"

        logger.info("[transcode] Downloading s3://%s", s3_key)
        s3.download_to_path(s3_key, input_path)

        codec, has_faststart = _probe_codec_and_faststart(str(input_path))
        logger.info(
            "[transcode] Probed s3://%s: codec=%s, faststart=%s",
            s3_key, codec, has_faststart,
        )

        if codec == "h264" and has_faststart:
            logger.info("[transcode] Already H.264 with faststart, skipping: %s", s3_key)
            return None

        if codec == "h264":
            cmd = [
                FFMPEG_BIN,
                "-i", str(input_path),
                "-c:v", "copy",
                # Surveillance video — audio not needed
                "-an",
                "-movflags", "+faststart",
                "-y",
                str(output_path),
            ]
            logger.info("[transcode] Remuxing with faststart: %s", s3_key)
        else:
            cmd = [
                FFMPEG_BIN,
                "-i", str(input_path),
                "-c:v", "libx264",
                "-preset", "fast",
                "-profile:v", "main",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                # Surveillance video — audio not needed
                "-an",
                "-y",
                str(output_path),
            ]
            logger.info("[transcode] Transcoding to H.264: %s", s3_key)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=app_settings.transcode_timeout_s,
        )
        if result.returncode != 0:
            logger.error(
                "[transcode] FFmpeg failed for %s (exit %d): %s",
                s3_key, result.returncode, result.stderr[-500:] if result.stderr else "",
            )
            raise RuntimeError(f"FFmpeg transcode failed with exit code {result.returncode}")

        transcoded_key = _transcoded_key_for(s3_key)
        logger.info("[transcode] Uploading transcoded file to s3://%s", transcoded_key)
        s3.upload_from_path(output_path, transcoded_key)

        return transcoded_key


def segment_to_hls(s3_key: str) -> str:
    """Segment an H.264 MP4 into HLS (.m3u8 + .ts) and upload to S3.

    Downloads the file from S3, runs FFmpeg to produce VOD HLS segments,
    uploads all resulting files, and returns the HLS S3 prefix.
    Uses -c:v copy (no re-encode) so this is fast.
    """
    hls_prefix = hls_prefix_for(s3_key)

    with tempfile.TemporaryDirectory(prefix="openar_hls_") as tmpdir:
        tmp = Path(tmpdir)
        input_path = tmp / PurePosixPath(s3_key).name

        logger.info("[hls] Downloading s3://%s for segmentation", s3_key)
        s3.download_to_path(s3_key, input_path)

        hls_out_dir = tmp / "hls"
        hls_out_dir.mkdir()
        m3u8_path = hls_out_dir / "index.m3u8"
        segment_pattern = str(hls_out_dir / "%03d.ts")

        cmd = [
            FFMPEG_BIN,
            "-i", str(input_path),
            "-c:v", "copy",
            "-an",
            "-hls_time", str(HLS_SEGMENT_DURATION_S),
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", segment_pattern,
            "-y",
            str(m3u8_path),
        ]
        logger.info("[hls] Segmenting to HLS: %s", s3_key)
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=app_settings.transcode_timeout_s,
        )
        if result.returncode != 0:
            logger.error(
                "[hls] FFmpeg segmentation failed for %s (exit %d): %s",
                s3_key, result.returncode, result.stderr[-500:] if result.stderr else "",
            )
            raise RuntimeError(f"FFmpeg HLS segmentation failed with exit code {result.returncode}")

        # Upload all produced files
        for f in sorted(hls_out_dir.iterdir()):
            remote_key = hls_prefix + f.name
            content_type = "application/vnd.apple.mpegurl" if f.suffix == ".m3u8" else "video/mp2t"
            logger.info("[hls] Uploading %s to s3://%s", f.name, remote_key)
            s3.upload_from_path(f, remote_key, content_type=content_type)

    logger.info("[hls] HLS segmentation complete for %s -> s3://%s", s3_key, hls_prefix)
    return hls_prefix


def run_transcode_task(s3_key: str) -> None:
    """Transcode a video and update its MediaAsset status.

    Safe to call from background tasks or threads. Uses an atomic UPDATE
    to claim the row, preventing concurrent transcodes of the same file.
    """
    with SessionLocal() as db:
        result = db.execute(
            update(MediaAsset)
            .where(MediaAsset.s3_key == s3_key)
            .where(MediaAsset.transcode_status.in_([None, "pending", "failed"]))
            .values(transcode_status="processing")
            .returning(MediaAsset.s3_key)
        )
        claimed = result.fetchone()
        db.commit()

    if not claimed:
        with SessionLocal() as db:
            row = db.execute(
                select(MediaAsset).where(MediaAsset.s3_key == s3_key)
            ).scalar_one_or_none()
            if row and row.transcode_status == "complete":
                logger.info("[transcode] Already transcoded: %s", s3_key)
            elif not row:
                logger.warning("[transcode] MediaAsset not found for key %s", s3_key)
            else:
                logger.info("[transcode] Already being processed: %s", s3_key)
        return

    try:
        transcoded_key = transcode_to_h264(s3_key)
    except Exception as exc:
        logger.error("[transcode] Failed for %s: %s", s3_key, exc)
        set_transcode_status(s3_key, "failed")
        return

    set_transcode_status(s3_key, "complete", transcoded_key)
    logger.info("[transcode] Done for %s -> %s", s3_key, transcoded_key or "(original is fine)")

    # Chain HLS segmentation after successful transcode
    effective_key = transcoded_key or s3_key
    set_hls_status(s3_key, "processing")
    try:
        hls_prefix = segment_to_hls(effective_key)
        set_hls_status(s3_key, "complete", hls_prefix)
        logger.info("[hls] Done for %s -> %s", s3_key, hls_prefix)
    except Exception as exc:
        logger.error("[hls] Segmentation failed for %s: %s", s3_key, exc)
        set_hls_status(s3_key, "failed")


def run_hls_only_task(s3_key: str) -> None:
    """Run HLS segmentation for a video that is already transcoded.

    Unlike run_transcode_task, this skips the transcode step and only
    performs HLS segmentation.  Safe for backfilling existing assets.
    """
    with SessionLocal() as db:
        row = db.execute(
            select(MediaAsset).where(MediaAsset.s3_key == s3_key)
        ).scalar_one_or_none()
        if not row:
            logger.warning("[hls-backfill] Asset not found: %s", s3_key)
            return
        if row.hls_status == "complete":
            logger.info("[hls-backfill] Already done: %s", s3_key)
            return
        if row.transcode_status != "complete":
            logger.info("[hls-backfill] Transcode not complete, skipping: %s", s3_key)
            return
        effective_key = row.transcoded_s3_key or s3_key

    set_hls_status(s3_key, "processing")
    try:
        hls_prefix = segment_to_hls(effective_key)
        set_hls_status(s3_key, "complete", hls_prefix)
        logger.info("[hls-backfill] Done for %s -> %s", s3_key, hls_prefix)
    except Exception as exc:
        logger.error("[hls-backfill] Failed for %s: %s", s3_key, exc)
        set_hls_status(s3_key, "failed")


def backfill_hls_all() -> list[str]:
    """Queue HLS segmentation for all transcoded assets missing HLS.

    Returns the list of s3_keys that were queued.
    """
    with SessionLocal() as db:
        rows = db.execute(
            select(MediaAsset).where(
                MediaAsset.transcode_status == "complete",
                or_(
                    MediaAsset.hls_status.is_(None),
                    MediaAsset.hls_status.in_(["pending", "failed"]),
                ),
            )
        ).scalars().all()
        keys = [row.s3_key for row in rows]

    if not keys:
        logger.info("[hls-backfill] No assets need HLS segmentation")
        return []

    logger.info("[hls-backfill] Queuing %d asset(s) for HLS segmentation", len(keys))
    for key in keys:
        _TRANSCODE_POOL.submit(run_hls_only_task, key)
    return keys


def retry_interrupted_transcodes() -> None:
    """Re-enqueue transcodes/HLS jobs that were interrupted by a server restart."""
    with SessionLocal() as db:
        rows = db.execute(
            select(MediaAsset).where(
                or_(
                    MediaAsset.transcode_status.in_(["pending", "processing"]),
                    MediaAsset.hls_status.in_(["pending", "processing"]),
                )
            )
        ).scalars().all()
        keys = [row.s3_key for row in rows]

    if not keys:
        return

    logger.info("[transcode] Retrying %d interrupted transcode(s)", len(keys))
    for key in keys:
        _TRANSCODE_POOL.submit(run_transcode_task, key)
