"""
Helpers for automatically configuring sensor fusion from geographic parameters.

Separates all AIS-fetch + fusion-setup logic from the API layer.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ais.fetch_ais import fetch_historic_ais_data
from ais.logger import AISSessionLogger
from common.config.fusion import AUTO_FUSION_TIME_WINDOW_S
from sensor_fusion.ais_store import AISStore
from sensor_fusion.service import SensorFusionService
from storage import s3

logger = logging.getLogger(__name__)

# Static fusion config for known pre-recorded streams (S3/URL sources only).
# Maps stream_id -> {ais_sources: [...], video_epoch_utc: datetime}
_STATIC_FUSION: dict[str, dict[str, object]] = {
    "fusion": {
        "ais_asset_names": ["fusion_ais_pirbadet"],
        "video_epoch_utc": datetime(2026, 2, 19, 8, 10, 0, tzinfo=timezone.utc),
    },
}


def _load_ndjson_text_from_assets(asset_names: list[str]) -> tuple[str | None, str | None]:
    for asset_name in asset_names:
        name = (asset_name or "").strip()
        if not name:
            continue
        try:
            s3_key = s3.resolve_system_asset_key(name, "data")
        except Exception:
            continue

        text = s3.read_text_from_sources(s3_key)
        if text and text.strip():
            return text, f"{name} (s3://{s3_key})"

    return None, None


def maybe_configure(stream_id: str, fusion_svc: SensorFusionService) -> None:
    """Auto-configure fusion for *stream_id* if a static config exists and it
    is not yet configured.  Called on the first detection frame for the stream."""
    config = _STATIC_FUSION.get(stream_id)
    if not config:
        return
    if fusion_svc.is_configured(stream_id):
        return

    asset_names = [str(source) for source in config.get("ais_asset_names", [])]
    epoch = config.get("video_epoch_utc")
    if not isinstance(epoch, datetime):
        logger.warning("[fusion-config:%s] Missing static video epoch; skipping", stream_id)
        return

    text, source_label = _load_ndjson_text_from_assets(asset_names)
    if not text:
        logger.warning(
            "[fusion-config:%s] No static NDJSON available from media_assets mapping",
            stream_id,
        )
        return

    try:
        store = AISStore(ndjson_text=text, time_window_s=AUTO_FUSION_TIME_WINDOW_S)
        fusion_svc.configure(
            stream_id=stream_id,
            ais_store=store,
            video_epoch_utc=epoch,
        )
        logger.info(
            "[fusion-config:%s] Auto-configured from static NDJSON source %s — %d AIS records",
            stream_id, source_label or "unknown", store.record_count,
        )
    except Exception as exc:
        logger.warning("[fusion-config:%s] Failed to auto-configure: %s", stream_id, exc)


def configure_from_ndjson(
    stream_id: str,
    ndjson_path: str | Path,
    video_epoch_utc: datetime,
) -> int:
    """Configure sensor fusion for *stream_id* from a pre-recorded NDJSON file.

    Args:
        stream_id: The stream to configure fusion for.
        ndjson_path: Path to the NDJSON AIS log file.
        video_epoch_utc: UTC datetime of frame 0 of the video.

    Returns:
        Number of AIS records loaded.
    """
    if video_epoch_utc.tzinfo is None:
        video_epoch_utc = video_epoch_utc.replace(tzinfo=timezone.utc)
    from cv.publisher import get_fusion_publisher  # lazy — avoids circular import
    store = AISStore(ndjson_path, time_window_s=AUTO_FUSION_TIME_WINDOW_S)
    get_fusion_publisher().fusion_svc.configure(
        stream_id=stream_id,
        ais_store=store,
        video_epoch_utc=video_epoch_utc,
    )
    logger.info(
        "[fusion-config:%s] Configured from static NDJSON — %d AIS records, epoch=%s",
        stream_id, store.record_count, video_epoch_utc.isoformat(),
    )
    return store.record_count


def build_polygon_around(lat: float, lon: float, radius_km: float) -> dict:
    """Return a GeoJSON Polygon dict for a rectangular bounding box around a point.

    Args:
        lat: Centre latitude in decimal degrees.
        lon: Centre longitude in decimal degrees.
        radius_km: Half-side length of the bounding box in kilometres.
    """
    delta_lat = radius_km / 111.32
    delta_lon = radius_km / (111.32 * math.cos(math.radians(lat)))
    min_lon, max_lon = lon - delta_lon, lon + delta_lon
    min_lat, max_lat = lat - delta_lat, lat + delta_lat
    return {
        "type": "Polygon",
        "coordinates": [[
            [min_lon, min_lat],
            [max_lon, min_lat],
            [max_lon, max_lat],
            [min_lon, max_lat],
            [min_lon, min_lat],  # closed ring
        ]],
    }


async def fetch_and_configure_ais(
    stream_id: str,
    ship_lat: float,
    ship_lon: float,
    video_epoch_utc: datetime,
    duration_s: float,
    radius_km: float = 5.0,
    time_window_s: float = 10.0,
) -> int:
    """Fetch historic AIS data for a geographic area and configure sensor fusion.

    Args:
        stream_id: The stream to configure fusion for.
        ship_lat: Ship latitude at recording time (centre of search area).
        ship_lon: Ship longitude at recording time (centre of search area).
        video_epoch_utc: UTC datetime of frame 0 of the video.
        duration_s: Video duration in seconds (defines the AIS time range to fetch).
        radius_km: Search radius in km around the ship position.

    Returns:
        Number of AIS records loaded.

    Raises:
        Exception: Propagates any fetch or configuration error to the caller.
    """
    if video_epoch_utc.tzinfo is None:
        video_epoch_utc = video_epoch_utc.replace(tzinfo=timezone.utc)

    end_epoch = video_epoch_utc + timedelta(seconds=duration_s)
    polygon = build_polygon_around(ship_lat, ship_lon, radius_km)

    session_logger = AISSessionLogger()
    async for _ in fetch_historic_ais_data(
        polygon=polygon,
        from_date=video_epoch_utc.isoformat(),
        to_date=end_epoch.isoformat(),
        session_logger=session_logger,
    ):
        pass

    store = AISStore(session_logger.log_file, time_window_s=time_window_s)
    from cv.publisher import get_fusion_publisher  # lazy — avoids circular import
    get_fusion_publisher().fusion_svc.configure(
        stream_id=stream_id,
        ais_store=store,
        video_epoch_utc=video_epoch_utc,
    )
    logger.info(
        "[fusion-config:%s] Configured — %d AIS records, epoch=%s",
        stream_id, store.record_count, video_epoch_utc.isoformat(),
    )
    return store.record_count
