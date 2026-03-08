"""Computer vision utility functions."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import cv2

from cv.config import DEFAULT_FPS


# ── URL classification ────────────────────────────────────────────────────────

_REMOTE_SCHEMES = {"rtsp", "rtsps", "http", "https", "rtmp", "udp", "tcp"}
_LIVE_SCHEMES = {"rtsp", "rtsps", "rtmp", "udp", "tcp"}
_HTTP_SCHEMES = {"http", "https"}


def is_remote_url(url: str) -> bool:
    """True if *url* uses a network scheme (rtsp, http, etc.), False for local paths."""
    return urlparse(url).scheme.lower() in _REMOTE_SCHEMES


def is_live_stream_url(url: str) -> bool:
    """True for real-time stream protocols (RTSP, RTMP, UDP, TCP). HTTP is file-based."""
    return urlparse(url).scheme.lower() in _LIVE_SCHEMES


def is_http_url(url: str) -> bool:
    """True for HTTP/HTTPS URLs (S3 presigned URLs, object-storage files)."""
    return urlparse(url).scheme.lower() in _HTTP_SCHEMES


# ── Ready payload ─────────────────────────────────────────────────────────────


def build_ready_payload(width: int, height: int, fps: float) -> dict:
    """Build the ``{"type": "ready", ...}`` payload sent on first frame of a stream."""
    return {
        "type": "ready",
        "width": width,
        "height": height,
        "fps": fps,
    }


@dataclass
class VideoInfo:
    width: int
    height: int
    fps: float
    total_frames: int


def get_video_info(source: str | int | Path) -> VideoInfo | None:
    if isinstance(source, Path):
        source = str(source)
        
    backend = cv2.CAP_FFMPEG if isinstance(source, str) and source.startswith("http") else cv2.CAP_ANY
    cap = cv2.VideoCapture(source, backend)
    if not cap.isOpened():
        return None
        
    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or DEFAULT_FPS
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        return VideoInfo(
            width=width,
            height=height,
            fps=fps,
            total_frames=total_frames
        )
    finally:
        cap.release()
