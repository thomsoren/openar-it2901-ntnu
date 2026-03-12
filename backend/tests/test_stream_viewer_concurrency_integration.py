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
        pytest.skip(f"Redis unavailable for integration tests: {exc}")
    finally:
        client.close()


def _start_stream(client, stream_id: str) -> None:
    response = client.post(
        f"/api/streams/{stream_id}/start",
        json={"source_url": f"rtsp://example.com/{stream_id}", "loop": True},
    )
    assert response.status_code == 201, response.text


def _publish_detection(stream_id: str, frame_index: int, marker: str) -> None:
    payload = {
        "type": "detections",
        "frame_index": frame_index,
        "timestamp_ms": float(frame_index * 40),
        "fps": 25,
        "vessels": [],
        "marker": marker,
        "stream_id": stream_id,
    }
    publisher = create_redis_client()
    try:
        publisher.publish(detections_channel(stream_id), json.dumps(payload))
    finally:
        publisher.close()


class RepeatingPublisher:
    def __init__(self, stream_id: str, frame_index: int, marker: str, interval_s: float = 0.05):
        self._stream_id = stream_id
        self._frame_index = frame_index
        self._marker = marker
        self._interval_s = interval_s
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            _publish_detection(self._stream_id, self._frame_index, self._marker)
            time.sleep(self._interval_s)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=1)


def _receive_detection(websocket) -> dict:
    for _ in range(10):
        payload = json.loads(websocket.receive_text())
        if payload.get("type") == "detections":
            return payload
    raise AssertionError("Did not receive detection payload")


def _close_websocket(websocket) -> None:
    try:
        websocket.close()
    except Exception:
        pass


def _disconnect_viewers(stream_id: str, sockets: list | tuple) -> None:
    for socket in sockets:
        _close_websocket(socket)
    # The websocket handler releases viewer_count in its finally block,
    # which only runs after the next publish notices the closed socket.
    _publish_detection(stream_id, frame_index=999, marker="disconnect-probe")


def test_two_viewers_same_stream_receive_same_payload(redis_available, stream_app_client):
    client = stream_app_client
    stream_id = "shared-stream"
    _start_stream(client, stream_id)

    with ExitStack() as stack:
        sockets = [
            stack.enter_context(client.websocket_connect(f"/api/detections/ws/{stream_id}"))
            for _ in range(2)
        ]

        handle = state.orchestrator.get_stream(stream_id)
        assert handle.viewer_count == 2

        publisher = RepeatingPublisher(stream_id, frame_index=7, marker="same-stream")
        publisher.start()
        try:
            results = [_receive_detection(socket) for socket in sockets]
        finally:
            publisher.stop()

        print(
            "concurrency-scenario",
            {
                "scenario": "two_viewers_same_stream",
                "stream_id": stream_id,
                "viewer_count": handle.viewer_count,
                "received_markers": [result["marker"] for result in results],
                "received_frames": [result["frame_index"] for result in results],
            },
        )

        assert all(result["stream_id"] == stream_id for result in results)
        assert [result["marker"] for result in results] == ["same-stream", "same-stream"]
        assert [result["frame_index"] for result in results] == [7, 7]
        _disconnect_viewers(stream_id, sockets)


def test_three_viewers_three_different_streams_are_isolated(redis_available, stream_app_client):
    client = stream_app_client
    stream_ids = ["iso-a", "iso-b", "iso-c"]
    for stream_id in stream_ids:
        _start_stream(client, stream_id)

    with ExitStack() as stack:
        sockets = {
            stream_id: stack.enter_context(client.websocket_connect(f"/api/detections/ws/{stream_id}"))
            for stream_id in stream_ids
        }

        for stream_id in stream_ids:
            assert state.orchestrator.get_stream(stream_id).viewer_count == 1

        publishers = [
            RepeatingPublisher(stream_id, frame_index=index, marker=f"marker-{stream_id}")
            for index, stream_id in enumerate(stream_ids, start=1)
        ]
        for publisher in publishers:
            publisher.start()
        try:
            results = {
                stream_id: _receive_detection(socket)
                for stream_id, socket in sockets.items()
            }
        finally:
            for publisher in publishers:
                publisher.stop()

        print(
            "concurrency-scenario",
            {
                "scenario": "three_viewers_three_streams",
                "results": {
                    stream_id: {
                        "marker": results[stream_id]["marker"],
                        "frame_index": results[stream_id]["frame_index"],
                    }
                    for stream_id in stream_ids
                },
            },
        )

        for stream_id in stream_ids:
            assert results[stream_id]["stream_id"] == stream_id
            assert results[stream_id]["marker"] == f"marker-{stream_id}"
        for stream_id, socket in sockets.items():
            _disconnect_viewers(stream_id, [socket])


def test_mixed_concurrency_two_on_one_stream_one_on_another(redis_available, stream_app_client):
    client = stream_app_client
    primary_stream = "mix-a"
    secondary_stream = "mix-b"
    for stream_id in (primary_stream, secondary_stream):
        _start_stream(client, stream_id)

    with ExitStack() as stack:
        primary_sockets = [
            stack.enter_context(client.websocket_connect(f"/api/detections/ws/{primary_stream}"))
            for _ in range(2)
        ]
        secondary_socket = stack.enter_context(client.websocket_connect(f"/api/detections/ws/{secondary_stream}"))

        assert state.orchestrator.get_stream(primary_stream).viewer_count == 2
        assert state.orchestrator.get_stream(secondary_stream).viewer_count == 1

        primary_publisher = RepeatingPublisher(primary_stream, frame_index=11, marker="primary")
        secondary_publisher = RepeatingPublisher(secondary_stream, frame_index=22, marker="secondary")
        primary_publisher.start()
        secondary_publisher.start()
        try:
            primary_results = [_receive_detection(socket) for socket in primary_sockets]
            secondary_result = _receive_detection(secondary_socket)
        finally:
            primary_publisher.stop()
            secondary_publisher.stop()

        print(
            "concurrency-scenario",
            {
                "scenario": "mixed_viewers_multi_stream",
                "primary_stream": primary_stream,
                "primary_viewers": len(primary_results),
                "secondary_stream": secondary_stream,
                "secondary_marker": secondary_result["marker"],
                "primary_markers": [result["marker"] for result in primary_results],
            },
        )

        assert all(result["stream_id"] == primary_stream for result in primary_results)
        assert all(result["marker"] == "primary" for result in primary_results)
        assert secondary_result["stream_id"] == secondary_stream
        assert secondary_result["marker"] == "secondary"
        _disconnect_viewers(primary_stream, primary_sockets)
        _disconnect_viewers(secondary_stream, [secondary_socket])
