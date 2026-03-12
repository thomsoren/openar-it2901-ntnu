"""Helpers for real streaming and detection performance telemetry."""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np


def now_epoch_ms() -> float:
    return time.time() * 1000.0


@dataclass(frozen=True)
class DecodedFrameTelemetry:
    frame: np.ndarray | None
    frame_index: int
    timestamp_ms: float
    decoded_at_ms: float


def build_detection_performance_payload(
    *,
    source_fps: float,
    inference_fps: float,
    decoded_at_ms: float,
    inference_started_at_ms: float,
    inference_completed_at_ms: float,
    published_at_ms: float,
    skip_interval: int = 1,
) -> dict[str, float | int]:
    decode_to_inference_start_ms = max(0.0, inference_started_at_ms - decoded_at_ms)
    inference_duration_ms = max(0.0, inference_completed_at_ms - inference_started_at_ms)
    publish_duration_ms = max(0.0, published_at_ms - inference_completed_at_ms)
    total_detection_latency_ms = max(0.0, published_at_ms - decoded_at_ms)
    effective_detection_fps = round(inference_fps / skip_interval, 2) if skip_interval > 0 else 0.0

    return {
        "source_fps": round(source_fps, 2),
        "detection_fps": round(inference_fps, 2),
        "effective_detection_fps": effective_detection_fps,
        "skip_interval": skip_interval,
        "decoded_at_ms": round(decoded_at_ms, 3),
        "inference_started_at_ms": round(inference_started_at_ms, 3),
        "inference_completed_at_ms": round(inference_completed_at_ms, 3),
        "published_at_ms": round(published_at_ms, 3),
        "decode_to_inference_start_ms": round(decode_to_inference_start_ms, 3),
        "inference_duration_ms": round(inference_duration_ms, 3),
        "publish_duration_ms": round(publish_duration_ms, 3),
        "total_detection_latency_ms": round(total_detection_latency_ms, 3),
    }
