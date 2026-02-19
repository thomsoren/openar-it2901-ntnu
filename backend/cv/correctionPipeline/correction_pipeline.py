"""Stateful correction pipeline for detection post-processing."""
from __future__ import annotations

from typing import List

from common.types import Detection
from . import config
from .persistence import DetectionPersistence
from .prediction import DetectionPrediction
from .smoothing import DetectionSmoother


class CorrectionPipeline:
    """Applies dedup + prediction + short persistence and exposes publish snapshots."""

    def __init__(self, frame_width: int):
        _ = frame_width  # Kept for compatibility with existing worker constructor call.
        self._deduper = DetectionSmoother()
        self._predictor = DetectionPrediction()
        self._short_persistence = DetectionPersistence(hold_seconds=config.SHORT_PERSISTENCE_HOLD_SECONDS)

    def ingest(self, detections: List[Detection], now: float) -> None:
        """Ingest one detector batch and update correction state."""
        deduped = self._deduper.update(detections, now=now)
        self._predictor.ingest(deduped, now=now)

    def snapshot(self, now: float) -> List[Detection]:
        """Get current corrected detections for publishing."""
        predicted = self._predictor.predict_all(now)
        return self._short_persistence.apply(predicted, now=now)
