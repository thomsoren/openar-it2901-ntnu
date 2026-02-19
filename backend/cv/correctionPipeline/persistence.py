"""Short-term persistence filter to prevent split-second marker dropouts."""
from __future__ import annotations

from typing import List

from common.types import Detection
from . import config


class DetectionPersistenceFilter:
    """Hold last known detections for a short window when updates go empty."""

    def __init__(self, hold_seconds: float = config.SHORT_PERSISTENCE_HOLD_SECONDS):
        self.hold_seconds = hold_seconds
        self._last_non_empty: List[Detection] = []
        self._last_non_empty_ts: float | None = None

    def apply(self, detections: List[Detection], now: float) -> List[Detection]:
        if detections:
            # Store a shallow copy to avoid aliasing caller-owned list objects.
            self._last_non_empty = list(detections)
            self._last_non_empty_ts = now
            return list(detections)

        if self._last_non_empty_ts is None:
            return detections

        if (now - self._last_non_empty_ts) <= self.hold_seconds:
            return list(self._last_non_empty)

        return list(detections)


# Backwards-compatible alias if imported elsewhere.
DetectionPersistence = DetectionPersistenceFilter
