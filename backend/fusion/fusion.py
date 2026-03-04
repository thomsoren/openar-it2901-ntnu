"""
Fusion data handling for Datavision special tabs.

Profiles:
- mock: FVessel mock data (existing gt_fusion CSV-style rows)
- pirbadet: AIS NDJSON-driven projection feed
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List

from fastapi import WebSocket, WebSocketDisconnect

from ais import service as ais_service
from common.config import SAMPLE_DURATION, SAMPLE_START_SEC
from common.types import Detection, DetectedVessel, Vessel
from storage import s3

logger = logging.getLogger(__name__)

SUPPORTED_PROFILES = {"mock", "pirbadet"}
PIRBADET_AIS_ASSET_NAMES = ("fusion_ais_pirbadet",)
PIRBADET_BOX_WIDTH = 80.0
PIRBADET_BOX_HEIGHT = 48.0


@dataclass
class FusionProfileState:
    profile: str
    width: int
    height: int
    fps: float
    start_second: int
    duration: int
    by_second: dict[int, list[dict]]
    row_kind: str  # "gt" | "ais_ndjson"


_PROFILE_CACHE: dict[str, FusionProfileState] = {}
_PROFILE_START_MONO: dict[str, float] = {p: time.monotonic() for p in SUPPORTED_PROFILES}


def _normalise_profile(profile: str | None) -> str:
    value = (profile or "mock").strip().lower()
    if value in SUPPORTED_PROFILES:
        return value
    return "mock"


def reset_sample_timer(profile: str = "mock") -> float:
    """Reset profile timing so detections sync with tab playback start."""
    selected = _normalise_profile(profile)
    started_at = time.monotonic()
    _PROFILE_START_MONO[selected] = started_at
    return started_at


def _parse_iso_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _load_fusion_by_second(lines: List[str]) -> dict[int, list[dict]]:
    """Parse fusion ground truth CSV lines into a dict keyed by second."""
    by_second: dict[int, list[dict]] = {}
    for line in lines:
        row = line.strip()
        if not row:
            continue
        parts = [v.strip() for v in row.split(",")]
        if len(parts) < 7:
            continue
        try:
            second = int(float(parts[0]))
            mmsi = parts[1]
            left, top = float(parts[2]), float(parts[3])
            width, height = float(parts[4]), float(parts[5])
            conf = float(parts[6]) if parts[6] else 1.0
            by_second.setdefault(second, []).append(
                {
                    "mmsi": mmsi,
                    "left": left,
                    "top": top,
                    "width": width,
                    "height": height,
                    "confidence": conf,
                }
            )
        except ValueError:
            continue
    return by_second


def _iter_pirbadet_text_sources() -> list[tuple[str, str]]:
    sources: list[tuple[str, str]] = []
    for asset_name in PIRBADET_AIS_ASSET_NAMES:
        try:
            s3_key = s3.resolve_system_asset_key(asset_name)
        except Exception:
            continue
        text = s3.read_text_from_sources(s3_key)
        if text and text.strip():
            sources.append((f"{asset_name} (s3://{s3_key})", text))

    return sources


def _load_pirbadet_ais_by_second(lines: List[str]) -> tuple[dict[int, list[dict]], int]:
    rows_with_time: list[tuple[datetime, dict]] = []
    first_ts: datetime | None = None

    for line in lines:
        raw = line.strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue

        if parsed.get("type") in {"session_start", "session_end"}:
            continue
        if not isinstance(parsed.get("projection"), dict):
            continue
        if "msgtime" not in parsed:
            continue

        msg_ts = _parse_iso_datetime(parsed.get("msgtime"))
        if msg_ts is None:
            continue

        rows_with_time.append((msg_ts, parsed))
        if first_ts is None or msg_ts < first_ts:
            first_ts = msg_ts

    if not rows_with_time or first_ts is None:
        return {}, 0

    by_second: dict[int, list[dict]] = {}
    max_second = 0
    for ts, row in rows_with_time:
        second = max(0, int((ts - first_ts).total_seconds()))
        by_second.setdefault(second, []).append(row)
        if second > max_second:
            max_second = second

    duration = max_second + 1
    return by_second, duration


def _build_vessel_from_gt_row(row: dict) -> DetectedVessel:
    raw_mmsi = row.get("mmsi")
    try:
        mmsi = str(int(float(raw_mmsi)))
    except (TypeError, ValueError):
        mmsi = str(raw_mmsi)
    vessel = ais_service.build_vessel_from_ais(mmsi)
    return DetectedVessel(
        detection=Detection(
            x=row["left"] + row["width"] / 2,
            y=row["top"] + row["height"] / 2,
            width=row["width"],
            height=row["height"],
            confidence=row["confidence"],
            track_id=int(mmsi) if mmsi.isdigit() else None,
        ),
        vessel=vessel,
    )


def _build_vessel_from_ais_ndjson_row(row: dict) -> DetectedVessel | None:
    projection = row.get("projection")
    if not isinstance(projection, dict):
        return None
    try:
        x_px = float(projection["x_px"])
        y_px = float(projection["y_px"])
    except (KeyError, TypeError, ValueError):
        return None

    mmsi = str(row.get("mmsi", "")).strip()
    track_id = int(mmsi) if mmsi.isdigit() else None
    ship_type = row.get("shipType")
    vessel = Vessel(
        mmsi=mmsi,
        name=row.get("name"),
        ship_type=str(ship_type) if ship_type is not None else None,
        speed=row.get("speedOverGround"),
        heading=row.get("trueHeading"),
        latitude=row.get("latitude"),
        longitude=row.get("longitude"),
    )

    return DetectedVessel(
        detection=Detection(
            x=x_px,
            y=y_px,
            width=PIRBADET_BOX_WIDTH,
            height=PIRBADET_BOX_HEIGHT,
            confidence=1.0,
            class_name="boat",
            track_id=track_id,
        ),
        vessel=vessel,
    )


def _load_mock_profile() -> FusionProfileState | None:
    try:
        text = s3.read_text_from_sources(s3.resolve_system_asset_key("gt_fusion"))
    except Exception as exc:
        logger.warning("[fusion:mock] Failed to load gt_fusion: %s", exc)
        return None

    if not text:
        logger.info("[fusion:mock] Fusion mock data unavailable")
        return None

    by_second = _load_fusion_by_second(text.splitlines())
    if not by_second:
        logger.info("[fusion:mock] Fusion mock data empty")
        return None

    min_second = min(by_second.keys())
    max_second = max(by_second.keys())
    start_second = SAMPLE_START_SEC if SAMPLE_START_SEC is not None else min_second
    duration = SAMPLE_DURATION if SAMPLE_DURATION is not None else (max_second - start_second + 1)
    if duration <= 0:
        duration = max(1, (max_second - min_second + 1))
        start_second = min_second

    return FusionProfileState(
        profile="mock",
        width=2560,
        height=1440,
        fps=25.0,
        start_second=start_second,
        duration=duration,
        by_second=by_second,
        row_kind="gt",
    )


def _load_pirbadet_profile() -> FusionProfileState | None:
    sources = _iter_pirbadet_text_sources()
    if not sources:
        logger.warning("[fusion:pirbadet] AIS NDJSON unavailable (media_assets/S3)")
        return None

    for source_label, text in sources:
        by_second, duration = _load_pirbadet_ais_by_second(text.splitlines())
        if not by_second or duration <= 0:
            logger.warning(
                "[fusion:pirbadet] Source '%s' had no usable AIS NDJSON rows, trying next source",
                source_label,
            )
            continue

        logger.info(
            "[fusion:pirbadet] Loaded AIS NDJSON from %s (%d timeline seconds)",
            source_label,
            duration,
        )
        return FusionProfileState(
            profile="pirbadet",
            width=1920,
            height=1080,
            fps=30.0,
            start_second=0,
            duration=duration,
            by_second=by_second,
            row_kind="ais_ndjson",
        )

    logger.warning("[fusion:pirbadet] No usable AIS NDJSON in any configured source")
    return None


def _load_profile(profile: str) -> FusionProfileState | None:
    if profile == "pirbadet":
        return _load_pirbadet_profile()
    return _load_mock_profile()


def _get_profile(profile: str) -> FusionProfileState | None:
    if profile not in _PROFILE_CACHE:
        loaded = _load_profile(profile)
        if loaded is None:
            return None
        _PROFILE_CACHE[profile] = loaded
    return _PROFILE_CACHE[profile]


def _get_profile_second(state: FusionProfileState) -> int | None:
    if state.duration <= 0:
        return None
    started_at = _PROFILE_START_MONO.get(state.profile)
    if started_at is None:
        started_at = time.monotonic()
        _PROFILE_START_MONO[state.profile] = started_at
    elapsed = int(time.monotonic() - started_at)
    return state.start_second + (elapsed % state.duration)


def _build_vessels_for_second(state: FusionProfileState, second: int) -> list[DetectedVessel]:
    rows = state.by_second.get(second, [])
    vessels: list[DetectedVessel] = []
    if state.row_kind == "gt":
        for row in rows:
            vessels.append(_build_vessel_from_gt_row(row))
        return vessels

    for row in rows:
        built = _build_vessel_from_ais_ndjson_row(row)
        if built is not None:
            vessels.append(built)
    return vessels


def get_detections() -> List[DetectedVessel]:
    """Return current detected vessels from the mock fusion profile."""
    state = _get_profile("mock")
    if not state:
        return []
    current_second = _get_profile_second(state)
    if current_second is None:
        return []
    return _build_vessels_for_second(state, current_second)


async def handle_fusion_ws(websocket: WebSocket, profile: str = "mock") -> None:
    """WebSocket handler for Fusion tabs - streams profile-specific data."""
    selected = _normalise_profile(profile)
    await websocket.accept()

    try:
        state = _get_profile(selected)
        if not state:
            await websocket.send_json(
                {"type": "error", "message": f"Fusion data not loaded for profile '{selected}'"}
            )
            return

        await websocket.send_json(
            {"type": "ready", "width": state.width, "height": state.height, "fps": state.fps}
        )

        last_second = None
        while True:
            current_second = _get_profile_second(state)
            if current_second is not None and current_second != last_second:
                vessels = _build_vessels_for_second(state, current_second)
                vessels_payload = [
                    {
                        "detection": v.detection.model_dump(),
                        "vessel": v.vessel.model_dump() if v.vessel else None,
                    }
                    for v in vessels
                ]

                await websocket.send_json(
                    {
                        "type": "detections",
                        "frame_index": int(current_second * state.fps),
                        "timestamp_ms": current_second * 1000,
                        "fps": state.fps,
                        "vessels": vessels_payload,
                    }
                )
                last_second = current_second

            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("Fusion WS error (%s): %s", selected, exc)
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
