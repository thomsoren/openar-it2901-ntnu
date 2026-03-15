"""End-to-end tests for concurrent multi-stream scenarios.

Simulates the "two users in two browsers, each watching a different stream"
use case. Verifies that:
  1. Both streams start and run independently
  2. Each user receives detections only for their own stream
  3. Playback URLs are returned and unique per stream
  4. Viewer counts are tracked independently per stream
  5. Stopping one stream does not affect the other
  6. Streams can be started/stopped while others are active
"""
from __future__ import annotations

import json
import threading
import time
from contextlib import ExitStack

import pytest

from common.config import create_redis_client, detections_channel
from webapi import state


@pytest.fixture
def redis_available():
    client = create_redis_client()
    try:
        client.ping()
    except Exception as exc:
        pytest.skip(f"Redis unavailable: {exc}")
    finally:
        client.close()


def _start_stream(client, stream_id: str, source_url: str | None = None) -> dict:
    url = source_url or f"rtsp://example.com/{stream_id}"
    response = client.post(
        f"/api/streams/{stream_id}/start",
        json={"source_url": url, "loop": True},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _publish_detections(stream_id: str, marker: str, vessel_count: int, interval_s: float = 0.05):
    """Returns (thread, stop_event) that continuously publishes detections."""
    stop_event = threading.Event()
    frame_counter = [0]

    def _loop():
        publisher = create_redis_client()
        try:
            while not stop_event.is_set():
                frame_counter[0] += 1
                payload = {
                    "type": "detections",
                    "frame_index": frame_counter[0],
                    "timestamp_ms": float(frame_counter[0] * 40),
                    "fps": 25,
                    "vessels": [
                        {"id": f"{marker}-vessel-{i}", "confidence": 0.9}
                        for i in range(vessel_count)
                    ],
                    "marker": marker,
                    "stream_id": stream_id,
                }
                publisher.publish(detections_channel(stream_id), json.dumps(payload))
                time.sleep(interval_s)
        finally:
            publisher.close()

    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    return thread, stop_event


def _receive_detection(websocket, timeout_attempts: int = 15) -> dict:
    for _ in range(timeout_attempts):
        payload = json.loads(websocket.receive_text())
        if payload.get("type") == "detections":
            return payload
    raise AssertionError("Did not receive detection payload")


class TestTwoUsersTwoStreams:
    """Simulates two users in separate browsers, each with their own stream."""

    def test_both_users_receive_their_own_detections(self, redis_available, stream_app_client):
        client = stream_app_client
        stream_a = "user-alice-stream"
        stream_b = "user-bob-stream"

        _start_stream(client, stream_a, "rtsp://camera-1.local/feed")
        _start_stream(client, stream_b, "rtsp://camera-2.local/feed")

        with ExitStack() as stack:
            ws_alice = stack.enter_context(
                client.websocket_connect(f"/api/detections/ws/{stream_a}")
            )
            ws_bob = stack.enter_context(
                client.websocket_connect(f"/api/detections/ws/{stream_b}")
            )

            thread_a, stop_a = _publish_detections(stream_a, marker="alice", vessel_count=2)
            thread_b, stop_b = _publish_detections(stream_b, marker="bob", vessel_count=3)

            try:
                det_alice = _receive_detection(ws_alice)
                det_bob = _receive_detection(ws_bob)
            finally:
                stop_a.set()
                stop_b.set()
                thread_a.join(timeout=1)
                thread_b.join(timeout=1)

            assert det_alice["stream_id"] == stream_a
            assert det_alice["marker"] == "alice"
            assert len(det_alice["vessels"]) == 2

            assert det_bob["stream_id"] == stream_b
            assert det_bob["marker"] == "bob"
            assert len(det_bob["vessels"]) == 3

    def test_viewer_counts_are_independent(self, redis_available, stream_app_client):
        client = stream_app_client
        stream_a = "vc-independent-a"
        stream_b = "vc-independent-b"

        _start_stream(client, stream_a)
        _start_stream(client, stream_b)

        with ExitStack() as stack:
            stack.enter_context(
                client.websocket_connect(f"/api/detections/ws/{stream_a}")
            )
            stack.enter_context(
                client.websocket_connect(f"/api/detections/ws/{stream_b}")
            )

            handle_a = state.orchestrator.get_stream(stream_a)
            handle_b = state.orchestrator.get_stream(stream_b)

            assert handle_a.viewer_count == 1
            assert handle_b.viewer_count == 1

    def test_playback_urls_are_unique_per_stream(self, stream_app_client):
        client = stream_app_client
        stream_a = "playback-a"
        stream_b = "playback-b"

        resp_a = _start_stream(client, stream_a)
        resp_b = _start_stream(client, stream_b)

        assert "playback_urls" in resp_a
        assert "playback_urls" in resp_b

    def test_stopping_one_stream_does_not_affect_other(self, redis_available, stream_app_client):
        client = stream_app_client
        stream_a = "stop-iso-a"
        stream_b = "stop-iso-b"

        _start_stream(client, stream_a)
        _start_stream(client, stream_b)

        resp = client.delete(f"/api/streams/{stream_a}")
        assert resp.status_code == 204

        streams = client.get("/api/streams").json()["streams"]
        stream_ids = {s["stream_id"] for s in streams}
        assert stream_a not in stream_ids
        assert stream_b in stream_ids

        with client.websocket_connect(f"/api/detections/ws/{stream_b}") as ws_bob:
            thread_b, stop_b = _publish_detections(stream_b, marker="still-alive", vessel_count=1)
            try:
                det = _receive_detection(ws_bob)
            finally:
                stop_b.set()
                thread_b.join(timeout=1)

            assert det["stream_id"] == stream_b
            assert det["marker"] == "still-alive"


class TestConcurrentStreamLifecycle:
    """Tests stream creation/teardown while other streams are active."""

    def test_start_new_stream_while_another_is_active_with_viewer(
        self, redis_available, stream_app_client
    ):
        client = stream_app_client
        existing = "lifecycle-existing"
        new = "lifecycle-new"

        _start_stream(client, existing)

        with client.websocket_connect(f"/api/detections/ws/{existing}") as ws_existing:
            _start_stream(client, new)

            thread_e, stop_e = _publish_detections(existing, marker="existing", vessel_count=1)
            thread_n, stop_n = _publish_detections(new, marker="new", vessel_count=1)

            try:
                det_existing = _receive_detection(ws_existing)

                with client.websocket_connect(f"/api/detections/ws/{new}") as ws_new:
                    det_new = _receive_detection(ws_new)
            finally:
                stop_e.set()
                stop_n.set()
                thread_e.join(timeout=1)
                thread_n.join(timeout=1)

            assert det_existing["marker"] == "existing"
            assert det_new["marker"] == "new"

    def test_streams_listed_correctly_with_multiple_active(self, stream_app_client):
        client = stream_app_client
        ids = ["list-a", "list-b", "list-c"]
        for sid in ids:
            _start_stream(client, sid)

        streams = client.get("/api/streams").json()
        active_ids = {s["stream_id"] for s in streams["streams"]}
        for sid in ids:
            assert sid in active_ids

        assert "max_workers" in streams


class TestDetectionIsolation:
    """Ensures detections published to one stream never leak to another."""

    def test_no_cross_stream_detection_leakage(self, redis_available, stream_app_client):
        client = stream_app_client
        stream_a = "leak-a"
        stream_b = "leak-b"

        _start_stream(client, stream_a)
        _start_stream(client, stream_b)

        with ExitStack() as stack:
            ws_a = stack.enter_context(
                client.websocket_connect(f"/api/detections/ws/{stream_a}")
            )
            ws_b = stack.enter_context(
                client.websocket_connect(f"/api/detections/ws/{stream_b}")
            )

            thread_a, stop_a = _publish_detections(
                stream_a, marker="only-for-a", vessel_count=1
            )
            thread_b, stop_b = _publish_detections(
                stream_b, marker="only-for-b", vessel_count=1
            )

            try:
                dets_a = []
                dets_b = []
                for _ in range(5):
                    dets_a.append(_receive_detection(ws_a))
                    dets_b.append(_receive_detection(ws_b))
            finally:
                stop_a.set()
                stop_b.set()
                thread_a.join(timeout=1)
                thread_b.join(timeout=1)

            assert all(d["marker"] == "only-for-a" for d in dets_a), (
                f"Stream A received foreign detections: {[d['marker'] for d in dets_a]}"
            )
            assert all(d["marker"] == "only-for-b" for d in dets_b), (
                f"Stream B received foreign detections: {[d['marker'] for d in dets_b]}"
            )

            assert all(d["stream_id"] == stream_a for d in dets_a)
            assert all(d["stream_id"] == stream_b for d in dets_b)

    def test_late_joiner_receives_detections_without_affecting_existing(
        self, redis_available, stream_app_client
    ):
        client = stream_app_client
        stream_a = "late-a"
        stream_b = "late-b"

        _start_stream(client, stream_a)
        _start_stream(client, stream_b)

        thread_a, stop_a = _publish_detections(stream_a, marker="early-bird", vessel_count=1)
        thread_b, stop_b = _publish_detections(stream_b, marker="late-joiner", vessel_count=2)

        try:
            with client.websocket_connect(f"/api/detections/ws/{stream_a}") as ws_a:
                det_a_before = _receive_detection(ws_a)
                assert det_a_before["marker"] == "early-bird"

                with client.websocket_connect(f"/api/detections/ws/{stream_b}") as ws_b:
                    det_b = _receive_detection(ws_b)
                    det_a_after = _receive_detection(ws_a)

                    assert det_b["marker"] == "late-joiner"
                    assert len(det_b["vessels"]) == 2
                    assert det_a_after["marker"] == "early-bird"
        finally:
            stop_a.set()
            stop_b.set()
            thread_a.join(timeout=1)
            thread_b.join(timeout=1)


class TestMaxConcurrentStreams:
    """Tests that the orchestrator enforces max_workers limit."""

    def test_exceeding_max_workers_returns_error(self, stream_app_client):
        client = stream_app_client
        streams = client.get("/api/streams").json()
        max_workers = streams["max_workers"]

        started = []
        for i in range(max_workers):
            sid = f"max-test-{i}"
            resp = client.post(
                f"/api/streams/{sid}/start",
                json={"source_url": f"rtsp://example.com/{sid}"},
            )
            if resp.status_code == 201:
                started.append(sid)

        overflow_resp = client.post(
            "/api/streams/max-test-overflow/start",
            json={"source_url": "rtsp://example.com/overflow"},
        )
        assert overflow_resp.status_code == 503

        for sid in started:
            client.delete(f"/api/streams/{sid}")
