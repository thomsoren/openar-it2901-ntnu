from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import Queue
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import api
from common.config import create_redis_client, detections_channel
from orchestrator import StreamConfig, WorkerOrchestrator


class FakeProcess:
    _next_pid = 20000

    def __init__(self):
        type(self)._next_pid += 1
        self.pid = type(self)._next_pid
        self._alive = True
        self.exitcode = None

    def is_alive(self):
        return self._alive

    def terminate(self):
        self._alive = False
        self.exitcode = 0

    def join(self, timeout=None):
        return None

    def kill(self):
        self._alive = False
        self.exitcode = -9


@pytest.fixture
def redis_available():
    client = create_redis_client()
    try:
        client.ping()
    except Exception as exc:
        pytest.skip(f"Redis unavailable for integration tests: {exc}")
    finally:
        client.close()


@pytest.fixture
def fake_worker(monkeypatch):
    def _fake_start(source_url: str, stream_id: str, loop: bool = True):
        del source_url, stream_id, loop
        return FakeProcess(), Queue(maxsize=10), Queue(maxsize=10)

    monkeypatch.setattr("orchestrator.orchestrator.worker.start", _fake_start)
    monkeypatch.setattr(api, "get_video_info", lambda _source: SimpleNamespace(width=1920, height=1080, fps=25))


def test_concurrent_stream_starts(fake_worker):
    orchestrator = WorkerOrchestrator(max_workers=8)
    stream_ids = [f"concurrent-{idx}" for idx in range(6)]

    def _start_stream(stream_id: str):
        return orchestrator.start_stream(
            StreamConfig(stream_id=stream_id, source_url=f"rtsp://example.com/{stream_id}", loop=True)
        )

    with ThreadPoolExecutor(max_workers=len(stream_ids)) as executor:
        results = list(executor.map(_start_stream, stream_ids))

    assert len(results) == len(stream_ids)
    listed = orchestrator.list_streams()
    listed_ids = {item["stream_id"] for item in listed}
    assert set(stream_ids).issubset(listed_ids)

    orchestrator.shutdown()


def test_detections_websocket_uses_redis_pubsub(redis_available, fake_worker):
    stream_id = "pubsub-test"
    payload = {
        "type": "detections",
        "frame_index": 7,
        "timestamp_ms": 280.0,
        "fps": 25,
        "vessels": [],
    }

    with TestClient(api.app) as client:
        response = client.post(
            f"/api/streams/{stream_id}/start",
            json={"source_url": "rtsp://example.com/live", "loop": True},
        )
        assert response.status_code == 201, response.text

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
            with client.websocket_connect(f"/api/detections/ws/{stream_id}") as websocket:
                ready = websocket.receive_json()
                assert ready["type"] == "ready"

                message = websocket.receive_json()
                assert message["type"] == "detections"
                assert message["frame_index"] == payload["frame_index"]
                assert message["timestamp_ms"] == payload["timestamp_ms"]
        finally:
            stop_event.set()
            thread.join(timeout=1)
            publisher.close()

