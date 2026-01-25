"""
Detection and streaming pipeline helpers.
"""
from __future__ import annotations

import asyncio
import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Iterable, List

from fastapi import WebSocket, WebSocketDisconnect

from ais import service as ais_service
from common import settings
from common.types import Detection, DetectedVessel, Vessel
from storage import s3
from .yolo_stream import get_processor


def _load_fusion_by_second_from_lines(lines: Iterable[str]) -> dict[int, list[dict]]:
    by_second: dict[int, list[dict]] = {}
    for line in lines:
        row = line.strip()
        if not row:
            continue
        parts = [value.strip() for value in row.split(",")]
        if len(parts) < 7:
            continue
        try:
            second = int(float(parts[0]))
            mmsi = parts[1]
            left = float(parts[2])
            top = float(parts[3])
            width = float(parts[4])
            height = float(parts[5])
            confidence = float(parts[6]) if parts[6] else 1.0
        except ValueError:
            continue
        by_second.setdefault(second, []).append(
            {
                "mmsi": mmsi,
                "left": left,
                "top": top,
                "width": width,
                "height": height,
                "confidence": confidence,
            }
        )
    return by_second


def _load_fusion_data() -> dict[int, list[dict]]:
    text = s3.read_text_from_sources(
        "Fusion",
        settings.GT_FUSION_S3_KEY,
        settings.GT_FUSION_PATH,
    )
    if not text:
        return {}
    return _load_fusion_by_second_from_lines(text.splitlines())


FUSION_BY_SECOND = _load_fusion_data()


@lru_cache(maxsize=1)
def _load_detection_frames() -> list[dict]:
    text = s3.read_text_from_sources(
        "Detections",
        settings.DETECTIONS_S3_KEY,
        settings.DETECTIONS_PATH,
    )
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("frames", "detections", "data"):
            value = data.get(key)
            if isinstance(value, list):
                return value
    return []


def _safe_number(value) -> float | None:
    try:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str) and value.strip():
            return float(value)
    except (TypeError, ValueError):
        return None
    return None


def _normalize_detection(raw: dict) -> dict | None:
    x = _safe_number(raw.get("x"))
    y = _safe_number(raw.get("y"))
    width = _safe_number(raw.get("width"))
    height = _safe_number(raw.get("height"))
    if None not in (x, y, width, height):
        return {"x": x, "y": y, "width": width, "height": height}

    left = _safe_number(raw.get("left") or raw.get("x1"))
    top = _safe_number(raw.get("top") or raw.get("y1"))
    right = _safe_number(raw.get("right") or raw.get("x2"))
    bottom = _safe_number(raw.get("bottom") or raw.get("y2"))
    if None not in (left, top, right, bottom):
        return {
            "x": left + (right - left) / 2,
            "y": top + (bottom - top) / 2,
            "width": right - left,
            "height": bottom - top,
        }

    bbox = raw.get("bbox") or raw.get("box")
    if isinstance(bbox, list) and len(bbox) >= 4:
        n0 = _safe_number(bbox[0])
        n1 = _safe_number(bbox[1])
        n2 = _safe_number(bbox[2])
        n3 = _safe_number(bbox[3])
        if None not in (n0, n1, n2, n3):
            if n2 > n0 and n3 > n1:
                return {
                    "x": n0 + (n2 - n0) / 2,
                    "y": n1 + (n3 - n1) / 2,
                    "width": n2 - n0,
                    "height": n3 - n1,
                }
            return {"x": n0, "y": n1, "width": n2, "height": n3}

    return None


