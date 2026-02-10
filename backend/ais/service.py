"""
AIS data accessors for the REST API.
"""
from __future__ import annotations

import csv
from datetime import datetime, timezone
from typing import Iterable

from common.config import AIS_S3_KEY, AIS_SAMPLE_PATH
from common.types import Vessel
from storage import s3
from .fetch_ais import fetch_ais


def _load_ais_csv_from_lines(lines: Iterable[str]) -> tuple[list[dict], dict[str, dict]]:
    data: list[dict] = []
    latest_by_mmsi: dict[str, tuple[int, dict]] = {}

    reader = csv.reader(lines)
    next(reader, None)  # header
    for row in reader:
        if not row or len(row) < 9:
            continue
        try:
            mmsi = str(int(float(row[1])))
            longitude = float(row[2])
            latitude = float(row[3])
            speed = float(row[4])
            course = float(row[5])
            heading = float(row[6])
            ship_type = int(float(row[7]))
            timestamp_ms = int(float(row[8]))
        except ValueError:
            continue

        msgtime = datetime.fromtimestamp(
            timestamp_ms / 1000, tz=timezone.utc
        ).isoformat()

        item = {
            "courseOverGround": course,
            "latitude": latitude,
            "longitude": longitude,
            "name": f"MMSI {mmsi}",
            "rateOfTurn": 0,
            "shipType": ship_type,
            "speedOverGround": speed,
            "trueHeading": heading,
            "navigationalStatus": 0,
            "mmsi": int(mmsi),
            "msgtime": msgtime,
        }
        data.append(item)

        previous = latest_by_mmsi.get(mmsi)
        if previous is None or timestamp_ms > previous[0]:
            latest_by_mmsi[mmsi] = (timestamp_ms, item)

    latest_items = {mmsi: entry for mmsi, (_, entry) in latest_by_mmsi.items()}
    return data, latest_items


def _load_ais_data() -> tuple[list[dict], dict[str, dict]]:
    text = s3.read_text_from_sources(AIS_S3_KEY, AIS_SAMPLE_PATH)
    if not text:
        return [], {}
    return _load_ais_csv_from_lines(text.splitlines())


AIS_SAMPLE_DATA, AIS_LATEST_BY_MMSI = _load_ais_data()


def build_vessel_from_ais(mmsi: str) -> Vessel | None:
    ais = AIS_LATEST_BY_MMSI.get(mmsi)
    if not ais:
        return None
    ship_type = ais.get("shipType")
    return Vessel(
        mmsi=mmsi,
        ship_type=str(ship_type) if ship_type is not None else None,
        speed=ais.get("speedOverGround"),
        heading=ais.get("trueHeading"),
        latitude=ais.get("latitude"),
        longitude=ais.get("longitude"),
    )


async def get_ais_data() -> list[dict]:
    if AIS_SAMPLE_DATA:
        return AIS_SAMPLE_DATA
    return await fetch_ais()
