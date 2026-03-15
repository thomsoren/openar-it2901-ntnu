"""
Mock stream data handling for the mock-data tab.

Replays pre-computed ground-truth fusion CSV data over a WebSocket so the
frontend can show what a fully-robust sensor fusion result looks like.
This pipeline is intentionally separate from the sensor_fusion module.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import List

from fastapi import WebSocket, WebSocketDisconnect

from ais import service as ais_service
from common.config import SAMPLE_DURATION, SAMPLE_START_SEC
from common.types import Detection, DetectedVessel
from storage import s3

logger = logging.getLogger(__name__)


@dataclass
class MockStreamState:
    width: int
    height: int
    fps: float
    start_second: int
    duration: int
    by_second: dict[int, list[dict]]


_mock_cache: MockStreamState | None = None
_mock_start_mono: float = time.monotonic()


def reset_sample_timer(profile: str = "mock") -> float:
    """Reset the mock stream timer so detections sync with tab playback start.

    The *profile* parameter is accepted for API compatibility but ignored.
    """
    global _mock_start_mono
    _mock_start_mono = time.monotonic()
    return _mock_start_mono


def _load_by_second(lines: List[str]) -> dict[int, list[dict]]:
    """Parse ground-truth fusion CSV lines into a dict keyed by second."""
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


def _build_vessel(row: dict) -> DetectedVessel:
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


def _load() -> MockStreamState | None:
    try:
        text = s3.read_text_from_sources(s3.resolve_system_asset_key("gt_fusion"))
    except Exception as exc:
        logger.warning("[mock_stream] Failed to load gt_fusion: %s", exc)
        return None

    if not text:
        logger.info("[mock_stream] Mock data unavailable")
        return None

    by_second = _load_by_second(text.splitlines())
    if not by_second:
        logger.info("[mock_stream] Mock data empty")
        return None

    min_second = min(by_second.keys())
    max_second = max(by_second.keys())
    start_second = SAMPLE_START_SEC if SAMPLE_START_SEC is not None else min_second
    duration = SAMPLE_DURATION if SAMPLE_DURATION is not None else (max_second - start_second + 1)
    if duration <= 0:
        duration = max(1, (max_second - min_second + 1))
        start_second = min_second

    return MockStreamState(
        width=2560,
        height=1440,
        fps=25.0,
        start_second=start_second,
        duration=duration,
        by_second=by_second,
    )


def _get_state() -> MockStreamState | None:
    global _mock_cache
    if _mock_cache is None:
        _mock_cache = _load()
    return _mock_cache


def _current_second(state: MockStreamState) -> int | None:
    if state.duration <= 0:
        return None
    elapsed = int(time.monotonic() - _mock_start_mono)
    return state.start_second + (elapsed % state.duration)


def get_detections() -> List[DetectedVessel]:
    """Return current detected vessels from the mock stream."""
    state = _get_state()
    if not state:
        return []
    second = _current_second(state)
    if second is None:
        return []
    return [_build_vessel(row) for row in state.by_second.get(second, [])]


async def handle_mock_stream_ws(websocket: WebSocket) -> None:
    """WebSocket handler — streams mock ground-truth fusion data."""
    await websocket.accept()
    try:
        state = _get_state()
        if not state:
            await websocket.send_json({"type": "error", "message": "Mock stream data not loaded"})
            return

        await websocket.send_json(
            {"type": "ready", "width": state.width, "height": state.height, "fps": state.fps}
        )

        last_second = None
        while True:
            second = _current_second(state)
            if second is not None and second != last_second:
                vessels = [_build_vessel(row) for row in state.by_second.get(second, [])]
                await websocket.send_json(
                    {
                        "type": "detections",
                        "frame_index": int(second * state.fps),
                        "timestamp_ms": second * 1000,
                        "fps": state.fps,
                        "vessels": [
                            {
                                "detection": v.detection.model_dump(),
                                "vessel": v.vessel.model_dump() if v.vessel else None,
                            }
                            for v in vessels
                        ],
                    }
                )
                last_second = second
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("[mock_stream] WS error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
