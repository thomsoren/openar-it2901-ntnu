"""Detection publisher for Redis pub/sub."""
from __future__ import annotations

import json
import logging

from redis.exceptions import RedisError

from common.config import create_redis_client, detections_channel

logger = logging.getLogger(__name__)


class DetectionPublisher:
    """Publish detection payloads to a per-stream Redis channel."""

    def __init__(self):
        self._redis = create_redis_client()

    def publish(self, stream_id: str, payload: dict) -> bool:
        try:
            self._redis.publish(detections_channel(stream_id), json.dumps(payload))
            return True
        except RedisError as exc:
            logger.warning(f"Redis publish failed for stream '{stream_id}': {exc}")
            return False

    def close(self):
        try:
            self._redis.close()
        except Exception:
            pass
