"""Transcode uploaded videos to H.264 MP4 with faststart for efficient streaming."""
from __future__ import annotations

import json
import logging
import subprocess
import tempfile
import threading
from pathlib import Path, PurePosixPath

from sqlalchemy import select

from common.config.mediamtx import FFMPEG_BIN, FFPROBE_BIN
from db.database import SessionLocal
from db.models import MediaAsset
from storage import s3

logger = logging.getLogger(__name__)

TRANSCODE_TIMEOUT_S = 120


def _transcoded_key_for(original_key: str) -> str:
    p = PurePosixPath(original_key)
    return str(p.with_name(f"{p.stem}_h264.mp4"))


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
    """Check if the moov atom appears before mdat (faststart layout)."""
    try:
        with open(source_path, "rb") as f:
            header = f.read(128 * 1024)
            moov_pos = header.find(b"moov")
            mdat_pos = header.find(b"mdat")
            if moov_pos >= 0 and mdat_pos >= 0:
                return moov_pos < mdat_pos
    except OSError:
        pass
    return False


def _set_transcode_status(
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


def transcode_to_h264(s3_key: str) -> str | None:
    """Download from S3, transcode to H.264 MP4 with faststart, upload back.

    Returns the new S3 key, or None if the original is already suitable.
    """
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
                "-an",
                "-y",
                str(output_path),
            ]
            logger.info("[transcode] Transcoding to H.264: %s", s3_key)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TRANSCODE_TIMEOUT_S,
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


def run_transcode_task(s3_key: str) -> None:
    """Transcode a video and update its MediaAsset status.

    Safe to call from background tasks or threads. Skips if already complete.
    """
    with SessionLocal() as db:
        row = db.execute(
            select(MediaAsset).where(MediaAsset.s3_key == s3_key)
        ).scalar_one_or_none()
        if not row:
            logger.warning("[transcode] MediaAsset not found for key %s", s3_key)
            return
        if row.transcode_status == "complete" and row.transcoded_s3_key:
            logger.info("[transcode] Already transcoded: %s", s3_key)
            return
        row.transcode_status = "processing"
        db.commit()

    try:
        transcoded_key = transcode_to_h264(s3_key)
    except Exception as exc:
        logger.error("[transcode] Failed for %s: %s", s3_key, exc)
        _set_transcode_status(s3_key, "failed")
        return

    _set_transcode_status(s3_key, "complete", transcoded_key)
    logger.info("[transcode] Done for %s → %s", s3_key, transcoded_key or "(original is fine)")


def retry_interrupted_transcodes() -> None:
    """Re-enqueue transcodes that were interrupted by a server restart."""
    with SessionLocal() as db:
        rows = db.execute(
            select(MediaAsset).where(MediaAsset.transcode_status.in_(["pending", "processing"]))
        ).scalars().all()
        keys = [row.s3_key for row in rows]

    if not keys:
        return

    logger.info("[transcode] Retrying %d interrupted transcode(s)", len(keys))
    for key in keys:
        threading.Thread(target=run_transcode_task, args=(key,), daemon=True).start()
