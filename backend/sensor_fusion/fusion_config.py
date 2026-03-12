"""
Helpers for automatically configuring sensor fusion from geographic parameters.

Separates all AIS-fetch + fusion-setup logic from the API layer.
"""
from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from ais.fetch_ais import fetch_historic_ais_data
from ais.logger import AISSessionLogger
from common.config.fusion import AUTO_FUSION_TIME_WINDOW_S
from db.database import SessionLocal
from db.models import MediaAsset
from sensor_fusion.ais_store import AISStore
from sensor_fusion.service import SensorFusionService
from storage import s3

logger = logging.getLogger(__name__)

# Maps stream_id -> video asset_name in media_assets (must have fusion=true + ais_data_path set).
_FUSION_STREAM_VIDEO_ASSETS: dict[str, str] = {
    "fusion": "fusion_video_gunnerus",
}


def _extract_first_msgtime(ndjson_text: str) -> datetime | None:
    """Return the earliest msgtime across all non-session NDJSON rows as UTC datetime."""
    earliest: datetime | None = None
    for line in ndjson_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg_type = row.get("msgtype") or row.get("type", "")
        if msg_type in ("session_start", "session_end"):
            continue
        raw = row.get("msgtime") or row.get("logReceivedAt") or row.get("timestamp")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            if earliest is None or dt < earliest:
                earliest = dt
        except (ValueError, TypeError):
            continue
    return earliest


def maybe_configure(stream_id: str, fusion_svc: SensorFusionService) -> None:
    """Auto-configure fusion for *stream_id* from the video asset's ais_data_path in DB.

    Called on the first detection frame for the stream.
    The epoch is derived from the earliest msgtime in the NDJSON, so no separate
    video_epoch_utc column is needed.
    """
    video_asset_name = _FUSION_STREAM_VIDEO_ASSETS.get(stream_id)
    if not video_asset_name:
        return
    if fusion_svc.is_configured(stream_id):
        return

    # Look up the asset row to get ais_data_path.
    try:
        with SessionLocal() as db:
            asset = db.scalar(
                select(MediaAsset).where(MediaAsset.asset_name == video_asset_name)
            )
            ais_data_path = asset.ais_data_path if (asset and asset.fusion) else None
    except Exception as exc:
        logger.warning("[fusion-config:%s] DB lookup failed: %s", stream_id, exc)
        return

    if not ais_data_path:
        logger.warning(
            "[fusion-config:%s] Asset '%s' has no ais_data_path set; skipping",
            stream_id, video_asset_name,
        )
        return

    text = s3.read_text_from_sources(ais_data_path)
    if not text or not text.strip():
        logger.warning(
            "[fusion-config:%s] Could not load NDJSON from '%s'; skipping",
            stream_id, ais_data_path,
        )
        return

    epoch = _extract_first_msgtime(text)
    if epoch is None:
        logger.warning(
            "[fusion-config:%s] No parseable msgtime in NDJSON '%s'; skipping",
            stream_id, ais_data_path,
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
            "[fusion-config:%s] Auto-configured from DB asset '%s' (epoch=%s, %d AIS records)",
            stream_id, video_asset_name, epoch.isoformat(), store.record_count,
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
