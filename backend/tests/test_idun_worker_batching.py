"""Tests for the IDUN inference worker's batched multi-stream logic.

These tests exercise the _WorkerState, _receive_task, and _inference_task
coroutines without a real GPU or WebSocket connection. The detector and
WebSocket are faked.
"""
from __future__ import annotations

import asyncio
import json
import struct
import time
from unittest.mock import MagicMock

import cv2
import numpy as np
import pytest


def _build_binary_frame(stream_id: str, frame_index: int = 0, width: int = 64, height: int = 48) -> bytes:
    frame = np.full((height, width, 3), frame_index % 256, dtype=np.uint8)
    ok, jpeg_buf = cv2.imencode(".jpg", frame)
    assert ok
    header = json.dumps({
        "type": "frame",
        "stream_id": stream_id,
        "frame_index": frame_index,
        "timestamp_ms": frame_index * 40.0,
        "fps": 25.0,
        "decoded_at_ms": time.time() * 1000,
    }).encode()
    return struct.pack(">I", len(header)) + header + jpeg_buf.tobytes()


class FakeDetection:
    def __init__(self, stream_id: str):
        self._data = {
            "x": 10.0, "y": 20.0, "width": 30.0, "height": 40.0,
            "confidence": 0.9, "class_id": 0, "class_name": "boat",
            "track_id": 1,
        }

    def model_dump(self) -> dict:
        return dict(self._data)


class FakeDetector:
    def __init__(self, sleep_s: float = 0.0):
        self.sleep_s = sleep_s
        self.batch_sizes: list[int] = []
        self.tracker_streams: list[str] = []
        self.reset_streams: list[str] = []

    def predict_batch(self, frames: list[np.ndarray]) -> list[object]:
        self.batch_sizes.append(len(frames))
        if self.sleep_s > 0:
            time.sleep(self.sleep_s)
        return [MagicMock() for _ in frames]

    def update_tracker(self, stream_id: str, results: object) -> list[FakeDetection]:
        self.tracker_streams.append(stream_id)
        return [FakeDetection(stream_id)]

    def reset_tracker_for_stream(self, stream_id: str) -> None:
        self.reset_streams.append(stream_id)


class FakeWebSocket:
    """Async iterator that yields queued messages, captures sent responses."""

    def __init__(self):
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[str | bytes] = []

    async def send(self, data: str) -> None:
        self.sent.append(data)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            msg = await asyncio.wait_for(self.incoming.get(), timeout=2.0)
        except asyncio.TimeoutError:
            raise StopAsyncIteration
        if msg is StopAsyncIteration:
            raise StopAsyncIteration
        return msg

    def detection_responses(self) -> list[dict]:
        results = []
        for msg in self.sent:
            if isinstance(msg, str):
                parsed = json.loads(msg)
                if parsed.get("type") == "detections":
                    results.append(parsed)
        return results


# --- Import the worker module pieces ---
import sys
from pathlib import Path

IDUN_DIR = Path(__file__).resolve().parents[1].parent / "idun"
if str(IDUN_DIR) not in sys.path:
    sys.path.insert(0, str(IDUN_DIR))

from inference_worker import (
    _WorkerState,
    _inference_task,
    _receive_task,
    shutdown_event,
)


