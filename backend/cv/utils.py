"""Computer vision utility functions."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2

from cv.config import DEFAULT_FPS


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
