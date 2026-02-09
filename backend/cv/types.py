"""
Internal data structures for the CV pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, List
import numpy as np


@dataclass
class RawDetection:
    """Detection output from a model before tracking."""
    bbox: np.ndarray  # [x1, y1, x2, y2]
    confidence: float
    class_id: int
    class_name: str


@dataclass
class TrackedVessel:
    """A vessel that has been processed by the tracker."""
    track_id: int
    bbox: np.ndarray  # [x1, y1, x2, y2]
    confidence: float
    class_id: int
    class_name: str
    age: int = 0
    hits: int = 1
    time_since_update: int = 0


@dataclass
class PipelineFrame:
    """Processed frame results for API/WebSocket consumption."""
    frame_index: int
    timestamp_ms: float
    vessels: List[TrackedVessel]
    fps: float
