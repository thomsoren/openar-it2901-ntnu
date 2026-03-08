"""Detection publisher for Redis pub/sub."""
from __future__ import annotations

import json
import logging
import threading

from redis.exceptions import RedisError

from common.config import create_redis_client, detections_channel
from sensor_fusion.fusion_config import maybe_configure
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
            logger.warning("Redis publish failed for stream '%s': %s", stream_id, exc)
            return False

    def close(self) -> None:
        try:
            self._redis.close()
        except Exception as exc:
            logger.debug("Redis close failed: %s", exc)


class FusionPublisher(DetectionPublisher):
    """Publisher that optionally enriches detection payloads with AIS data.

    If fusion is configured for *stream_id*, the payload is enriched
    synchronously and then published to `detections:{stream_id}` with
    attached `fusion` metadata. Otherwise it is published unchanged.

    Extends DetectionPublisher so it can be used anywhere a DetectionPublisher
    is expected (e.g. InferenceThread).
    """

    def __init__(self, fusion_svc: SensorFusionService):
        super().__init__()  # creates self._redis via DetectionPublisher
        self.fusion_svc = fusion_svc

    def publish(self, stream_id: str, payload: dict) -> bool:
        if payload.get("type") == "detections":
            maybe_configure(stream_id, self.fusion_svc)
            vessels, meta = self.fusion_svc.enrich(
                stream_id,
                payload.get("vessels", []),
                payload.get("timestamp_ms", 0),
            )
            if meta is not None:
                payload = {**payload, "vessels": vessels, "fusion": meta}

        return super().publish(stream_id, payload)


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
