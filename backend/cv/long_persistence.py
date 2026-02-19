"""Long-lived per-vessel persistence with side-exit rules."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from common.types import Detection
from cv import config


@dataclass
class _TrackLife:
    first_seen: float
    last_seen: float
    last_x: float


class LongLivedPersistence:
    """Keep eligible vessels alive when detections briefly disappear.

    Rule set:
    - Vessel must have been continuously observed for at least `min_alive_seconds`.
    - If it disappears and was not exiting via far left/right, keep for `persist_seconds`.
    - Position comes from prediction data (`predicted_tracks`).
    """

    def __init__(
        self,
        frame_width: int,
        min_alive_seconds: float = config.LONG_PERSIST_MIN_ALIVE_SECONDS,
        persist_seconds: float = config.LONG_PERSIST_SECONDS,
        edge_margin_px: int = config.LONG_PERSIST_EDGE_MARGIN_PX,
    ):
        self.frame_width = frame_width
        self.min_alive_seconds = min_alive_seconds
        self.persist_seconds = persist_seconds
        self.edge_margin_px = edge_margin_px
        self._life: Dict[int, _TrackLife] = {}

    def _is_side_exit(self, previous_x: float, predicted_x: float) -> bool:
        left_edge = self.edge_margin_px
        right_edge = self.frame_width - self.edge_margin_px

        exiting_left = previous_x <= left_edge and predicted_x <= previous_x
        exiting_right = previous_x >= right_edge and predicted_x >= previous_x
        out_of_bounds = predicted_x < 0 or predicted_x > self.frame_width
        return exiting_left or exiting_right or out_of_bounds

    def observe(self, detections: List[Detection], now: float) -> None:
        """Update lifecycle info from currently observed detections."""
        # Update lifecycle info for tracks we currently observe.
        for det in detections:
            if det.track_id is None:
                continue
            life = self._life.get(det.track_id)
            if life is None:
                self._life[det.track_id] = _TrackLife(first_seen=now, last_seen=now, last_x=det.x)
            else:
                life.last_seen = now
                life.last_x = det.x

    def extend(self, predicted_tracks: List[Detection], now: float) -> List[Detection]:
        """Return long-lived persisted detections based on prediction positions."""
        predicted_by_id = {
            d.track_id: d for d in predicted_tracks if d.track_id is not None
        }

        out: List[Detection] = []
        for track_id, life in list(self._life.items()):
            alive_for = life.last_seen - life.first_seen
            missing_for = now - life.last_seen
            if alive_for < self.min_alive_seconds:
                continue
            if missing_for > self.persist_seconds:
                self._life.pop(track_id, None)
                continue

            predicted = predicted_by_id.get(track_id)
            if predicted is None:
                continue
            if self._is_side_exit(life.last_x, predicted.x):
                self._life.pop(track_id, None)
                continue

            out.append(predicted)

        return out

    def apply(self, detections: List[Detection], predicted_tracks: List[Detection], now: float) -> List[Detection]:
        """Compatibility API: observe current detections and return long-lived extensions."""
        self.observe(detections, now=now)
        return self.extend(predicted_tracks=predicted_tracks, now=now)
