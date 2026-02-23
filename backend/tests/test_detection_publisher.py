"""Tests for DetectionPublisher — Redis pub/sub unit tests + optional integration."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from redis.exceptions import RedisError

from common.config import create_redis_client, detections_channel


# ---------- Unit tests (mocked Redis) ----------

class TestPublishUnit:
    def test_calls_redis_publish(self):
        mock_redis = MagicMock()
        with patch("cv.publisher.create_redis_client", return_value=mock_redis):
            from cv.publisher import DetectionPublisher
            pub = DetectionPublisher()

        payload = {"type": "detections", "frame_index": 1}
        pub.publish("s1", payload)

        mock_redis.publish.assert_called_once_with(
            detections_channel("s1"),
            json.dumps(payload),
        )

    def test_returns_true_on_success(self):
        mock_redis = MagicMock()
        with patch("cv.publisher.create_redis_client", return_value=mock_redis):
            from cv.publisher import DetectionPublisher
            pub = DetectionPublisher()

        assert pub.publish("s1", {"type": "detections"}) is True

    def test_returns_false_on_redis_error(self):
        mock_redis = MagicMock()
        mock_redis.publish.side_effect = RedisError("connection refused")
        with patch("cv.publisher.create_redis_client", return_value=mock_redis):
            from cv.publisher import DetectionPublisher
            pub = DetectionPublisher()

        assert pub.publish("s1", {"type": "detections"}) is False

    def test_close_calls_redis_close(self):
        mock_redis = MagicMock()
        with patch("cv.publisher.create_redis_client", return_value=mock_redis):
            from cv.publisher import DetectionPublisher
            pub = DetectionPublisher()

        pub.close()
        mock_redis.close.assert_called_once()

    def test_close_swallows_exceptions(self):
        mock_redis = MagicMock()
        mock_redis.close.side_effect = Exception("broken pipe")
        with patch("cv.publisher.create_redis_client", return_value=mock_redis):
            from cv.publisher import DetectionPublisher
            pub = DetectionPublisher()

        pub.close()  # Should not raise


# ---------- Integration tests (real Redis) ----------

@pytest.fixture
def redis_available():
    client = create_redis_client()
    try:
        client.ping()
    except Exception as exc:
        pytest.skip(f"Redis unavailable: {exc}")
    finally:
        client.close()


def test_publish_subscribe_roundtrip(redis_available):
    from cv.publisher import DetectionPublisher

    stream_id = "integration-roundtrip"
    channel = detections_channel(stream_id)
    payload = {"type": "detections", "frame_index": 42, "vessels": []}

    subscriber = create_redis_client()
    pubsub = subscriber.pubsub()
    pubsub.subscribe(channel)
    # Consume the subscription confirmation message
    pubsub.get_message(timeout=1)

    publisher = DetectionPublisher()
    try:
        publisher.publish(stream_id, payload)
        msg = pubsub.get_message(timeout=2)
        assert msg is not None
        assert msg["type"] == "message"
        data = json.loads(msg["data"])
        assert data["frame_index"] == 42
    finally:
        publisher.close()
        pubsub.unsubscribe()
        pubsub.close()
        subscriber.close()


def test_channel_isolation(redis_available):
    from cv.publisher import DetectionPublisher

    sub_a = create_redis_client()
    ps_a = sub_a.pubsub()
    ps_a.subscribe(detections_channel("stream-A"))
    ps_a.get_message(timeout=1)

    sub_b = create_redis_client()
    ps_b = sub_b.pubsub()
    ps_b.subscribe(detections_channel("stream-B"))
    ps_b.get_message(timeout=1)

    publisher = DetectionPublisher()
    try:
        publisher.publish("stream-A", {"from": "A"})
        publisher.publish("stream-B", {"from": "B"})

        msg_a = ps_a.get_message(timeout=2)
        msg_b = ps_b.get_message(timeout=2)

        assert msg_a is not None
        assert json.loads(msg_a["data"])["from"] == "A"
        assert msg_b is not None
        assert json.loads(msg_b["data"])["from"] == "B"
    finally:
        publisher.close()
        for ps, sub in [(ps_a, sub_a), (ps_b, sub_b)]:
            ps.unsubscribe()
            ps.close()
            sub.close()
