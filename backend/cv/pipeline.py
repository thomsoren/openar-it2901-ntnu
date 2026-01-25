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
import cv2

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
                    "fps": 1.0 / (time.time() - loop_start) if (time.time() - loop_start) > 0 else 0
                }
        finally:
            cap.release()

def _load_fusion_by_second_from_lines(lines: List[str]) -> dict[int, list[dict]]:
    by_second: dict[int, list[dict]] = {}
    for line in lines:
        row = line.strip()
        if not row: continue
        parts = [v.strip() for v in row.split(",")]
        if len(parts) < 7: continue
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
        except ValueError: continue
    return by_second

def _load_fusion_data() -> dict[int, list[dict]]:
    text = s3.read_text_from_sources("Fusion", settings.GT_FUSION_S3_KEY, settings.GT_FUSION_PATH)
    if not text: return {}
    return _load_fusion_by_second_from_lines(text.splitlines())

FUSION_BY_SECOND = _load_fusion_data()

def _get_sample_second() -> int | None:
    if settings.SAMPLE_START_SEC is None or settings.SAMPLE_DURATION is None:
        return None
    elapsed = int(time.monotonic() - settings.SAMPLE_START_MONO)
    return settings.SAMPLE_START_SEC + (elapsed % settings.SAMPLE_DURATION)

def get_detections() -> List[DetectedVessel]:
    """Fallback for REST API detections (used by Fusion page)."""
    global FUSION_BY_SECOND
    
    if not FUSION_BY_SECOND:
        print("Fusion data empty, attempting to reload...")
        FUSION_BY_SECOND = _load_fusion_data()

    if FUSION_BY_SECOND:
        current_second = _get_sample_second()
        if current_second is not None:
            vessels: List[DetectedVessel] = []
            frame_data = FUSION_BY_SECOND.get(current_second, [])
            print(f"Second {current_second}: Found {len(frame_data)} detections")
            for row in frame_data:
                vessel = ais_service.build_vessel_from_ais(str(row["mmsi"]))
                vessels.append(DetectedVessel(
                    detection=Detection(
                        x=row["left"] + row["width"] / 2,
                        y=row["top"] + row["height"] / 2,
                        width=row["width"],
                        height=row["height"],
                        confidence=row["confidence"],
                        track_id=int(row["mmsi"]) if row["mmsi"].isdigit() else None
                    ),
                    vessel=vessel
                ))
            return vessels
    else:
        print("Fusion data still empty after reload attempt.")
    return []

