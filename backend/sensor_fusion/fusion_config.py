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
from common.config import BASE_DIR
from common.config.fusion import AUTO_FUSION_TIME_WINDOW_S
from sensor_fusion.ais_store import AISStore
from sensor_fusion.service import SensorFusionService

logger = logging.getLogger(__name__)

# Static fusion config for known pre-recorded streams.
# Maps stream_id -> (ndjson_path, video_epoch_utc).
_STATIC_FUSION: dict[str, tuple[str, datetime]] = {
    "default": (
        str(BASE_DIR / "data" / "ais_logs" / "Pirbadet.ndjson"),
        datetime(2026, 2, 19, 8, 10, 0, tzinfo=timezone.utc),
    ),
}


def maybe_configure(stream_id: str, fusion_svc: SensorFusionService) -> None:
    """Auto-configure fusion for *stream_id* if a static config exists and it
    is not yet configured.  Called on the first detection frame for the stream."""
    if stream_id not in _STATIC_FUSION:
        return
    if fusion_svc.is_configured(stream_id):
        return
    ndjson_path, epoch = _STATIC_FUSION[stream_id]
    try:
        store = AISStore(ndjson_path, time_window_s=AUTO_FUSION_TIME_WINDOW_S)
        fusion_svc.configure(
            stream_id=stream_id,
            ais_store=store,
            video_epoch_utc=epoch,
        )
        logger.info(
            "[fusion-config:%s] Auto-configured from static NDJSON — %d AIS records",
            stream_id, store.record_count,
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