def _run(coro):
    """Run an async coroutine synchronously (no pytest-asyncio needed)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture(autouse=True)
def reset_shutdown():
    shutdown_event.clear()
    yield
    shutdown_event.set()


# ---------- _WorkerState tests ----------

def test_worker_state_initial_state():
    detector = FakeDetector()
    state = _WorkerState(detector)
    assert state.is_paused is True
    assert state.active_streams == set()
    assert state.pending_frames == {}


# ---------- _receive_task control message tests ----------

def test_receive_handles_stream_added():
    detector = FakeDetector()
    state = _WorkerState(detector)
    ws = FakeWebSocket()

    ws.incoming.put_nowait(json.dumps({
        "type": "stream_added",
        "stream_id": "s1",
        "width": 640,
        "height": 480,
        "fps": 25.0,
    }))
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert "s1" in state.active_streams
    assert "s1" in detector.reset_streams
    assert state.per_stream_inference_count.get("s1") == 0


def test_receive_handles_stream_removed():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.active_streams.add("s1")
    state.pending_frames["s1"] = ({}, np.zeros((48, 64, 3), dtype=np.uint8))

    ws = FakeWebSocket()
    ws.incoming.put_nowait(json.dumps({
        "type": "stream_removed",
        "stream_id": "s1",
    }))
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert "s1" not in state.active_streams
    assert "s1" not in state.pending_frames
    assert "s1" in detector.reset_streams


def test_receive_handles_resume_with_stream_ids():
    detector = FakeDetector()
    state = _WorkerState(detector)
    ws = FakeWebSocket()

    ws.incoming.put_nowait(json.dumps({
        "type": "resume",
        "stream_ids": ["s1", "s2"],
    }))
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert state.active_streams == {"s1", "s2"}
    assert state.is_paused is False


def test_receive_handles_resume_backward_compat():
    detector = FakeDetector()
    state = _WorkerState(detector)
    ws = FakeWebSocket()

    ws.incoming.put_nowait(json.dumps({
        "type": "resume",
        "stream_id": "s1",
    }))
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert "s1" in state.active_streams
    assert state.is_paused is False


def test_receive_handles_pause():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    ws = FakeWebSocket()

    ws.incoming.put_nowait(json.dumps({"type": "pause"}))
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert state.is_paused is True


def test_receive_handles_stream_changed_backward_compat():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.active_streams = {"old-stream"}
    ws = FakeWebSocket()

    ws.incoming.put_nowait(json.dumps({
        "type": "stream_changed",
        "stream_id": "new-stream",
        "width": 1920,
        "height": 1080,
        "fps": 30.0,
    }))
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert state.active_streams == {"new-stream"}
    assert "old-stream" in detector.reset_streams
    assert "new-stream" in detector.reset_streams


def test_receive_handles_ping():
    detector = FakeDetector()
    state = _WorkerState(detector)
    ws = FakeWebSocket()

    ws.incoming.put_nowait(json.dumps({"type": "ping"}))
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    pong_msgs = [json.loads(m) for m in ws.sent if isinstance(m, str)]
    assert any(m.get("type") == "pong" for m in pong_msgs)


def test_receive_decodes_binary_frame_into_buffer():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams.add("s1")
    ws = FakeWebSocket()

    frame_msg = _build_binary_frame("s1", frame_index=5)
    ws.incoming.put_nowait(frame_msg)
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert "s1" in state.pending_frames
    header, frame = state.pending_frames["s1"]
    assert header["frame_index"] == 5
    assert frame is not None
    assert frame.shape[2] == 3


def test_receive_drops_frame_for_inactive_stream():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams.add("s1")
    ws = FakeWebSocket()

    frame_msg = _build_binary_frame("s2", frame_index=1)
    ws.incoming.put_nowait(frame_msg)
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert "s2" not in state.pending_frames


def test_receive_drops_frame_when_paused():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = True
    state.active_streams.add("s1")
    ws = FakeWebSocket()

    frame_msg = _build_binary_frame("s1", frame_index=1)
    ws.incoming.put_nowait(frame_msg)
    ws.incoming.put_nowait(StopAsyncIteration)

    _run(_receive_task(ws, state))

    assert "s1" not in state.pending_frames


# ---------- _inference_task batching tests ----------

def _run_inference_with_timeout(ws, state, timeout_s=0.2):
    async def _go():
        async def stop():
            await asyncio.sleep(timeout_s)
            shutdown_event.set()

        await asyncio.gather(
            _inference_task(ws, state),
            stop(),
        )

    _run(_go())


def test_inference_batches_multiple_streams():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams = {"s1", "s2", "s3"}
    ws = FakeWebSocket()

    for sid in ["s1", "s2", "s3"]:
        header = {"stream_id": sid, "frame_index": 1, "timestamp_ms": 40.0, "fps": 25.0}
        frame = np.full((48, 64, 3), 1, dtype=np.uint8)
        state.pending_frames[sid] = (header, frame)
    state.frame_available.set()

    _run_inference_with_timeout(ws, state)

    assert len(detector.batch_sizes) >= 1
    assert detector.batch_sizes[0] == 3

    responses = ws.detection_responses()
    assert len(responses) >= 3
    responded_streams = {r["stream_id"] for r in responses}
    assert responded_streams == {"s1", "s2", "s3"}


def test_inference_sends_detection_response_per_stream():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams = {"s1"}
    ws = FakeWebSocket()

    header = {"stream_id": "s1", "frame_index": 42, "timestamp_ms": 1680.0, "fps": 25.0}
    frame = np.full((48, 64, 3), 42, dtype=np.uint8)
    state.pending_frames["s1"] = (header, frame)
    state.frame_available.set()

    _run_inference_with_timeout(ws, state)

    responses = ws.detection_responses()
    assert len(responses) >= 1
    resp = responses[0]
    assert resp["stream_id"] == "s1"
    assert resp["frame_index"] == 42
    assert resp["type"] == "detections"
    assert len(resp["vessels"]) == 1


def test_inference_skips_frames_for_removed_stream():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams = {"s1"}
    ws = FakeWebSocket()

    header = {"stream_id": "s2", "frame_index": 1, "timestamp_ms": 40.0, "fps": 25.0}
    frame = np.full((48, 64, 3), 1, dtype=np.uint8)
    state.pending_frames["s2"] = (header, frame)
    state.frame_available.set()

    _run_inference_with_timeout(ws, state)

    assert len(detector.batch_sizes) == 0
    assert len(ws.detection_responses()) == 0


def test_inference_flushes_partial_batch_after_timeout():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams = {"s1", "s2", "s3"}
    ws = FakeWebSocket()

    header = {"stream_id": "s1", "frame_index": 1, "timestamp_ms": 40.0, "fps": 25.0}
    frame = np.full((48, 64, 3), 1, dtype=np.uint8)
    state.pending_frames["s1"] = (header, frame)
    state.frame_available.set()

    _run_inference_with_timeout(ws, state, timeout_s=0.3)

    assert len(detector.batch_sizes) >= 1
    assert detector.batch_sizes[0] == 1

    responses = ws.detection_responses()
    assert len(responses) >= 1
    assert responses[0]["stream_id"] == "s1"


def test_inference_batches_are_capped_at_max_batch_size(monkeypatch):
    monkeypatch.setattr("inference_worker.MAX_BATCH_SIZE", 2)

    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams = {"s1", "s2", "s3", "s4"}
    ws = FakeWebSocket()

    for sid in ["s1", "s2", "s3", "s4"]:
        header = {"stream_id": sid, "frame_index": 1, "timestamp_ms": 40.0, "fps": 25.0}
        frame = np.full((48, 64, 3), 1, dtype=np.uint8)
        state.pending_frames[sid] = (header, frame)
    state.frame_available.set()

    _run_inference_with_timeout(ws, state, timeout_s=0.3)

    assert len(detector.batch_sizes) >= 1
    assert detector.batch_sizes[0] <= 2


def test_inference_runs_predict_batch_not_detect():
    detector = FakeDetector()
    state = _WorkerState(detector)
    state.is_paused = False
    state.active_streams = {"s1", "s2"}
    ws = FakeWebSocket()

    for sid in ["s1", "s2"]:
        header = {"stream_id": sid, "frame_index": 1, "timestamp_ms": 40.0, "fps": 25.0}
        frame = np.full((48, 64, 3), 1, dtype=np.uint8)
        state.pending_frames[sid] = (header, frame)
    state.frame_available.set()

    _run_inference_with_timeout(ws, state)

    assert len(detector.batch_sizes) >= 1
    assert detector.batch_sizes[0] == 2
    assert len(detector.tracker_streams) >= 2
    assert set(detector.tracker_streams[:2]) == {"s1", "s2"}