def _apply_temporal_smoothing(frames: list[dict], hold_duration: float = 0.3, min_confidence: float = 0.4) -> list[dict]:
    """
    Apply temporal smoothing with proper object tracking to reduce flickering.
    
    Args:
        frames: List of detection frames
        hold_duration: Minimum duration (in seconds) to hold each detection
        min_confidence: Minimum confidence threshold to include detections
    
    Returns:
        Smoothed frames with stable track IDs and reduced flickering
    """
    if not frames:
        return []
    
    fps = 25.0
    hold_frames = int(hold_duration * fps)
    max_distance = 100  # Maximum distance (pixels) to consider same object between frames
    
    print(f"Applying temporal smoothing with tracking: hold_duration={hold_duration}s, hold_frames={hold_frames}, min_confidence={min_confidence}")
    
    # Track objects: {track_id: {"detection": det, "last_seen": frame_idx, "position": (x, y)}}
    tracked_objects: dict[int, dict] = {}
    next_track_id = 1
    smoothed_frames = []
    
    for frame_idx, frame in enumerate(frames):
        detections_raw = frame.get("detections", [])
        current_frame_detections = []
        matched_track_ids = set()
        
        # First pass: match new detections to existing tracks
        unmatched_detections = []
        
        for det in detections_raw:
            if not isinstance(det, dict):
                continue
            
            confidence = det.get("confidence", 0)
            if confidence < min_confidence:
                continue
            
            x = det.get("x", 0)
            y = det.get("y", 0)
            
            # Try to match with existing tracked objects
            best_match_id = None
            best_distance = max_distance
            
            for track_id, tracked in tracked_objects.items():
                if track_id in matched_track_ids:
                    continue  # Already matched this frame
                
                tx, ty = tracked["position"]
                distance = ((x - tx) ** 2 + (y - ty) ** 2) ** 0.5
                
                if distance < best_distance:
                    best_distance = distance
                    best_match_id = track_id
            
            if best_match_id is not None:
                # Update existing track
                tracked_objects[best_match_id] = {
                    "detection": det,
                    "last_seen": frame_idx,
                    "position": (x, y)
                }
                matched_track_ids.add(best_match_id)
                
                # Add track_id to detection
                det_with_id = det.copy()
                det_with_id["track_id"] = best_match_id
                current_frame_detections.append(det_with_id)
            else:
                # New detection, will assign new track ID
                unmatched_detections.append(det)
        
        # Assign new track IDs to unmatched detections
        for det in unmatched_detections:
            x = det.get("x", 0)
            y = det.get("y", 0)
            
            tracked_objects[next_track_id] = {
                "detection": det,
                "last_seen": frame_idx,
                "position": (x, y)
            }
            
            det_with_id = det.copy()
            det_with_id["track_id"] = next_track_id
            current_frame_detections.append(det_with_id)
            next_track_id += 1
        
        # Add held detections from previous frames (within hold window)
        for track_id, tracked in list(tracked_objects.items()):
            frames_since_seen = frame_idx - tracked["last_seen"]
            
            if frames_since_seen > 0 and frames_since_seen <= hold_frames:
                # Keep this detection visible if not already in current frame
                if track_id not in matched_track_ids:
                    det_with_id = tracked["detection"].copy()
                    det_with_id["track_id"] = track_id
                    current_frame_detections.append(det_with_id)
            elif frames_since_seen > hold_frames:
                # Remove expired tracks
                del tracked_objects[track_id]
        
        # Create smoothed frame
        smoothed_frame = {
            "frame": frame.get("frame", frame_idx + 1),
            "timestamp": frame.get("timestamp", frame_idx / fps),
            "detections": current_frame_detections
        }
        smoothed_frames.append(smoothed_frame)
    
    total_before = sum(len(f.get("detections", [])) for f in frames)
    total_after = sum(len(f.get("detections", [])) for f in smoothed_frames)
    print(f"Smoothing complete: {len(frames)} frames, detections before={total_before}, after={total_after}, unique tracks={next_track_id - 1}")
    
    return smoothed_frames


@lru_cache(maxsize=1)
def _load_detection_frames() -> list[dict]:
    print(f"Loading detections from S3 key: {settings.DETECTIONS_S3_KEY}, Local path: {settings.DETECTIONS_PATH}")
    text = s3.read_text_from_sources("Detections", settings.DETECTIONS_S3_KEY, settings.DETECTIONS_PATH)
    if not text:
        print("Warning: No detections text loaded from S3 or local!")
        return []
    
    try:
        data = json.loads(text)
        if isinstance(data, list):
            print(f"Loaded {len(data)} detection frames directly")
            return data
        if isinstance(data, dict):
            for key in ("frames", "detections", "data"):
                if isinstance(data.get(key), list):
                    frames = data[key]
                    print(f"Loaded {len(frames)} detection frames from key '{key}'")
                    return frames
    except json.JSONDecodeError as e:
        print(f"JSON decode error: {e}")
    
    print("Warning: Could not parse detections data")
    return []

