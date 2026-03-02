"""
Helpers for automatically configuring sensor fusion from geographic parameters.

Separates all AIS-fetch + fusion-setup logic from the API layer.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone

from ais.fetch_ais import fetch_historic_ais_data
from ais.logger import AISSessionLogger
from cv.publisher import get_fusion_publisher
from sensor_fusion.ais_store import AISStore

logger = logging.getLogger(__name__)


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
        time_window_s: AIS snapshot time window passed to AISStore.

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
