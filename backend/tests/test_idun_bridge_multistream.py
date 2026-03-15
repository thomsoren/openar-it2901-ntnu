"""Tests for the IdunBridge multi-stream sender and receiver logic.

These tests verify that the bridge correctly:
- Sends stream_added/stream_removed control messages
- Sends frames from multiple active streams
- Filters stale detections in the receiver
- Publishes detections per-stream
"""
from __future__ import annotations

import asyncio
import json
import struct
import time
from contextlib import suppress

import numpy as np
import pytest
from starlette.websockets import WebSocketDisconnect, WebSocketState

from cv.idun.noop_inference import NoopInferenceThread
from cv.performance import DecodedFrameTelemetry, now_epoch_ms


class StubDecodeThread:
    def __init__(self, stream_id: str, frame_index: int = 1, fps: float = 25.0):
        self._stream_id = stream_id
        self._frame_index = frame_index
        self._fps = fps
        self._width = 640
        self._height = 480
        self.is_alive = True

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    def get_latest_telemetry(self) -> DecodedFrameTelemetry:
        return DecodedFrameTelemetry(
            frame=np.full((self._height, self._width, 3), self._frame_index % 256, dtype=np.uint8),
            frame_index=self._frame_index,
            timestamp_ms=self._frame_index * 40.0,
            decoded_at_ms=now_epoch_ms(),
        )

    def advance_frame(self) -> None:
        self._frame_index += 1


class CapturingPublisher:
    def __init__(self):
        self.messages: list[tuple[str, dict]] = []

    def publish(self, stream_id: str, payload: dict) -> None:
        self.messages.append((stream_id, payload))

    def detection_messages(self) -> list[tuple[str, dict]]:
        return [(sid, p) for sid, p in self.messages if p.get("type") == "detections"]

    def ready_messages(self) -> list[tuple[str, dict]]:
        return [(sid, p) for sid, p in self.messages if p.get("type") == "ready"]


class FakeWorkerWebSocket:
    def __init__(self, received_texts: list[str] | None = None):
        self._received_texts = list(received_texts or [])
        self.sent_texts: list[str] = []
        self.sent_bytes: list[bytes] = []
        self.closed = False
        self.close_code: int | None = None
        self.close_reason: str | None = None
        self.client_state = WebSocketState.CONNECTED

    async def send_text(self, data: str) -> None:
        self.sent_texts.append(data)

    async def send_bytes(self, data: bytes) -> None:
        self.sent_bytes.append(data)

    async def receive_text(self) -> str:
        if self._received_texts:
            return self._received_texts.pop(0)
        raise WebSocketDisconnect()

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closed = True
        self.close_code = code
        self.close_reason = reason
        self.client_state = WebSocketState.DISCONNECTED


def _decode_frame_message(message: bytes) -> dict:
    header_len = struct.unpack(">I", message[:4])[0]
    return json.loads(message[4 : 4 + header_len])


# ---------- NoopInferenceThread + Bridge integration tests ----------

def test_noop_tracks_multiple_streams_for_bridge():
    noop = NoopInferenceThread()
    dt1 = StubDecodeThread("s1")
    dt2 = StubDecodeThread("s2")

    noop.register_stream("s1", dt1)
    noop.register_stream("s2", dt2)
    noop.add_active_stream("s1")
    noop.add_active_stream("s2")

    assert noop.get_active_streams() == {"s1", "s2"}
    assert noop.get_decode_thread("s1") is dt1
    assert noop.get_decode_thread("s2") is dt2


def test_bridge_sender_announces_active_streams_and_publishes_ready_payloads():
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)
        dt1 = StubDecodeThread("s1", frame_index=1)
        dt2 = StubDecodeThread("s2", frame_index=2)
        noop.register_stream("s1", dt1)
        noop.register_stream("s2", dt2)
        noop.add_active_stream("s1")
        noop.add_active_stream("s2")

        websocket = FakeWorkerWebSocket()
        task = asyncio.create_task(bridge._sender_loop(websocket))
        try:
            await asyncio.sleep(0.03)
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        sent_texts = [json.loads(message) for message in websocket.sent_texts]
        sent_types = [message["type"] for message in sent_texts]
        assert sent_types.count("stream_added") == 2
        assert "resume" in sent_types

        added_streams = {message["stream_id"] for message in sent_texts if message["type"] == "stream_added"}
        assert added_streams == {"s1", "s2"}

        ready_streams = {stream_id for stream_id, _payload in publisher.ready_messages()}
        assert ready_streams == {"s1", "s2"}

        frame_headers = [_decode_frame_message(message) for message in websocket.sent_bytes]
        frame_streams = {header["stream_id"] for header in frame_headers}
        assert frame_streams == {"s1", "s2"}

    asyncio.run(run_test())


def test_bridge_sender_announces_removed_stream_and_clears_pending_metrics():
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)
        dt1 = StubDecodeThread("s1", frame_index=1)
        dt2 = StubDecodeThread("s2", frame_index=2)
        noop.register_stream("s1", dt1)
        noop.register_stream("s2", dt2)
        noop.add_active_stream("s1")
        noop.add_active_stream("s2")

        websocket = FakeWorkerWebSocket()
        task = asyncio.create_task(bridge._sender_loop(websocket))
        try:
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline:
                if any(key[0] == "s2" for key in bridge._pending_frame_metrics):
                    break
                await asyncio.sleep(0.01)
            assert any(key[0] == "s2" for key in bridge._pending_frame_metrics)
            noop.remove_active_stream("s2")
            deadline = time.monotonic() + 0.2
            while time.monotonic() < deadline:
                sent_texts = [json.loads(message) for message in websocket.sent_texts]
                if any(
                    message["type"] == "stream_removed" and message["stream_id"] == "s2"
                    for message in sent_texts
                ):
                    break
                await asyncio.sleep(0.01)
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        sent_texts = [json.loads(message) for message in websocket.sent_texts]
        removed_messages = [message for message in sent_texts if message["type"] == "stream_removed"]
        assert removed_messages == [{"type": "stream_removed", "stream_id": "s2"}]
        assert all(key[0] != "s2" for key in bridge._pending_frame_metrics)

    asyncio.run(run_test())


