"""Real-environment CV benchmark for batched multi-stream inference.

Opt-in only. This test loads the real detector/model and measures:
- End-to-end batched inference across multiple simulated streams
- A warmed direct-model batched baseline using the same detector
- A warmed direct-model sequential single-frame baseline
- Whether all stream payloads came from the same batch window

Run explicitly:
    REAL_CV_BENCHMARK=1 uv run pytest -q tests/test_inference_thread_real_environment.py -s
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import numpy as np
import pytest

from common.config import MODELS_DIR
from cv.detectors import RTDETRDetector
from cv.inference_thread import InferenceThread
from cv.performance import DecodedFrameTelemetry, now_epoch_ms


class CapturingPublisher:
    def __init__(self):
        self._messages: list[tuple[str, dict]] = []
        self._lock = threading.Lock()

    def publish(self, stream_id: str, payload: dict) -> bool:
        with self._lock:
            self._messages.append((stream_id, payload))
        return True

    def detection_messages(self) -> list[tuple[str, dict]]:
        with self._lock:
            return [item for item in self._messages if item[1].get("type") == "detections"]

    def wait_for_detections(self, expected_count: int, timeout_s: float = 30.0) -> list[tuple[str, dict]]:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            detections = self.detection_messages()
            if len(detections) >= expected_count:
                return detections
            time.sleep(0.01)
        raise AssertionError(f"Timed out waiting for {expected_count} detection payloads")


class FakeDecodeThread:
    def __init__(self, frame: np.ndarray, frame_index: int, fps: float = 25.0):
        self._telemetry = DecodedFrameTelemetry(
            frame=frame,
            frame_index=frame_index,
            timestamp_ms=float(frame_index * 40),
            decoded_at_ms=now_epoch_ms(),
        )
        self._fps = fps
        self._width = frame.shape[1]
        self._height = frame.shape[0]
        self._alive = True

    def get_latest_telemetry(self) -> DecodedFrameTelemetry:
        return self._telemetry

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    @property
    def is_alive(self) -> bool:
        return self._alive


class PassThroughTrackerRegistry:
    """Use detector parsing directly to avoid device-specific ByteTrack issues."""

    def __init__(self, detector: RTDETRDetector):
        self._detector = detector

    def update(self, _stream_id: str, results: object):
        return self._detector._parse_results(results, track=False)

    def remove(self, _stream_id: str) -> None:
        pass


def _require_real_cv_env() -> None:
    if os.getenv("REAL_CV_BENCHMARK") != "1":
        pytest.skip("Set REAL_CV_BENCHMARK=1 to run the real CV benchmark")

    model_path = MODELS_DIR / RTDETRDetector.DEFAULT_MODEL
    if not model_path.exists():
        pytest.skip(f"Model file missing: {model_path}")


def _make_stream_frame(index: int, size: int = 640) -> np.ndarray:
    """Build a deterministic synthetic frame so each stream is visually distinct."""
    frame = np.zeros((size, size, 3), dtype=np.uint8)

    # Distinct background tint per stream
    frame[..., 0] = (40 * (index + 1)) % 255
    frame[..., 1] = (85 * (index + 2)) % 255
    frame[..., 2] = (120 * (index + 3)) % 255

    # Add simple geometric structure so the input is not just flat color.
    inset = 40 + index * 20
    frame[inset:size - inset, inset:size - inset, 1] = 255
    frame[size // 3 : size // 3 + 60, 80:size - 80, 2] = 220
    frame[80:size - 80, size // 2 - 20 : size // 2 + 20, 0] = 200
    return frame


def _measure_sequential_predict(detector: RTDETRDetector, frames: list[np.ndarray]) -> tuple[float, list[int]]:
    started = time.monotonic()
    result_lengths: list[int] = []
    for frame in frames:
        results = detector.predict_batch([frame])
        result_lengths.append(len(results))
    elapsed_ms = (time.monotonic() - started) * 1000.0
    return elapsed_ms, result_lengths


def _measure_direct_batch_predict(detector: RTDETRDetector, frames: list[np.ndarray]) -> tuple[float, int]:
    started = time.monotonic()
    results = detector.predict_batch(frames)
    elapsed_ms = (time.monotonic() - started) * 1000.0
    return elapsed_ms, len(results)


def test_real_environment_batched_inference_benchmark(monkeypatch, record_property):
    _require_real_cv_env()
    monkeypatch.setattr("cv.inference_thread.MAX_INFERENCE_BATCH_SIZE", 4)

    frames = [_make_stream_frame(index) for index in range(4)]
    detector = RTDETRDetector()
    detector.predict_batch([frames[0]])
    detector.predict_batch(frames)
    publisher = CapturingPublisher()
    inference = InferenceThread(detector, publisher)
    inference._tracker_registry = PassThroughTrackerRegistry(detector)

    for index, frame in enumerate(frames):
        stream_id = f"real-stream-{index}"
        inference.register_stream(stream_id, FakeDecodeThread(frame=frame, frame_index=index))
        inference.add_active_stream(stream_id)

    batch_started = time.monotonic()
    inference.start()
    try:
        detections = publisher.wait_for_detections(expected_count=4, timeout_s=30.0)
    finally:
        inference.stop()
    threaded_batch_elapsed_ms = (time.monotonic() - batch_started) * 1000.0

    direct_batch_elapsed_ms, direct_batch_result_count = _measure_direct_batch_predict(detector, frames)
    sequential_elapsed_ms, sequential_result_lengths = _measure_sequential_predict(detector, frames)

    stream_ids = {stream_id for stream_id, _payload in detections[:4]}
    assert stream_ids == {"real-stream-0", "real-stream-1", "real-stream-2", "real-stream-3"}

    perf = [payload["performance"] for _stream_id, payload in detections[:4]]
    started_values = {item["inference_started_at_ms"] for item in perf}
    completed_values = {item["inference_completed_at_ms"] for item in perf}
    assert len(started_values) == 1
    assert len(completed_values) == 1

    batch_inference_duration_ms = perf[0]["inference_duration_ms"]
    threaded_batch_per_frame_ms = threaded_batch_elapsed_ms / 4.0
    direct_batch_per_frame_ms = direct_batch_elapsed_ms / 4.0
    sequential_per_frame_ms = sequential_elapsed_ms / 4.0
    direct_speedup_vs_sequential = (
        sequential_elapsed_ms / direct_batch_elapsed_ms if direct_batch_elapsed_ms > 0 else 0.0
    )
    threaded_speedup_vs_sequential = (
        sequential_elapsed_ms / threaded_batch_elapsed_ms if threaded_batch_elapsed_ms > 0 else 0.0
    )

    record_property("device", detector.device)
    record_property("threaded_batch_elapsed_ms", round(threaded_batch_elapsed_ms, 2))
    record_property("batch_inference_duration_ms", round(batch_inference_duration_ms, 2))
    record_property("threaded_batch_per_frame_ms", round(threaded_batch_per_frame_ms, 2))
    record_property("direct_batch_elapsed_ms", round(direct_batch_elapsed_ms, 2))
    record_property("direct_batch_per_frame_ms", round(direct_batch_per_frame_ms, 2))
    record_property("direct_batch_result_count", direct_batch_result_count)
    record_property("sequential_elapsed_ms", round(sequential_elapsed_ms, 2))
    record_property("sequential_per_frame_ms", round(sequential_per_frame_ms, 2))
    record_property("direct_speedup_vs_sequential", round(direct_speedup_vs_sequential, 3))
    record_property("threaded_speedup_vs_sequential", round(threaded_speedup_vs_sequential, 3))
    record_property("sequential_result_lengths", sequential_result_lengths)

    print(
        "\nreal-cv-benchmark:",
        {
            "device": detector.device,
            "threaded_batch_elapsed_ms": round(threaded_batch_elapsed_ms, 2),
            "batch_inference_duration_ms": round(batch_inference_duration_ms, 2),
            "threaded_batch_per_frame_ms": round(threaded_batch_per_frame_ms, 2),
            "direct_batch_elapsed_ms": round(direct_batch_elapsed_ms, 2),
            "direct_batch_per_frame_ms": round(direct_batch_per_frame_ms, 2),
            "direct_batch_result_count": direct_batch_result_count,
            "sequential_elapsed_ms": round(sequential_elapsed_ms, 2),
            "sequential_per_frame_ms": round(sequential_per_frame_ms, 2),
            "direct_speedup_vs_sequential": round(direct_speedup_vs_sequential, 3),
            "threaded_speedup_vs_sequential": round(threaded_speedup_vs_sequential, 3),
            "sequential_result_lengths": sequential_result_lengths,
        },
    )

    assert threaded_batch_elapsed_ms > 0
    assert direct_batch_elapsed_ms > 0
    assert sequential_elapsed_ms > 0
    assert batch_inference_duration_ms > 0
    assert direct_batch_result_count == 4
