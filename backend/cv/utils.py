"""
Computer vision utility functions.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Union

import cv2


@dataclass
class VideoInfo:
    width: int
    height: int
    fps: float
    total_frames: int


def get_video_info(source: Union[str, int, Path]) -> VideoInfo | None:
    """
    Extract metadata from a video source.
    
    Args:
        source: Path to video file, camera index, or RTSP/HTTP URL.
        
    Returns:
        VideoInfo object or None if the source cannot be opened.
    """
    if isinstance(source, Path):
        source = str(source)
        
    backend = cv2.CAP_FFMPEG if isinstance(source, str) and source.startswith("http") else cv2.CAP_ANY
    cap = cv2.VideoCapture(source, backend)
    if not cap.isOpened():
        return None
        
    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        return VideoInfo(
            width=width,
            height=height,
            fps=fps,
            total_frames=total_frames
        )
    finally:
        cap.release()
