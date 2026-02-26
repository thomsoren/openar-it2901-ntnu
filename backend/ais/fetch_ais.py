import os
import logging
import aiohttp
import asyncio
import json
from urllib.parse import quote
from dotenv import load_dotenv
from typing import AsyncIterator, List

from .logger import AISSessionLogger

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
