from __future__ import annotations

import threading
import time
from types import SimpleNamespace

import numpy as np

from cv.inference_thread import InferenceThread
from cv.performance import DecodedFrameTelemetry, now_epoch_ms


class FakeDetection:
    def __init__(self, class_name: str = "boat"):
        self._payload = {
            "x": 10.0,
            "y": 20.0,
            "width": 30.0,
            "height": 40.0,
            "confidence": 0.95,
            "class_id": 1,
            "class_name": class_name,
            "track_id": 1,
        }

    def model_dump(self) -> dict:
        return dict(self._payload)


class FakeTrackerRegistry:
    def update(self, stream_id: str, _results: object) -> list[FakeDetection]:
        return [FakeDetection(class_name=f"{stream_id}-boat")]

    def remove(self, _stream_id: str) -> None:
        pass


class FakeDetector:
    CLASS_NAME_MAP = {"boat": "boat"}
    BOAT_CLASSES = {1}
    filter_boats = True

    def __init__(self, sleep_s: float = 0.0):
        self.sleep_s = sleep_s
        self.batch_sizes: list[int] = []
        self.call_started_at: list[float] = []

    def predict_batch(self, frames: list[np.ndarray]) -> list[object]:
        self.batch_sizes.append(len(frames))
        self.call_started_at.append(time.monotonic())
        if self.sleep_s > 0:
            time.sleep(self.sleep_s)
        return [{"frame_shape": frame.shape} for frame in frames]


class CapturingPublisher:
    def __init__(self):
        self.messages: list[tuple[str, dict]] = []
        self._lock = threading.Lock()

    def publish(self, stream_id: str, payload: dict) -> None:
        with self._lock:
            self.messages.append((stream_id, payload))

    def detection_messages(self) -> list[tuple[str, dict]]:
        with self._lock:
            return [item for item in self.messages if item[1].get("type") == "detections"]

    def wait_for_detections(self, expected_count: int, timeout_s: float = 1.0) -> list[tuple[str, dict]]:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            detections = self.detection_messages()
            if len(detections) >= expected_count:
                return detections
            time.sleep(0.005)
        raise AssertionError(f"Timed out waiting for {expected_count} detection payloads")


class FakeDecodeThread:
    def __init__(self, frame_index: int, fps: float = 25.0):
        self._telemetry = DecodedFrameTelemetry(
            frame=np.full((48, 64, 3), frame_index, dtype=np.uint8),
            frame_index=frame_index,
            timestamp_ms=float(frame_index * 40),
            decoded_at_ms=now_epoch_ms(),
        )
        self._fps = fps
        self._width = 64
        self._height = 48
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


class MutableFakeDecodeThread:
    def __init__(self, fps: float = 25.0):
        self._fps = fps
        self._width = 64
        self._height = 48
        self._alive = True
        self._lock = threading.Lock()
        self._telemetry = DecodedFrameTelemetry(
            frame=None,
            frame_index=-1,
            timestamp_ms=0.0,
            decoded_at_ms=0.0,
        )

    def set_frame(self, frame_index: int) -> None:
        with self._lock:
            self._telemetry = DecodedFrameTelemetry(
                frame=np.full((48, 64, 3), frame_index, dtype=np.uint8),
                frame_index=frame_index,
                timestamp_ms=float(frame_index * 40),
                decoded_at_ms=now_epoch_ms(),
            )

    def get_latest_telemetry(self) -> DecodedFrameTelemetry:
        with self._lock:
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


def _build_inference_thread(monkeypatch, *, batch_size: int, sleep_s: float = 0.0):
    monkeypatch.setattr("cv.inference_thread.MAX_INFERENCE_BATCH_SIZE", batch_size)
    monkeypatch.setattr(
        "cv.inference_thread.cv_runtime_settings",
        SimpleNamespace(
            inference_wait_no_stream_sec=0.001,
            inference_wait_no_frame_sec=0.001,
            inference_batch_fill_timeout_sec=0.02,
        ),
    )

    detector = FakeDetector(sleep_s=sleep_s)
    publisher = CapturingPublisher()
    inference = InferenceThread(detector, publisher)
    inference._tracker_registry = FakeTrackerRegistry()
    return inference, detector, publisher


