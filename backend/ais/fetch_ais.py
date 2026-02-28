import os
import logging
import aiohttp
import asyncio
import json
import math
from urllib.parse import quote
from dotenv import load_dotenv
from typing import AsyncIterator, List

from .logger import AISSessionLogger
from ais_mapping_service.pixel_projection.current_ship_config import CameraConfig, ShipConfig
from ais_mapping_service.pixel_projection.projection import project_ais_to_pixel

load_dotenv()

logger = logging.getLogger(__name__)

AIS_CLIENT_ID = os.getenv("AIS_CLIENT_ID", "").strip()
AIS_CLIENT_SECRET = os.getenv("AIS_CLIENT_SECRET", "").strip()
AIS_TOKEN_URL = "https://id.barentswatch.no/connect/token"
AIS_SCOPE = "ais"

async def _fetch_token(session: aiohttp.ClientSession) -> str:
  if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
    raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET is missing")

  payload = {
    "client_id": AIS_CLIENT_ID,
    "client_secret": AIS_CLIENT_SECRET,
    "grant_type": "client_credentials",
    "scope": AIS_SCOPE,
  }

  async with session.post(AIS_TOKEN_URL, data=payload) as response:
    if response.status != 200:
      detail = await response.text()
      raise ValueError(f"Token request failed ({response.status}): {detail}")
    data = await response.json()
    token = data.get("access_token")
    if not token:
      raise ValueError("Token response missing access_token")
    return token

async def fetch_ais_stream_geojson(
    coordinates: List[List[float]],
    timeout: int = 120,
):
    """
    Stream live AIS data within the polygon.

    Args:
        coordinates: GeoJSON polygon as [[lon, lat], ...]
        timeout: Connection timeout in seconds.

    Yields:
        AIS data objects from the Barentswatch live stream..
        
        Example:
            {
                'courseOverGround': 223.4,
                'latitude': 63.439218,
                'longitude': 10.398735,
                'name': 'OCEAN SPACE DRONE1',
                'rateOfTurn': -6,
                'shipType': 99,
                'speedOverGround': 0.1,
                'trueHeading': 138,
                'navigationalStatus': 0,
                'mmsi': 257030830,
                'msgtime': '2026-02-17T14:13:04+00:00',
                'stream': 'terra'
            }
    """
    if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
        raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET not set")

    request_body = {
        "modelType": "Simple",
        "modelFormat": "Json",
        "geometry": {"type": "Polygon", "coordinates": [coordinates]},
        "downsample": False
    }

    timeout_cfg = aiohttp.ClientTimeout(total=None, sock_read=timeout)


    # Loop to handle token refresh and connection retries
    while True:
        try:
            async with aiohttp.ClientSession(timeout=timeout_cfg) as session:
                token = await _fetch_token(session)
                
                for attempt in range(2):
                    async with session.post(
                        "https://live.ais.barentswatch.no/live/v1/combined",
                        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                        json=request_body
                    ) as response:
                        if response.status == 401 and attempt == 0:
                            token = await _fetch_token(session)
                            continue
                        if response.status != 200:
                            error_text = await response.text()
                            raise ValueError(f"HTTP {response.status}: {error_text}")

                        async for line in response.content:
                            line = line.decode("utf-8").strip()
                            if line:
                                try:
                                    data = json.loads(line)
                                    yield data
                                except json.JSONDecodeError:
                                    continue
                        return
        except (aiohttp.ClientPayloadError, aiohttp.ServerDisconnectedError):
            await asyncio.sleep(2)
            continue
        except Exception as e:
            raise ValueError(f"Stream error: {type(e).__name__}: {str(e)}")


