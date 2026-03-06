"""MediaMTX and FFmpeg publishing configuration."""
from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

from settings._env import get_bool, get_int, get_str


MEDIAMTX_ENABLED = get_bool("MEDIAMTX_ENABLED", default=True)
MEDIAMTX_RTSP_BASE = get_str("MEDIAMTX_RTSP_BASE", "rtsp://localhost:8854").rstrip("/")
# Single base URL for playback. Set for production (e.g. https://mediamtx.example.com).
# When unset, local defaults: WHEP=8889, HLS=8888 (different ports).
_mediamtx_url = get_str("MEDIAMTX_URL", "").rstrip("/")
if _mediamtx_url:
    MEDIAMTX_WHEP_BASE = MEDIAMTX_HLS_BASE = _mediamtx_url
else:
    MEDIAMTX_WHEP_BASE = "http://localhost:8889"
    MEDIAMTX_HLS_BASE = "http://localhost:8888"

MEDIAMTX_PUBLISH_USER = get_str("MEDIAMTX_PUBLISH_USER", "")
MEDIAMTX_PUBLISH_PASS = get_str("MEDIAMTX_PUBLISH_PASS", "")
MEDIAMTX_READ_USER = get_str("MEDIAMTX_READ_USER", "")
MEDIAMTX_READ_PASS = get_str("MEDIAMTX_READ_PASS", "")
# WARNING: When true, read credentials are embedded in playback URLs returned
# to the browser via the API. Only enable for local development or trusted networks.
MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS = get_bool(
    "MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS", default=False,
)

FFMPEG_BIN = get_str("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = get_str("FFPROBE_BIN", "ffprobe")
FFMPEG_CODEC = get_str("FFMPEG_CODEC", "auto").lower()
FFMPEG_LIBX264_PRESET = get_str("FFMPEG_LIBX264_PRESET", "ultrafast")
FFMPEG_NVENC_PRESET = get_str("FFMPEG_NVENC_PRESET", "p1")
FFMPEG_VIDEO_BITRATE = get_str("FFMPEG_VIDEO_BITRATE", "4M")
FFMPEG_GOP = get_int("FFMPEG_GOP", 15)
FFMPEG_SCALE_WIDTH = get_int("FFMPEG_SCALE_WIDTH", 0)
FFMPEG_SCALE_HEIGHT = get_int("FFMPEG_SCALE_HEIGHT", 0)


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
