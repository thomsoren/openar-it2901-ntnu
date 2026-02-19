"""Redis configuration and helpers."""
from __future__ import annotations

import os

from redis import Redis
from redis.asyncio import Redis as AsyncRedis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_DETECTIONS_CHANNEL_PREFIX = os.getenv("REDIS_DETECTIONS_CHANNEL_PREFIX", "detections")
DEFAULT_DETECTIONS_STREAM_ID = os.getenv("DEFAULT_DETECTIONS_STREAM_ID", "default")


def detections_channel(stream_id: str) -> str:
    """Build pub/sub channel name for a detection stream."""
    return f"{REDIS_DETECTIONS_CHANNEL_PREFIX}:{stream_id}"


def create_redis_client() -> Redis:
    """Create a sync Redis client for worker publishing."""
    return Redis.from_url(REDIS_URL, decode_responses=True)


def create_async_redis_client() -> AsyncRedis:
    """Create an async Redis client for API websocket subscriptions."""
    return AsyncRedis.from_url(REDIS_URL, decode_responses=True)
