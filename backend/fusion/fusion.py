"""
Fusion ground truth data handling for FVessel dataset.

This module handles loading and serving pre-labeled fusion data
that combines AIS vessel info with visual detections.
"""
from __future__ import annotations

import asyncio
import time
from typing import List

from fastapi import WebSocket, WebSocketDisconnect

from ais import service as ais_service
from common.config import (
    GT_FUSION_S3_KEY, GT_FUSION_PATH,
    SAMPLE_START_SEC, SAMPLE_DURATION,
)
from common.types import Detection, DetectedVessel
from storage import s3

# Sample timing state (module-level for this fusion feature)
_SAMPLE_START_MONO = time.monotonic()


def reset_sample_timer() -> float:
    """Reset sample timing so detections sync with video playback start."""
    global _SAMPLE_START_MONO
    _SAMPLE_START_MONO = time.monotonic()
    return _SAMPLE_START_MONO


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
            by_second.setdefault(second, []).append({
                "mmsi": mmsi, "left": left, "top": top,
                "width": width, "height": height, "confidence": conf
            })
        except ValueError:
            continue
    return by_second


def _load_fusion_data() -> dict[int, list[dict]]:
    """Load fusion ground truth data. Returns empty dict if unavailable."""
    try:
        text = s3.read_text_from_sources(GT_FUSION_S3_KEY, GT_FUSION_PATH)
        if not text:
            print("[INFO] Fusion data not available - fusion features disabled")
            return {}
        result = _load_fusion_by_second(text.splitlines())
        print(f"[INFO] Fusion data loaded: {len(result)} seconds of data")
        return result
    except Exception as e:
        print(f"[WARN] Failed to load fusion data: {e} - fusion features disabled")
        return {}


# Load on module import
FUSION_BY_SECOND = _load_fusion_data()


def _get_sample_second() -> int | None:
    """Get current playback second based on sample timing."""
    if SAMPLE_START_SEC is None or SAMPLE_DURATION is None:
        return None
    elapsed = int(time.monotonic() - _SAMPLE_START_MONO)
    return SAMPLE_START_SEC + (elapsed % SAMPLE_DURATION)


def _build_vessel_from_row(row: dict) -> DetectedVessel:
    """Build DetectedVessel from fusion row data."""
    mmsi = str(row["mmsi"])
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


def get_detections() -> List[DetectedVessel]:
    """Return current detected vessels from fusion data."""
    if not FUSION_BY_SECOND:
        return []

    current_second = _get_sample_second()
    if current_second is None:
        return []

    return [_build_vessel_from_row(row) for row in FUSION_BY_SECOND.get(current_second, [])]


async def handle_fusion_ws(websocket: WebSocket) -> None:
    """WebSocket handler for Fusion page - streams ground truth data."""
    await websocket.accept()

    try:
        global FUSION_BY_SECOND
        if not FUSION_BY_SECOND:
            FUSION_BY_SECOND = _load_fusion_data()

        if not FUSION_BY_SECOND:
            await websocket.send_json({"type": "error", "message": "Fusion data not loaded"})
            return

        await websocket.send_json({
            "type": "ready",
            "width": 2560,
            "height": 1440,
            "fps": 25.0,
        })

        last_second = None
        while True:
            current_second = _get_sample_second()

            if current_second is not None and current_second != last_second:
                vessels = [_build_vessel_from_row(row) for row in FUSION_BY_SECOND.get(current_second, [])]
                vessels_payload = [
                    {
                        "detection": v.detection.model_dump(),
                        "vessel": v.vessel.model_dump() if v.vessel else None,
                    }
                    for v in vessels
                ]

                await websocket.send_json({
                    "type": "detections",
                    "frame_index": current_second * 25,
                    "timestamp_ms": current_second * 1000,
                    "fps": 25.0,
                    "vessels": vessels_payload,
                })
                last_second = current_second

            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Fusion WS Error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