def _extract_frame_detections(frame: dict) -> list[dict]:
    candidates = [
        frame.get("detections"),
        frame.get("predictions"),
        frame.get("objects"),
        frame.get("boxes"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list):
            return candidate
        if isinstance(candidate, dict) and isinstance(candidate.get("detections"), list):
            return candidate["detections"]
    return []


def _derive_file_fps(frames: list[dict], fallback: float) -> float:
    for frame in frames:
        frame_index = _safe_number(frame.get("frame") or frame.get("frame_index"))
        timestamp = _safe_number(frame.get("timestamp"))
        if frame_index and timestamp and timestamp > 0:
            return frame_index / timestamp
    return fallback


def _get_frame_index(frame: dict, default: int) -> int:
    frame_index = _safe_number(frame.get("frame") or frame.get("frame_index"))
    return int(frame_index) if frame_index is not None else default


def _get_timestamp_ms(frame: dict, frame_index: int, fps: float) -> float:
    timestamp_ms = _safe_number(frame.get("timestamp_ms"))
    if timestamp_ms is not None:
        return timestamp_ms
    timestamp = _safe_number(frame.get("timestamp"))
    if timestamp is not None:
        return timestamp * 1000
    if fps > 0:
        return (frame_index / fps) * 1000
    return 0.0


async def _stream_file_detections(
    websocket: WebSocket,
    frames: list[dict],
    fps: float,
    loop: bool,
    stop_event: asyncio.Event,
) -> None:
    if not frames:
        await websocket.send_json({"type": "error", "message": "Detections file is empty"})
        return

    frame_interval = 1.0 / fps if fps > 0 else 1.0 / 25.0
    index = 0
    total = len(frames)

    while not stop_event.is_set():
        frame = frames[index]
        frame_index = _get_frame_index(frame, index)
        timestamp_ms = _get_timestamp_ms(frame, frame_index, fps)
        raw_detections = _extract_frame_detections(frame)

        vessels = []
        for raw in raw_detections:
            if not isinstance(raw, dict):
                continue
            box = _normalize_detection(raw)
            if not box:
                continue
            confidence = _safe_number(raw.get("confidence") or raw.get("score") or raw.get("conf"))
            track_id = _safe_number(raw.get("track_id") or raw.get("trackId") or raw.get("id"))
            vessels.append(
                {
                    "detection": {
                        "x": box["x"],
                        "y": box["y"],
                        "width": box["width"],
                        "height": box["height"],
                        "confidence": confidence if confidence is not None else 1.0,
                        "track_id": int(track_id) if track_id is not None else None,
                    },
                    "vessel": None,
                }
            )

        await websocket.send_json(
            {
                "type": "detections",
                "frame_index": frame_index,
                "timestamp_ms": timestamp_ms,
                "fps": round(fps, 1),
                "vessels": vessels,
            }
        )

        index += 1
        if index >= total:
            if loop:
                index = 0
            else:
                await websocket.send_json({"type": "complete"})
                break

        await asyncio.sleep(frame_interval)


def _get_sample_second() -> int | None:
    if settings.SAMPLE_START_SEC is None or settings.SAMPLE_DURATION is None:
        return None
    elapsed = int(time.monotonic() - settings.SAMPLE_START_MONO)
    return settings.SAMPLE_START_SEC + (elapsed % settings.SAMPLE_DURATION)


def get_detections() -> List[DetectedVessel]:
    if FUSION_BY_SECOND:
        current_second = _get_sample_second()
        if current_second is not None:
            vessels: List[DetectedVessel] = []
            for row in FUSION_BY_SECOND.get(current_second, []):
                left = row["left"]
                top = row["top"]
                width = row["width"]
                height = row["height"]
                mmsi = str(row["mmsi"])
                vessel = ais_service.build_vessel_from_ais(mmsi)
                vessels.append(
                    DetectedVessel(
                        detection=Detection(
                            x=left + width / 2,
                            y=top + height / 2,
                            width=width,
                            height=height,
                            confidence=row["confidence"],
                            track_id=int(mmsi) if mmsi.isdigit() else None,
                        ),
                        vessel=vessel,
                    )
                )
            return vessels

    return _mock_vessels()


def _mock_vessels() -> List[DetectedVessel]:
    return [
        DetectedVessel(
            detection=Detection(
                x=500,
                y=400,
                width=120,
                height=80,
                confidence=0.92,
                track_id=1,
            ),
            vessel=Vessel(
                mmsi="259000001",
                name="MS Nordkapp",
                ship_type="Passenger",
                speed=15.2,
                heading=45.0,
                destination="Tromsø",
            ),
        ),
        DetectedVessel(
            detection=Detection(
                x=1200,
                y=350,
                width=80,
                height=50,
                confidence=0.85,
                track_id=2,
            ),
            vessel=Vessel(
                mmsi="259000002",
                name="Fishing Vessel",
                ship_type="Fishing",
                speed=8.5,
                heading=180.0,
            ),
        ),
        DetectedVessel(
            detection=Detection(
                x=800,
                y=500,
                width=60,
                height=40,
                confidence=0.78,
                track_id=3,
            ),
            vessel=None,
        ),
    ]


async def handle_detections_ws(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for YOLO detection streaming.

    Sends detection updates as YOLO processes video frames.
    Frontend plays video separately at native speed.

    Config (via initial message):
        source: Video source (default: settings.VIDEO_PATH)
        track: Enable tracking (default: true)
        loop: Loop video (default: true)
    """
    await websocket.accept()
    stop_event = asyncio.Event()

    try:
        # Wait for config or use defaults
        try:
            config = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        except asyncio.TimeoutError:
            config = {}

        source = config.get("source", str(settings.VIDEO_PATH))
        track = config.get("track", True)
        loop = config.get("loop", True)

        mode = settings.DETECTIONS_WS_MODE
        print(f"Detections WS mode: {mode}")

        # Validate source for live inference only
        if mode != "file":
            if isinstance(source, str) and not source.startswith(("rtsp://", "http://")):
                if not source.isdigit() and not Path(source).exists():
                    await websocket.send_json({"type": "error", "message": f"Source not found: {source}"})
                    await websocket.close()
                    return

        # Get video dimensions for frontend
        import cv2
        video_width = None
        video_height = None
        video_fps = None
        try:
            cap = cv2.VideoCapture(source)
            if cap.isOpened():
                video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            cap.release()
        except Exception:
            video_fps = None

        if mode == "file":
            frames = _load_detection_frames()
            fallback_fps = video_fps or 25.0
            file_fps = _derive_file_fps(frames, fallback_fps)
            await websocket.send_json({
                "type": "ready",
                "source": str(source),
                "width": video_width or 0,
                "height": video_height or 0,
                "fps": file_fps,
            })
            await _stream_file_detections(websocket, frames, file_fps, loop, stop_event)
            return

        await websocket.send_json({
            "type": "ready",
            "source": str(source),
            "width": video_width,
            "height": video_height,
            "fps": video_fps,
        })

        processor = get_processor()
        queue: asyncio.Queue = asyncio.Queue(maxsize=5)

        async def producer():
            loop_ref = asyncio.get_event_loop()

            def process():
                try:
                    for frame_data in processor.process_video(source=source, track=track, loop=loop):
                        if stop_event.is_set():
                            break
                        future = asyncio.run_coroutine_threadsafe(queue.put(frame_data), loop_ref)
                        try:
                            future.result(timeout=5.0)
                        except Exception:
                            break
                except Exception as exc:
                    print(f"Processing error: {exc}")
                finally:
                    asyncio.run_coroutine_threadsafe(queue.put(None), loop_ref)

            await loop_ref.run_in_executor(None, process)

        async def consumer():
            while not stop_event.is_set():
                try:
                    frame_data = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if frame_data is None:
                    await websocket.send_json({"type": "complete"})
                    break

                vessels = [
                    {
                        "detection": {
                            "x": d.x,
                            "y": d.y,
                            "width": d.width,
                            "height": d.height,
                            "confidence": d.confidence,
                            "track_id": d.track_id,
                        },
                        "vessel": None
                    }
                    for d in frame_data.detections
                ]

                await websocket.send_json({
                    "type": "detections",
                    "frame_index": frame_data.frame_index,
                    "timestamp_ms": frame_data.timestamp_ms,
                    "fps": round(frame_data.fps, 1),
                    "vessels": vessels,
                })

        await asyncio.gather(producer(), consumer())

    except WebSocketDisconnect:
        print("Client disconnected")
        stop_event.set()
    except Exception as exc:
        print(f"WebSocket error: {exc}")
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
