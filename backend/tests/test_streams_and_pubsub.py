from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

import api
from common.config import create_redis_client, detections_channel
from orchestrator import StreamConfig, WorkerOrchestrator


@pytest.fixture
def redis_available():
    client = create_redis_client()
    try:
        client.ping()
    except Exception as exc:
        pytest.skip(f"Redis unavailable for integration tests: {exc}")
    finally:
        client.close()


def test_concurrent_stream_starts(fake_worker_start, fake_ffmpeg):
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


def test_detections_websocket_uses_redis_pubsub(redis_available, fake_worker_start, fake_ffmpeg):
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
                message = websocket.receive_json()
                assert message["type"] == "detections"
                assert message["frame_index"] == payload["frame_index"]
                assert message["timestamp_ms"] == payload["timestamp_ms"]
        finally:
            stop_event.set()
            thread.join(timeout=1)
            publisher.close()


def test_streams_include_playback_urls(fake_worker_start, fake_ffmpeg):
    stream_id = "playback-test"
    with TestClient(api.app) as client:
        start_response = client.post(
            f"/api/streams/{stream_id}/start",
            json={"source_url": "rtsp://example.com/live", "loop": True},
        )
        assert start_response.status_code == 201, start_response.text
        start_payload = start_response.json()
        assert "playback_urls" in start_payload
        assert isinstance(start_payload["playback_urls"].get("media_enabled"), bool)

        list_response = client.get("/api/streams")
        assert list_response.status_code == 200, list_response.text
        list_payload = list_response.json()
        stream = next(item for item in list_payload["streams"] if item["stream_id"] == stream_id)
        assert "playback_urls" in stream
        assert isinstance(stream["playback_urls"].get("media_enabled"), bool)

        playback_response = client.get(f"/api/streams/{stream_id}/playback")
        assert playback_response.status_code == 200, playback_response.text
        playback_payload = playback_response.json()
        assert playback_payload["stream_id"] == stream_id
        assert isinstance(playback_payload["playback_urls"].get("media_enabled"), bool)
