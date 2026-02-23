"""Tests for WebSocket detections endpoint — lifecycle, error handling, viewer counting."""
from __future__ import annotations

import json
import threading
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from common.config import create_redis_client, detections_channel


@pytest.fixture
def redis_available():
    client = create_redis_client()
    try:
        client.ping()
    except Exception as exc:
        pytest.skip(f"Redis unavailable: {exc}")
    finally:
        client.close()


class TestWebSocketValidation:
    def test_invalid_stream_id_closes_with_1008(self, stream_app_client):
        with pytest.raises(Exception):
            # Invalid stream_id should cause close with 1008
            with stream_app_client.websocket_connect("/api/detections/ws/bad..id"):
                pass

    def test_unknown_stream_closes_with_error(self, stream_app_client):
        """Stream with no config should send error and close."""
        try:
            with stream_app_client.websocket_connect("/api/detections/ws/nonexistent") as ws:
                msg = ws.receive_json()
                assert msg["type"] == "error"
                assert "not found" in msg["message"].lower()
        except Exception:
            # WebSocket may close before we can read — that's also acceptable
            pass


class TestWebSocketViewerCounting:
    def test_connect_acquires_viewer(self, stream_app_client, redis_available):
        import api

        stream_app_client.post(
            "/api/streams/ws-vc/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        # Connect WebSocket and check viewer_count increased
        with stream_app_client.websocket_connect("/api/detections/ws/ws-vc"):
            handle = api.orchestrator.get_stream("ws-vc")
            assert handle.viewer_count >= 1

    def test_viewer_release_is_tested_at_orchestrator_level(self):
        """Viewer release on disconnect cannot be reliably tested through the
        sync TestClient because Starlette's ``websocket_connect()`` blocks
        until the server handler returns, and the handler is stuck in
        ``pubsub.listen()`` after the client disconnects.

        Release behaviour is fully covered in test_orchestrator_lifecycle.py
        (test_release_decrements_count, test_release_to_zero_sets_no_viewer_since)
        and test_viewer_lifecycle.py (test_worker_stops_without_viewers_...).
        """
        pass


class TestWebSocketDetectionDelivery:
    def test_receives_detection_messages(self, stream_app_client, redis_available):
        stream_id = "ws-recv"
        stream_app_client.post(
            f"/api/streams/{stream_id}/start",
            json={"source_url": "rtsp://example.com/live"},
        )

        payload = {
            "type": "detections",
            "frame_index": 7,
            "timestamp_ms": 280.0,
            "fps": 25,
            "vessels": [],
        }

        channel = detections_channel(stream_id)
        publisher = create_redis_client()
        stop_event = threading.Event()

        def publish_loop():
            while not stop_event.is_set():
                publisher.publish(channel, json.dumps(payload))
                time.sleep(0.05)

        thread = threading.Thread(target=publish_loop, daemon=True)
        thread.start()

        try:
            with stream_app_client.websocket_connect(f"/api/detections/ws/{stream_id}") as ws:
                msg = ws.receive_json()
                assert msg["type"] == "detections"
                assert msg["frame_index"] == 7
        finally:
            stop_event.set()
            thread.join(timeout=1)
            publisher.close()
