"""Stateful correction pipeline for detection post-processing."""
from __future__ import annotations

from typing import List

from common.types import Detection
from cv import config
from cv.long_persistence import LongLivedPersistence
from cv.persistence import DetectionPersistence
from cv.prediction import DetectionPrediction
from cv.smoothing import DetectionSmoother


class CorrectionPipeline:
    """Applies dedup + prediction + persistence and exposes publish snapshots."""

    def __init__(self, frame_width: int):
        self._deduper = DetectionSmoother()
        self._predictor = DetectionPrediction()
        self._long_persistence = LongLivedPersistence(
            frame_width=frame_width,
            min_alive_seconds=config.LONG_PERSIST_MIN_ALIVE_SECONDS,
            persist_seconds=config.LONG_PERSIST_SECONDS,
            edge_margin_px=config.LONG_PERSIST_EDGE_MARGIN_PX,
        )
        self._short_persistence = DetectionPersistence(hold_seconds=config.SHORT_PERSISTENCE_HOLD_SECONDS)

    def ingest(self, detections: List[Detection], now: float) -> None:
        """Ingest one detector batch and update correction state."""
        deduped = self._deduper.update(detections, now=now)
        self._predictor.ingest(deduped, now=now)
        self._long_persistence.observe(deduped, now=now)

    def snapshot(self, now: float) -> List[Detection]:
        """Get current corrected detections for publishing."""
        predicted = self._predictor.predict_all(now)
        long_lived = self._long_persistence.extend(predicted_tracks=predicted, now=now)

        # Predicted tracks are the publish baseline; long-lived entries are additive.
        by_id: dict[int, Detection] = {
            d.track_id: d for d in predicted if d.track_id is not None
        }
        for d in long_lived:
            if d.track_id is not None and d.track_id not in by_id:
                by_id[d.track_id] = d

        merged = list(by_id.values())
        return self._short_persistence.apply(merged, now=now)