async def fetch_historic_mmsi_in_area(
    polygon: dict,
    msg_time_from: str,
    msg_time_to: str,
    session_logger: AISSessionLogger | None = None,
) -> list[int]:
    """
    Fetch a list of MMSIs of ships that were in a given area in a given timeframe.

    Calls the Barentswatch Historic API:
        POST https://historic.ais.barentswatch.no/v1/historic/mmsiinarea

    Constraints (enforced by the upstream API):
        - Max timeframe: 7 days
        - Max polygon area: 500 km²

    Args:
        polygon: GeoJSON geometry object, e.g.
            {"type": "Polygon", "coordinates": [[[lon, lat], ...]]}
        msg_time_from: ISO 8601 start datetime, e.g. "2026-02-17T08:00:00Z"
        msg_time_to:   ISO 8601 end datetime

    Returns:
        List of integer MMSIs present in the area during the timeframe.
    """
    if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
        raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET not set")

    request_body = {
        "polygon": polygon,
        "msgTimeFrom": msg_time_from,
        "msgTimeTo": msg_time_to,
    }

    logger.info(
        "[mmsiinarea] Requesting MMSIs in area | from=%s to=%s polygon_type=%s",
        msg_time_from,
        msg_time_to,
        polygon.get("type"),
    )

    async with aiohttp.ClientSession() as session:
        token = await _fetch_token(session)
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        async with session.post(
            "https://historic.ais.barentswatch.no/v1/historic/mmsiinarea",
            headers=headers,
            json=request_body,
            timeout=aiohttp.ClientTimeout(total=60),
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(
                    "[mmsiinarea] API error %s | from=%s to=%s | detail=%s",
                    response.status,
                    msg_time_from,
                    msg_time_to,
                    error_text,
                )
                raise ValueError(f"Historic mmsiinarea API HTTP {response.status}: {error_text}")
            result: list[int] = await response.json()
            logger.info(
                "[mmsiinarea] Received %d MMSI(s) | from=%s to=%s",
                len(result),
                msg_time_from,
                msg_time_to,
            )
            if session_logger is not None:
                for mmsi in result:
                    session_logger.log({
                        "mmsi": mmsi,
                        "timestamp": msg_time_to,
                        "latitude": 0.0,
                        "longitude": 0.0,
                        "speed": -1,
                        "heading": -1,
                        "courseOverGround": -1,
                    })
                session_logger.end_session()
            return result


async def _fetch_historic_data_per_track(
    session: aiohttp.ClientSession,
    token: str,
    mmsi: int,
    from_date: str,
    to_date: str,
    filter_satellite: bool = True,
) -> list[dict]:
    """
    Fetch historical AIS tracks for a single MMSI via:
        GET /v1/historic/tracks/{mmsi}/{fromDate}/{toDate}
    """
    from_enc = quote(from_date, safe="")
    to_enc = quote(to_date, safe="")
    url = (
        f"https://historic.ais.barentswatch.no/v1/historic/tracks"
        f"/{mmsi}/{from_enc}/{to_enc}"
        f"?modelFormat=Json&filterSatellitePositions={'true' if filter_satellite else 'false'}"
    )
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as response:
        if response.status == 404:
            logger.debug("[historic tracks] No data for MMSI %s (%s – %s)", mmsi, from_date, to_date)
            return []
        if response.status != 200:
            error_text = await response.text()
            logger.warning(
                "[historic tracks] HTTP %s for MMSI %s: %s", response.status, mmsi, error_text
            )
            return []

        raw = await response.json()
        if isinstance(raw, list):
            return raw
        return [raw] if raw else []


async def fetch_historic_ais_data(
    polygon: dict,
    from_date: str,
    to_date: str,
    filter_satellite: bool = True,
    concurrency: int = 10,
    session_logger: AISSessionLogger | None = None,
    log: bool = False,
) -> AsyncIterator[dict]:
    """
    Fetch historical AIS tracks for all vessels that were inside *polygon*
    between *from_date* and *to_date*.

    Strategy:
        1. POST /v1/historic/mmsiinarea  →  list of MMSIs present in the area
        2. For each MMSI, GET /v1/historic/tracks/{mmsi}/{fromDate}/{toDate}
           (requests are batched for concurrency control)

    Args:
        polygon: GeoJSON geometry object, e.g.
            {"type": "Polygon", "coordinates": [[[lon, lat], ...]]}
        from_date: ISO 8601 start datetime, e.g. "2026-02-19T08:10:00Z"
        to_date:   ISO 8601 end datetime
        filter_satellite: Pass filterSatellitePositions to the track endpoint.
        concurrency: Max simultaneous per-MMSI requests.
        session_logger: Optional logger; each yielded record is logged.

    Yields:
        Individual AIS track point dicts.
    """
    if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
        raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET not set")

    if log and session_logger is None:
        session_logger = AISSessionLogger()

    # ── Step 1: resolve MMSIs in the area ──────────────────────────────────
    logger.info("[historic] Resolving MMSIs in area | from=%s to=%s", from_date, to_date)
    mmsis = await fetch_historic_mmsi_in_area(polygon, from_date, to_date)
    if not mmsis:
        logger.info("[historic] No MMSIs found in area for the given timeframe.")
        if session_logger:
            session_logger.end_session()
        return
    logger.info("[historic] Found %d MMSI(s) — fetching tracks", len(mmsis))

    # ── Step 2: fetch tracks concurrently ─────────────────────────────────
    semaphore = asyncio.Semaphore(concurrency)

    async def bounded_fetch(session: aiohttp.ClientSession, token: str, mmsi: int) -> list[dict]:
        async with semaphore:
            return await _fetch_historic_data_per_track(session, token, mmsi, from_date, to_date, filter_satellite)

    async with aiohttp.ClientSession() as session:
        token = await _fetch_token(session)
        results = await asyncio.gather(
            *[bounded_fetch(session, token, mmsi) for mmsi in mmsis],
            return_exceptions=True,
        )

    total = 0
    for mmsi, result in zip(mmsis, results):
        if isinstance(result, Exception):
            logger.warning("[historic] Error fetching tracks for MMSI %s: %s", mmsi, result)
            continue
        for item in result:
            total += 1
            if session_logger:
                session_logger.log(item)
            yield item

    if session_logger:
        session_logger.end_session()
    logger.info("[historic] Yielded %d track point(s) across %d vessel(s)", total, len(mmsis))


def _build_fov_polygon(
    ship_lat: float,
    ship_lon: float,
    heading: float,
    offset_meters: float,
    fov_degrees: float,
) -> list[list[float]]:
    half_fov = fov_degrees / 2
    meters_per_degree_lat = 111_320
    meters_per_degree_lon = max(1e-6, 111_320 * math.cos(math.radians(ship_lat)))
    offset_lat = offset_meters / meters_per_degree_lat
    offset_lon = offset_meters / meters_per_degree_lon

    left_angle = heading - half_fov
    right_angle = heading + half_fov

    left_lat = ship_lat + offset_lat * math.cos(math.radians(left_angle))
    left_lon = ship_lon + offset_lon * math.sin(math.radians(left_angle))
    right_lat = ship_lat + offset_lat * math.cos(math.radians(right_angle))
    right_lon = ship_lon + offset_lon * math.sin(math.radians(right_angle))

    return [
        [ship_lon, ship_lat],
        [left_lon, left_lat],
        [right_lon, right_lat],
        [ship_lon, ship_lat],
    ]


async def fetch_vessel_position_by_mmsi(mmsi: str) -> ShipConfig | None:
    if not AIS_CLIENT_ID or not AIS_CLIENT_SECRET:
        raise ValueError("AIS_CLIENT_ID or AIS_CLIENT_SECRET not set")

    try:
        mmsi_int = int(mmsi.strip())
    except ValueError as exc:
        raise ValueError(f"Invalid MMSI: {mmsi} (must be numeric)") from exc

    request_body = {
        "modelType": "Simple",
        "modelFormat": "Json",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [-180, -90],
                [180, -90],
                [180, 90],
                [-180, 90],
                [-180, -90],
            ]],
        },
        "mmsi": [mmsi_int],
        "downsample": True,
    }

    async with aiohttp.ClientSession() as session:
        token = await _fetch_token(session)
        async with session.post(
            "https://live.ais.barentswatch.no/live/v1/combined",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=request_body,
            timeout=aiohttp.ClientTimeout(total=60, sock_read=30),
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise ValueError(f"HTTP {response.status}: {error_text}")

            async for line in response.content:
                text_line = line.decode("utf-8").strip()
                if not text_line:
                    continue
                try:
                    data = json.loads(text_line)
                except json.JSONDecodeError:
                    continue

                latitude = data.get("latitude")
                longitude = data.get("longitude")
                if latitude is None or longitude is None:
                    continue

                heading = data.get("trueHeading")
                if heading is None:
                    heading = data.get("courseOverGround", 0)

                return ShipConfig(
                    latitude=float(latitude),
                    longitude=float(longitude),
                    heading_deg=float(heading),
                )

    return None


def _project_feature(feature: dict, ship_cfg: ShipConfig, cam_cfg: CameraConfig) -> dict:
    lat = feature.get("latitude")
    lon = feature.get("longitude")
    projection = None
    if lat is not None and lon is not None:
        projection = project_ais_to_pixel(
            ship_cfg=ship_cfg,
            target_lat=float(lat),
            target_lon=float(lon),
            cam_cfg=cam_cfg,
        )

    enriched = dict(feature)
    enriched["projection"] = projection
    return enriched


async def fetch_ais_stream_projections(
    ship_lat: float,
    ship_lon: float,
    heading: float,
    offset_meters: float,
    fov_degrees: float,
) -> AsyncIterator[dict]:
    ship_cfg = ShipConfig(latitude=ship_lat, longitude=ship_lon, heading_deg=heading)
    cam_cfg = CameraConfig(h_fov_deg=fov_degrees)
    coordinates = _build_fov_polygon(
        ship_lat=ship_lat,
        ship_lon=ship_lon,
        heading=heading,
        offset_meters=offset_meters,
        fov_degrees=fov_degrees,
    )

    async for feature in fetch_ais_stream_geojson(coordinates=coordinates):
        yield _project_feature(feature, ship_cfg=ship_cfg, cam_cfg=cam_cfg)


async def fetch_ais_stream_projections_by_mmsi(
    mmsi: str,
    offset_meters: float = 3000,
    fov_degrees: float = 120,
) -> AsyncIterator[dict]:
    ship_cfg = await fetch_vessel_position_by_mmsi(mmsi)
    if ship_cfg is None:
        raise ValueError(f"Vessel with MMSI {mmsi} not found in Barentswatch AIS data")

    async for feature in fetch_ais_stream_projections(
        ship_lat=ship_cfg.latitude,
        ship_lon=ship_cfg.longitude,
        heading=ship_cfg.heading_deg,
        offset_meters=offset_meters,
        fov_degrees=fov_degrees,
    ):
        yield feature
