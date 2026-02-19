"""Prediction component for smooth fixed-rate publishing."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from common.types import Detection
from . import config


@dataclass
class _TrackState:
    x: float
    y: float
    vx: float
    vy: float
    width: float
    height: float
    confidence: float
    class_id: int | None
    class_name: str | None
    last_seen: float
    last_update: float


class DetectionPrediction:
    """Predict short-term positions with soft measurement correction per track id."""

    def __init__(self):
        self._tracks: Dict[int, _TrackState] = {}

    @staticmethod
    def _clamp_speed(vx: float, vy: float) -> tuple[float, float]:
        speed_sq = (vx * vx) + (vy * vy)
        max_sq = config.PREDICTION_MAX_SPEED_PX_PER_SEC ** 2
        if speed_sq <= max_sq:
            return vx, vy
        scale = (max_sq / speed_sq) ** 0.5
        return vx * scale, vy * scale

    def _predict_to(self, now: float) -> None:
        for state in self._tracks.values():
            dt = now - state.last_update
            if dt <= 0:
                continue

            dt_clamped = min(dt, config.PREDICTION_MAX_DT_SEC)
            state.x += state.vx * dt_clamped
            state.y += state.vy * dt_clamped

            decay = config.PREDICTION_VELOCITY_DECAY_PER_SEC ** dt_clamped
            state.vx *= decay
            state.vy *= decay
            state.vx, state.vy = self._clamp_speed(state.vx, state.vy)
            state.last_update = now

    def _expire(self, now: float) -> None:
        stale = [tid for tid, state in self._tracks.items() if (now - state.last_seen) > config.PREDICTION_MAX_AGE_SEC]
        for tid in stale:
            self._tracks.pop(tid, None)

    def ingest(self, detections: List[Detection], now: float) -> None:
        """Update internal motion state from measured detections."""
        self._predict_to(now)
        self._expire(now)

        for det in detections:
            if det.track_id is None:
                continue

            state = self._tracks.get(det.track_id)
            if state is None:
                self._tracks[det.track_id] = (
                    _TrackState(
                        x=det.x,
                        y=det.y,
                        vx=0.0,
                        vy=0.0,
                        width=det.width,
                        height=det.height,
                        confidence=det.confidence,
                        class_id=det.class_id,
                        class_name=det.class_name,
                        last_seen=now,
                        last_update=now,
                    )
                )
                continue

            # Current state has already been predicted to `now`; blend toward measurement.
            prev_x = state.x
            prev_y = state.y
            prev_seen = state.last_seen
            state.x = (config.PREDICTION_POS_ALPHA * det.x) + ((1.0 - config.PREDICTION_POS_ALPHA) * state.x)
            state.y = (config.PREDICTION_POS_ALPHA * det.y) + ((1.0 - config.PREDICTION_POS_ALPHA) * state.y)
            state.width = (config.PREDICTION_SIZE_ALPHA * det.width) + ((1.0 - config.PREDICTION_SIZE_ALPHA) * state.width)
            state.height = (config.PREDICTION_SIZE_ALPHA * det.height) + ((1.0 - config.PREDICTION_SIZE_ALPHA) * state.height)
            state.confidence = max(det.confidence, state.confidence * config.PREDICTION_CONFIDENCE_DECAY)
            state.class_id = det.class_id
            state.class_name = det.class_name
            state.last_seen = now
            state.last_update = now

            dt = max(1e-3, now - prev_seen)
            if dt >= config.PREDICTION_MIN_VEL_DT_SEC:
                measured_vx = (state.x - prev_x) / dt
                measured_vy = (state.y - prev_y) / dt
                state.vx = (config.PREDICTION_VEL_ALPHA * measured_vx) + ((1.0 - config.PREDICTION_VEL_ALPHA) * state.vx)
                state.vy = (config.PREDICTION_VEL_ALPHA * measured_vy) + ((1.0 - config.PREDICTION_VEL_ALPHA) * state.vy)
                state.vx, state.vy = self._clamp_speed(state.vx, state.vy)

    def apply(self, detections: List[Detection], now: float) -> List[Detection]:
        """Compatibility wrapper with existing component style."""
        self.ingest(detections, now=now)
        return detections

    def predict_all(self, now: float) -> List[Detection]:
        """Return predicted positions for all live tracks at time `now`."""
        self._predict_to(now)
        self._expire(now)
        predicted: List[Detection] = []
        for track_id, state in self._tracks.items():
            predicted.append(
                Detection(
                    x=state.x,
                    y=state.y,
                    width=state.width,
                    height=state.height,
                    confidence=state.confidence,
                    class_id=state.class_id,
                    class_name=state.class_name,
                    track_id=track_id,
                )
            )
        return predicted
