"""Detection publisher for Redis pub/sub."""
from __future__ import annotations

import json
import logging
import threading

from redis.exceptions import RedisError

from common.config import create_redis_client, detections_channel, fused_channel
from sensor_fusion.service import SensorFusionService

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


class FusionPublisher:
    """Publisher that optionally enriches detection payloads with AIS data.

    If fusion is configured for *stream_id*, the payload is enriched
    synchronously and published to `fused:{stream_id}`.  Otherwise it falls
    through to `detections:{stream_id}` unchanged.
    """

    def __init__(self, fusion_svc: SensorFusionService):
        self._redis = create_redis_client()
        self.fusion_svc = fusion_svc

    def publish(self, stream_id: str, payload: dict) -> bool:
        # Defaults: raw detections channel, original payload
        channel = detections_channel(stream_id)
        data = json.dumps(payload)

        # Attempt synchronous enrichment in a single call (avoids TOCTOU)
        if payload.get("type") == "detections":
            vessels, meta = self.fusion_svc.enrich(
                stream_id,
                payload.get("vessels", []),
                payload.get("timestamp_ms", 0),
            )
            if meta is not None:
                enriched = {**payload, "vessels": vessels, "fusion": meta}
                channel = fused_channel(stream_id)
                data = json.dumps(enriched)

        try:
            self._redis.publish(channel, data)
            return True
        except RedisError as exc:
            logger.warning("Redis publish failed for stream '%s': %s", stream_id, exc)
            return False

    def close(self):
        try:
            self._redis.close()
        except Exception:
            pass


# ── Module-level singleton ────────────────────────────────────────────────────

_fusion_publisher: FusionPublisher | None = None
_fusion_publisher_lock = threading.Lock()


def get_fusion_publisher() -> FusionPublisher:
    """Return the process-wide FusionPublisher singleton (double-checked locking)."""
    global _fusion_publisher
    if _fusion_publisher is None:
        with _fusion_publisher_lock:
            if _fusion_publisher is None:
                _fusion_publisher = FusionPublisher(SensorFusionService())
    return _fusion_publisher
