"""MediaMTX and FFmpeg publishing configuration."""
from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit


def _truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


MEDIAMTX_ENABLED = _truthy(os.getenv("MEDIAMTX_ENABLED"), default=True)
MEDIAMTX_RTSP_BASE = os.getenv("MEDIAMTX_RTSP_BASE", "rtsp://localhost:8854").rstrip("/")
MEDIAMTX_WHEP_BASE = os.getenv("MEDIAMTX_WHEP_BASE", "http://localhost:8889").rstrip("/")
MEDIAMTX_HLS_BASE = os.getenv("MEDIAMTX_HLS_BASE", "http://localhost:8888").rstrip("/")

MEDIAMTX_PUBLISH_USER = os.getenv("MEDIAMTX_PUBLISH_USER", "").strip()
MEDIAMTX_PUBLISH_PASS = os.getenv("MEDIAMTX_PUBLISH_PASS", "").strip()
MEDIAMTX_READ_USER = os.getenv("MEDIAMTX_READ_USER", "").strip()
MEDIAMTX_READ_PASS = os.getenv("MEDIAMTX_READ_PASS", "").strip()
# WARNING: When true, read credentials are embedded in playback URLs returned
# to the browser via the API. Only enable for local development or trusted networks.
MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS = _truthy(
    os.getenv("MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS"),
    default=False,
)

FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")
FFMPEG_CODEC = os.getenv("FFMPEG_CODEC", "libx264").strip().lower()
FFMPEG_LIBX264_PRESET = os.getenv("FFMPEG_LIBX264_PRESET", "ultrafast").strip()
FFMPEG_NVENC_PRESET = os.getenv("FFMPEG_NVENC_PRESET", "p1").strip()
FFMPEG_VIDEO_BITRATE = os.getenv("FFMPEG_VIDEO_BITRATE", "4M").strip()
FFMPEG_GOP = int(os.getenv("FFMPEG_GOP", "15"))
FFMPEG_SCALE_WIDTH = int(os.getenv("FFMPEG_SCALE_WIDTH", "0"))
FFMPEG_SCALE_HEIGHT = int(os.getenv("FFMPEG_SCALE_HEIGHT", "0"))


def _with_basic_auth(url: str, user: str, password: str) -> str:
    if not user and not password:
        return url
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    auth = f"{user}:{password}@" if password else f"{user}@"
    netloc = f"{auth}{host}{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def build_rtsp_publish_url(stream_id: str) -> str:
    base = f"{MEDIAMTX_RTSP_BASE}/{stream_id}"
    if MEDIAMTX_PUBLISH_USER or MEDIAMTX_PUBLISH_PASS:
        return _with_basic_auth(base, MEDIAMTX_PUBLISH_USER, MEDIAMTX_PUBLISH_PASS)
    return base


def build_playback_urls(stream_id: str) -> dict[str, str]:
    whep_url = f"{MEDIAMTX_WHEP_BASE}/{stream_id}/whep"
    hls_url = f"{MEDIAMTX_HLS_BASE}/{stream_id}/index.m3u8"
    rtsp_url = f"{MEDIAMTX_RTSP_BASE}/{stream_id}"

    if MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS and (MEDIAMTX_READ_USER or MEDIAMTX_READ_PASS):
        whep_url = _with_basic_auth(whep_url, MEDIAMTX_READ_USER, MEDIAMTX_READ_PASS)
        hls_url = _with_basic_auth(hls_url, MEDIAMTX_READ_USER, MEDIAMTX_READ_PASS)
        rtsp_url = _with_basic_auth(rtsp_url, MEDIAMTX_READ_USER, MEDIAMTX_READ_PASS)

    return {
        "whep_url": whep_url,
        "hls_url": hls_url,
        "rtsp_url": rtsp_url,
    }
