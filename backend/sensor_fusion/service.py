"""
SensorFusionService — synchronous per-stream AIS enricher registry.

Instead of running a background Redis subscriber, this service is called
synchronously inside FusionPublisher.publish().  For each stream that has
been configured, it looks up the appropriate AIS snapshot for the current
frame timestamp and runs the matcher.

Usage:
    svc = SensorFusionService()

    svc.configure(
        stream_id="default",
        ais_store=AISStore("data/ais_logs/session.ndjson"),
        video_epoch_utc=datetime(2026, 2, 25, 9, 55, 40, tzinfo=timezone.utc),
    )

    enriched_vessels, meta = svc.enrich("default", raw_vessels, timestamp_ms=5000)

    svc.clear("default")  # disable fusion for this stream
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from sensor_fusion.ais_store import AISStore
from sensor_fusion.matcher import match_detections_to_ais

logger = logging.getLogger(__name__)


class _StreamFusionConfig:
    __slots__ = ("ais_store", "video_epoch_utc", "include_unmatched_ais")

    def __init__(
        self,
        ais_store: AISStore,
        video_epoch_utc: datetime,
        include_unmatched_ais: bool = False,
    ):
        self.ais_store = ais_store
        self.video_epoch_utc = video_epoch_utc
        self.include_unmatched_ais = include_unmatched_ais


class SensorFusionService:
    """Registry of per-stream AIS enrichment configs.

    Thread-safe: configure/clear/enrich may be called from different threads.
    """

    def __init__(self) -> None:
        self._configs: dict[str, _StreamFusionConfig] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def configure(
        self,
        stream_id: str,
        ais_store: AISStore,
        video_epoch_utc: datetime,
        include_unmatched_ais: bool = False,
    ) -> None:
        """Enable AIS fusion for *stream_id*."""
        if video_epoch_utc.tzinfo is None:
            video_epoch_utc = video_epoch_utc.replace(tzinfo=timezone.utc)
        with self._lock:
            self._configs[stream_id] = _StreamFusionConfig(
                ais_store=ais_store,
                video_epoch_utc=video_epoch_utc,
                include_unmatched_ais=include_unmatched_ais,
            )
        logger.info(
            "[fusion:%s] Configured — %d AIS records, epoch=%s",
            stream_id, ais_store.record_count, video_epoch_utc.isoformat(),
        )

    def clear(self, stream_id: str) -> None:
        """Disable fusion for *stream_id*."""
        with self._lock:
            self._configs.pop(stream_id, None)
        logger.info("[fusion:%s] Cleared", stream_id)

    def is_configured(self, stream_id: str) -> bool:
        with self._lock:
            return stream_id in self._configs

    def update_epoch(self, stream_id: str, video_epoch_utc: datetime) -> None:
        """Hot-swap the video epoch without reloading the AIS store."""
        with self._lock:
            cfg = self._configs.get(stream_id)
            if cfg is None:
                raise KeyError(f"No fusion config for stream '{stream_id}'")
            if video_epoch_utc.tzinfo is None:
                video_epoch_utc = video_epoch_utc.replace(tzinfo=timezone.utc)
            cfg.video_epoch_utc = video_epoch_utc
        logger.info("[fusion:%s] Epoch updated to %s", stream_id, video_epoch_utc.isoformat())

    # ------------------------------------------------------------------
    # Enrichment — called synchronously from FusionPublisher
    # ------------------------------------------------------------------

    def enrich(
        self,
        stream_id: str,
        vessels: list[dict[str, Any]],
        timestamp_ms: float,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        """
        Enrich *vessels* with AIS data for the given frame.

        Returns:
            (enriched_vessels, fusion_meta) where fusion_meta contains
            diagnostic info, or (vessels, None) if fusion is not configured.
        """
        # Copy all config values atomically, then do computation outside the lock
        with self._lock:
            cfg = self._configs.get(stream_id)
            if cfg is None:
                return vessels, None
            ais_store = cfg.ais_store
            video_epoch_utc = cfg.video_epoch_utc
            include_unmatched_ais = cfg.include_unmatched_ais

        frame_utc = video_epoch_utc + timedelta(milliseconds=timestamp_ms)
        snapshot = ais_store.get_snapshot(frame_utc)

        enriched = match_detections_to_ais(
            detections=vessels,
            ais_snapshot=snapshot,
            include_unmatched_ais=include_unmatched_ais,
        )

        meta = {
            "ais_candidates": len(snapshot),
            "frame_utc": frame_utc.isoformat(),
        }
        return enriched, meta
