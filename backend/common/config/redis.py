"""Redis configuration and helpers."""
from __future__ import annotations

from redis import Redis
from redis.asyncio import Redis as AsyncRedis
from settings._env import get_str

REDIS_URL = get_str("REDIS_URL", "redis://localhost:6379/0")
REDIS_DETECTIONS_CHANNEL_PREFIX = get_str("REDIS_DETECTIONS_CHANNEL_PREFIX", "detections")
REDIS_FUSED_CHANNEL_PREFIX = get_str("REDIS_FUSED_CHANNEL_PREFIX", "fused")
DEFAULT_DETECTIONS_STREAM_ID = get_str("DEFAULT_DETECTIONS_STREAM_ID", "default")


def detections_channel(stream_id: str) -> str:
    """Build pub/sub channel name for a raw detection stream."""
    return f"{REDIS_DETECTIONS_CHANNEL_PREFIX}:{stream_id}"


def fused_channel(stream_id: str) -> str:
    """Build pub/sub channel name for a fused (detection + AIS) stream."""
    return f"{REDIS_FUSED_CHANNEL_PREFIX}:{stream_id}"


def create_redis_client() -> Redis:
    """Create a sync Redis client for worker publishing."""
    return Redis.from_url(REDIS_URL, decode_responses=True)


def create_async_redis_client() -> AsyncRedis:
    """Create an async Redis client for API websocket subscriptions."""
    return AsyncRedis.from_url(REDIS_URL, decode_responses=True)