def test_bridge_receiver_publishes_active_stream_detections_with_performance():
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        noop.add_active_stream("s1")
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)
        bridge._pending_frame_metrics[("s1", 7)] = {"decoded_at_ms": 100.0, "source_fps": 25.0}

        websocket = FakeWorkerWebSocket([
            json.dumps({
                "type": "detections",
                "stream_id": "s1",
                "frame_index": 7,
                "timestamp_ms": 280.0,
                "fps": 25.0,
                "vessels": [],
                "performance": {
                    "inference_duration_ms": 12.0,
                },
            }),
        ])

        with pytest.raises(WebSocketDisconnect):
            await bridge._receiver_loop(websocket)

        detections = publisher.detection_messages()
        assert len(detections) == 1
        stream_id, payload = detections[0]
        assert stream_id == "s1"
        assert payload["type"] == "detections"
        assert payload["frame_index"] == 7
        assert payload["performance"]["source_fps"] == 25.0
        assert payload["performance"]["decoded_at_ms"] == 100.0
        assert payload["performance"]["inference_duration_ms"] == 12.0
        assert "frame_sent_at_ms" in payload
        assert bridge._pending_frame_metrics == {}

    asyncio.run(run_test())


def test_bridge_receiver_filters_inactive_stream_detections():
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        noop.add_active_stream("s1")
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)

        websocket = FakeWorkerWebSocket([
            json.dumps({
                "type": "detections",
                "stream_id": "s2",
                "frame_index": 1,
                "timestamp_ms": 40.0,
                "fps": 25.0,
                "vessels": [],
            }),
        ])

        with pytest.raises(WebSocketDisconnect):
            await bridge._receiver_loop(websocket)

        assert publisher.detection_messages() == []

    asyncio.run(run_test())


def test_bridge_only_allows_one_connection():
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)
        bridge.is_connected = True

        websocket = FakeWorkerWebSocket()
        await bridge.handle_worker_connection(websocket)

        assert websocket.closed is True
        assert websocket.close_code == 1013
        assert websocket.close_reason == "Another IDUN worker is already connected"

    asyncio.run(run_test())


def test_bridge_pending_frame_metrics_keyed_by_stream_and_index():
    """Verify metrics dict supports multiple streams."""
    from cv.idun.bridge import IdunBridge

    noop = NoopInferenceThread()
    publisher = CapturingPublisher()
    bridge = IdunBridge(noop, publisher)

    bridge._pending_frame_metrics[("s1", 1)] = {"decoded_at_ms": 100.0, "source_fps": 25.0}
    bridge._pending_frame_metrics[("s2", 1)] = {"decoded_at_ms": 200.0, "source_fps": 30.0}
    bridge._pending_frame_metrics[("s1", 2)] = {"decoded_at_ms": 140.0, "source_fps": 25.0}

    assert len(bridge._pending_frame_metrics) == 3

    popped = bridge._pending_frame_metrics.pop(("s1", 1), None)
    assert popped is not None
    assert popped["decoded_at_ms"] == 100.0
    assert len(bridge._pending_frame_metrics) == 2


def test_bridge_sender_cleans_pending_metrics_when_jpeg_encode_fails(monkeypatch):
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)
        decode_thread = StubDecodeThread("s1")
        noop.register_stream("s1", decode_thread)
        noop.add_active_stream("s1")

        monkeypatch.setattr("cv.idun.bridge.cv2.imencode", lambda *_args, **_kwargs: (False, None))
        websocket = FakeWorkerWebSocket()

        task = asyncio.create_task(bridge._sender_loop(websocket))
        try:
            await asyncio.sleep(0.02)
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        assert bridge._pending_frame_metrics == {}

    asyncio.run(run_test())


def test_bridge_receiver_drops_inactive_detection_and_cleans_pending_metrics():
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        noop.add_active_stream("s1")
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)
        bridge._pending_frame_metrics[("s2", 7)] = {"decoded_at_ms": 100.0, "source_fps": 25.0}

        websocket = FakeWorkerWebSocket([
            json.dumps({
                "type": "detections",
                "stream_id": "s2",
                "frame_index": 7,
                "timestamp_ms": 280.0,
                "fps": 25.0,
                "vessels": [],
            }),
        ])

        with pytest.raises(WebSocketDisconnect):
            await bridge._receiver_loop(websocket)

        assert bridge._pending_frame_metrics == {}
        assert publisher.detection_messages() == []

    asyncio.run(run_test())


def test_bridge_connection_teardown_clears_pending_metrics():
    from cv.idun.bridge import IdunBridge

    async def run_test() -> None:
        noop = NoopInferenceThread()
        publisher = CapturingPublisher()
        bridge = IdunBridge(noop, publisher)
        bridge._pending_frame_metrics[("s1", 1)] = {"decoded_at_ms": 100.0, "source_fps": 25.0}

        websocket = FakeWorkerWebSocket([json.dumps({"type": "ready"})])
        await bridge.handle_worker_connection(websocket)

        assert bridge._pending_frame_metrics == {}
        assert websocket.closed is True

    asyncio.run(run_test())
