"""
Detection and streaming pipeline helpers.
"""
from __future__ import annotations

import asyncio
import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Generator, List, Optional

from fastapi import WebSocket, WebSocketDisconnect

from ais import service as ais_service
from common import settings
from common.types import Detection, DetectedVessel, Vessel
from storage import s3
from .utils import get_video_info
from .detectors import get_detector
from .trackers import ByteTracker

class VideoPipeline:
    """
    Main processing pipeline for video streams.
    Combines detection, tracking, and AIS matching.
    """
    def __init__(self, detector_type: str = "yolo", track: bool = True):
        self.detector = get_detector(detector_type)
        self.tracker = ByteTracker() if track else None
        self.track_enabled = track

    def process_video(
        self,
        source: str | int,
        loop: bool = True,
    ) -> Generator[dict, None, None]:
        """
        Process video and yield detections synced to real-time.
        """
        import cv2
        cap = cv2.VideoCapture(source)
        if not cap.isOpened():
            return

        source_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        video_duration_ms = (total_frames / source_fps) * 1000 if total_frames > 0 else 0

        playback_start = time.time()
        
        try:
            while True:
                loop_start = time.time()
                elapsed_ms = (time.time() - playback_start) * 1000

                if loop and video_duration_ms > 0:
                    elapsed_ms = elapsed_ms % video_duration_ms

                cap.set(cv2.CAP_PROP_POS_MSEC, elapsed_ms)
                ret, frame = cap.read()
                if not ret:
                    if loop:
                        playback_start = time.time()
                        continue
                    break

                frame_index = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
                timestamp_ms = cap.get(cv2.CAP_PROP_POS_MSEC)

                # 1. Detection
                detections = self.detector.detect(frame)

                # 2. Tracking
                if self.tracker:
                    vessels = self.tracker.update(detections)
                else:
                    vessels = detections

                # 3. Format for API
                yield {
                    "frame_index": frame_index,
                    "timestamp_ms": timestamp_ms,
                    "vessels": vessels,
                    "fps": 1.0 / (time.time() - loop_start)
                }
        finally:
            cap.release()

@lru_cache(maxsize=1)
def _load_detection_frames() -> list[dict]:
    text = s3.read_text_from_sources("Detections", settings.DETECTIONS_S3_KEY, settings.DETECTIONS_PATH)
    if not text: return []
    try:
        data = json.loads(text)
        if isinstance(data, list): return data
        if isinstance(data, dict):
            for key in ("frames", "detections", "data"):
                if isinstance(data.get(key), list): return data[key]
    except json.JSONDecodeError: pass
    return []

async def handle_detections_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    stop_event = asyncio.Event()

    try:
        try:
            config = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        except asyncio.TimeoutError:
            config = {}

        source = config.get("source", str(settings.VIDEO_PATH))
        track = config.get("track", True)
        loop = config.get("loop", True)
        mode = settings.DETECTIONS_WS_MODE

        info = get_video_info(source)
        video_fps = info.fps if info else 25.0
        
        await websocket.send_json({
            "type": "ready",
            "source": str(source),
            "width": info.width if info else 0,
            "height": info.height if info else 0,
            "fps": video_fps,
        })

        if mode == "file":
            frames = _load_detection_frames()
            # Simple file streaming logic (omitted for brevity, can be added if needed)
            return

        pipeline = VideoPipeline(track=track)
        loop_ref = asyncio.get_event_loop()
        queue = asyncio.Queue(maxsize=5)

        def producer_sync():
            try:
                for frame_data in pipeline.process_video(source, loop=loop):
                    if stop_event.is_set(): break
                    asyncio.run_coroutine_threadsafe(queue.put(frame_data), loop_ref).result()
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop_ref)

        async def consumer():
            while not stop_event.is_set():
                frame_data = await queue.get()
                if frame_data is None: break
                
                # AIS Matching could happen here
                vessels_payload = []
                for d in frame_data["vessels"]:
                    vessels_payload.append({
                        "detection": d.dict(),
                        "vessel": None # Placeholder for AIS
                    })

                await websocket.send_json({
                    "type": "detections",
                    "frame_index": frame_data["frame_index"],
                    "timestamp_ms": frame_data["timestamp_ms"],
                    "fps": round(frame_data["fps"], 1),
                    "vessels": vessels_payload,
                })

        await asyncio.gather(
            loop_ref.run_in_executor(None, producer_sync),
            consumer()
        )

    except WebSocketDisconnect:
        stop_event.set()
    except Exception as e:
        print(f"WS Error: {e}")

def get_detections() -> List[DetectedVessel]:
    """Fallback for REST API detections."""
    # This can use the same pipeline or static data
    return []