async def handle_fusion_ws(websocket: WebSocket) -> None:
    """WebSocket handler specifically for Fusion page - streams ground truth data synced with sample timer."""
    await websocket.accept()
    stop_event = asyncio.Event()

    try:
        print(f"Fusion WebSocket connected")
        
        # Load fusion data if not already loaded
        global FUSION_BY_SECOND
        if not FUSION_BY_SECOND:
            print("Loading fusion data...")
            FUSION_BY_SECOND = _load_fusion_data()
        
        if not FUSION_BY_SECOND:
            print("ERROR: Fusion data still empty after loading attempt")
            await websocket.send_json({"type": "error", "message": "Fusion data not loaded"})
            return
        
        print(f"Fusion data loaded: {len(FUSION_BY_SECOND)} seconds of data")
        
        # Send ready signal
        await websocket.send_json({
            "type": "ready",
            "width": 2560,
            "height": 1440,
            "fps": 25.0,
        })
        
        interval = 0.1  # Check every 100ms for fusion data updates
        last_second = None
        
        while not stop_event.is_set():
            current_second = _get_sample_second()
            
            if current_second is not None and current_second != last_second:
                frame_data = FUSION_BY_SECOND.get(current_second, [])
                vessels_payload = []
                
                for row in frame_data:
                    vessel = ais_service.build_vessel_from_ais(str(row["mmsi"]))
                    vessels_payload.append({
                        "detection": {
                            "x": float(row["left"] + row["width"] / 2),
                            "y": float(row["top"] + row["height"] / 2),
                            "width": float(row["width"]),
                            "height": float(row["height"]),
                            "confidence": float(row["confidence"]),
                            "track_id": int(row["mmsi"]) if str(row["mmsi"]).isdigit() else None,
                            "class_id": None,
                            "class_name": "boat"
                        },
                        "vessel": vessel.model_dump() if vessel else None
                    })
                
                await websocket.send_json({
                    "type": "detections",
                    "frame_index": current_second * 25,
                    "timestamp_ms": current_second * 1000,
                    "fps": 25.0,
                    "vessels": vessels_payload,
                })
                
                last_second = current_second
            
            await asyncio.sleep(interval)
    
    except WebSocketDisconnect:
        print("Fusion WebSocket disconnected")
        stop_event.set()
    except Exception as e:
        print(f"Fusion WS Error: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass


async def handle_detections_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    stop_event = asyncio.Event()

    try:
        try:
            config = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
        except asyncio.TimeoutError:
            config = {}

        print(f"Received WebSocket config: {config}")
        source = config.get("source", str(settings.VIDEO_PATH))
        track = config.get("track", True)
        loop = config.get("loop", True)
        mode = config.get("mode", settings.DETECTIONS_WS_MODE)  # Allow client to override mode
        
        print(f"WebSocket connected | mode: {mode} | source: {source} | track: {track}")

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
            raw_frames = _load_detection_frames()
            print(f"File mode: loaded {len(raw_frames)} raw frames")
            
            if not raw_frames:
                await websocket.send_json({"type": "error", "message": "No frames in detections file"})
                return
            
            # Apply temporal smoothing to reduce flickering
            # hold_duration: how long to keep detections visible (seconds)
            # min_confidence: filter out low-confidence detections that cause flickering
            frames = _apply_temporal_smoothing(
                raw_frames, 
                hold_duration=0.5,  # Hold each detection for 0.5 seconds (more stable)
                min_confidence=0.45  # Filter detections below 45% confidence
            )
            
            print(f"Streaming {len(frames)} smoothed detection frames")
            interval = 1.0 / video_fps if video_fps > 0 else 1.0 / 25.0
            idx = 0
            
            # Send first frame immediately to verify streaming works
            first_frame = frames[0]
            first_detections = first_frame.get("detections", [])
            print(f"First frame has {len(first_detections)} detections")
            
            while not stop_event.is_set():
                frame = frames[idx]
                
                # Parse detections from frame
                detections_raw = frame.get("detections", [])
                vessels_payload = []
                
                for det in detections_raw:
                    if not isinstance(det, dict):
                        continue
                    
                    # Extract coordinates (support multiple formats)
                    x = det.get("x")
                    y = det.get("y")
                    width = det.get("width")
                    height = det.get("height")
                    confidence = det.get("confidence", 1.0)
                    track_id = det.get("track_id")
                    
                    if x is not None and y is not None and width is not None and height is not None:
                        vessels_payload.append({
                            "detection": {
                                "x": float(x),
                                "y": float(y),
                                "width": float(width),
                                "height": float(height),
                                "confidence": float(confidence),
                                "track_id": track_id,
                                "class_id": None,
                                "class_name": "boat"
                            },
                            "vessel": None
                        })
                
                await websocket.send_json({
                    "type": "detections",
                    "frame_index": frame.get("frame", idx),
                    "timestamp_ms": frame.get("timestamp", idx / video_fps) * 1000,
                    "fps": video_fps,
                    "vessels": vessels_payload,
                })
                
                idx = (idx + 1) % len(frames)
                await asyncio.sleep(interval)
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
                
                vessels_payload = []
                for d in frame_data["vessels"]:
                    mmsi = str(d.track_id) if d.track_id else None
                    vessel = ais_service.build_vessel_from_ais(mmsi) if mmsi else None
                    
                    vessels_payload.append({
                        "detection": d.model_dump(),
                        "vessel": vessel.model_dump() if vessel else None
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
        print("Client disconnected")
        stop_event.set()
    except Exception as e:
        print(f"WS Error: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
