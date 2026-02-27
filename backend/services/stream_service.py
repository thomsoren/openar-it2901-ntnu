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
    return None


def _download_s3_to_cache(s3_key: str) -> str:
    cache_dir = BASE_DIR / "data" / "cache" / "s3"
    cache_dir.mkdir(parents=True, exist_ok=True)

    filename = Path(s3_key).name
    local_path = cache_dir / filename

    if local_path.exists():
        logger.info("[s3] Using cached file: %s", local_path)
        return str(local_path)

    logger.info("[s3] Downloading s3://%s to %s", s3_key, local_path)
    try:
        client = s3._client()
        full_key, _ = s3._normalize_key(s3_key)
        client.download_file(s3.S3_BUCKET, full_key, str(local_path))
        logger.info("[s3] Download complete: %s", local_path)
        return str(local_path)
    except Exception as exc:
        if local_path.exists():
            local_path.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to download s3://{s3_key}: {exc}") from exc


def resolve_stream_source(source_url: str | None) -> str | None:
    if not source_url or not source_url.strip():
        return resolve_default_source()

    raw = source_url.strip()

    if raw.startswith("s3://"):
        s3_key = raw[5:]
        return _download_s3_to_cache(s3_key)

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
