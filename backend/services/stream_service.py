from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlparse

from common.config import BASE_DIR, MEDIAMTX_ENABLED, VIDEO_PATH, build_playback_urls
from storage import s3

logger = logging.getLogger(__name__)


def is_remote_stream(source_url: str) -> bool:
    return urlparse(source_url).scheme.lower() in {"rtsp", "http", "https", "rtmp", "udp", "tcp"}


def resolve_default_source() -> str | None:
    if VIDEO_PATH and VIDEO_PATH.exists():
        return str(VIDEO_PATH)
    # Fall back to S3 system asset if local file not present
    try:
        key = s3.resolve_system_asset_key("video", "video")
        return _presign_s3_for_ffmpeg(key)
    except Exception:
        return None


def _download_s3_to_cache(s3_key: str) -> str:
    cache_dir = BASE_DIR / "data" / "cache" / "s3"
    filename = Path(s3_key).name
    local_path = cache_dir / filename

    if local_path.exists():
        logger.info("[s3] Using cached file: %s", local_path)
        return str(local_path)

    logger.info("[s3] Downloading s3://%s to %s", s3_key, local_path)
    try:
        s3.download_to_path(s3_key, local_path)
        logger.info("[s3] Download complete: %s", local_path)
        return str(local_path)
    except Exception as exc:
        if local_path.exists():
            local_path.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to download s3://{s3_key}: {exc}") from exc


def _presign_s3_for_ffmpeg(s3_key: str, expires: int = 7200) -> str:
    """Return a presigned HTTPS URL so FFmpeg can start immediately without downloading."""
    try:
        url = s3.presign_get(s3_key, expires=expires)
        logger.info("[s3] Presigned URL for s3://%s (expires %ds)", s3_key, expires)
        return url
    except Exception as exc:
        logger.warning("[s3] Presign failed, falling back to download: %s", exc)
        return _download_s3_to_cache(s3_key)


def resolve_stream_source(source_url: str | None) -> str | None:
    if not source_url or not source_url.strip():
        return resolve_default_source()

    raw = source_url.strip()

    if raw.startswith("s3://"):
        s3_key = raw[5:]
        return _presign_s3_for_ffmpeg(s3_key)

    if is_remote_stream(raw):
        return raw

    candidate = Path(raw)
    name_mp4 = candidate.name if candidate.suffix else candidate.name + ".mp4"
    video_dir = BASE_DIR / "data" / "raw" / "video"
    base_resolved = BASE_DIR.resolve()

    local_candidates = [
        candidate,
        BASE_DIR / candidate,
        video_dir / candidate.name,
        video_dir / name_mp4,
    ]

    for path in local_candidates:
        try:
            resolved = path.resolve()
            if not path.is_absolute():
                resolved.relative_to(base_resolved)
            if resolved.exists():
                return str(resolved)
        except (ValueError, OSError):
            continue

    return raw


def build_stream_playback_payload(stream_id: str) -> dict:
    payload = {"media_enabled": MEDIAMTX_ENABLED}
    if MEDIAMTX_ENABLED:
        payload.update(build_playback_urls(stream_id))
    return payload


def augment_stream_payload(stream: dict) -> dict:
    stream_id = str(stream.get("stream_id", "")).strip()
    if not stream_id:
        return stream
    return {**stream, "playback_urls": build_stream_playback_payload(stream_id)}