def test_inference_thread_batches_four_active_streams_into_one_predict_call(monkeypatch):
    inference, detector, publisher = _build_inference_thread(monkeypatch, batch_size=4, sleep_s=0.03)

    for index in range(4):
        stream_id = f"stream-{index}"
        inference.register_stream(stream_id, FakeDecodeThread(frame_index=index))
        inference.add_active_stream(stream_id)

    inference.start()
    try:
        detections = publisher.wait_for_detections(expected_count=4, timeout_s=1.0)
    finally:
        inference.stop()

    assert detector.batch_sizes
    assert detector.batch_sizes[0] == 4

    stream_ids = {stream_id for stream_id, _payload in detections[:4]}
    assert stream_ids == {"stream-0", "stream-1", "stream-2", "stream-3"}

    for stream_id, payload in detections[:4]:
        assert payload["type"] == "detections"
        assert payload["vessels"][0]["detection"]["class_name"] == f"{stream_id}-boat"
        assert payload["performance"]["inference_duration_ms"] >= 20.0


def test_inference_thread_splits_work_when_active_streams_exceed_batch_size(monkeypatch):
    inference, detector, publisher = _build_inference_thread(monkeypatch, batch_size=4, sleep_s=0.01)

    for index in range(5):
        stream_id = f"stream-{index}"
        inference.register_stream(stream_id, FakeDecodeThread(frame_index=index))
        inference.add_active_stream(stream_id)

    inference.start()
    try:
        detections = publisher.wait_for_detections(expected_count=5, timeout_s=1.0)
    finally:
        inference.stop()

    assert len(detector.batch_sizes) >= 2
    assert detector.batch_sizes[0] == 4
    assert sum(detector.batch_sizes[:2]) >= 5

    delivered_streams = {stream_id for stream_id, _payload in detections[:5]}
    assert delivered_streams == {"stream-0", "stream-1", "stream-2", "stream-3", "stream-4"}


def test_batched_inference_completes_faster_than_a_sequential_baseline(monkeypatch):
    sleep_s = 0.05
    inference, detector, publisher = _build_inference_thread(monkeypatch, batch_size=4, sleep_s=sleep_s)

    for index in range(4):
        stream_id = f"stream-{index}"
        inference.register_stream(stream_id, FakeDecodeThread(frame_index=index))
        inference.add_active_stream(stream_id)

    started_at = time.monotonic()
    inference.start()
    try:
        detections = publisher.wait_for_detections(expected_count=4, timeout_s=1.0)
    finally:
        inference.stop()
    elapsed_s = time.monotonic() - started_at

    sequential_baseline_s = 4 * sleep_s

    assert detector.batch_sizes[0] == 4
    assert elapsed_s < sequential_baseline_s

    inference_durations_ms = [
        payload["performance"]["inference_duration_ms"]
        for _stream_id, payload in detections[:4]
    ]
    assert min(inference_durations_ms) >= sleep_s * 1000 * 0.8


def test_inference_thread_waits_briefly_to_fill_batch_with_late_active_stream(monkeypatch):
    inference, detector, publisher = _build_inference_thread(monkeypatch, batch_size=2)

    immediate = MutableFakeDecodeThread()
    delayed = MutableFakeDecodeThread()
    immediate.set_frame(1)

    inference.register_stream("stream-0", immediate)
    inference.register_stream("stream-1", delayed)
    inference.add_active_stream("stream-0")
    inference.add_active_stream("stream-1")

    inference.start()
    try:
        time.sleep(0.01)
        delayed.set_frame(2)
        detections = publisher.wait_for_detections(expected_count=2, timeout_s=1.0)
    finally:
        inference.stop()

    assert detector.batch_sizes[0] == 2
    delivered_streams = {stream_id for stream_id, _payload in detections[:2]}
    assert delivered_streams == {"stream-0", "stream-1"}


def test_inference_thread_flushes_partial_batch_after_timeout(monkeypatch):
    monkeypatch.setattr("cv.inference_thread.MAX_INFERENCE_BATCH_SIZE", 2)
    monkeypatch.setattr(
        "cv.inference_thread.cv_runtime_settings",
        SimpleNamespace(
            inference_wait_no_stream_sec=0.001,
            inference_wait_no_frame_sec=0.001,
            inference_batch_fill_timeout_sec=0.03,
        ),
    )

    detector = FakeDetector()
    publisher = CapturingPublisher()
    inference = InferenceThread(detector, publisher)
    inference._tracker_registry = FakeTrackerRegistry()

    ready = MutableFakeDecodeThread()
    missing = MutableFakeDecodeThread()
    ready.set_frame(1)

    inference.register_stream("stream-0", ready)
    inference.register_stream("stream-1", missing)
    inference.add_active_stream("stream-0")
    inference.add_active_stream("stream-1")

    started_at = time.monotonic()
    inference.start()
    try:
        detections = publisher.wait_for_detections(expected_count=1, timeout_s=1.0)
    finally:
        inference.stop()
    elapsed_s = time.monotonic() - started_at

    assert detector.batch_sizes[0] == 1
    assert detections[0][0] == "stream-0"
    assert elapsed_s >= 0.025
