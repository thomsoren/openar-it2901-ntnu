"""
FastAPI backend for boat detection and AIS data.

Architecture:
- /api/detections: Returns current detected vessels (YOLO + AIS)
- /api/detections/ws/{stream_id}: WebSocket for real-time YOLO streaming detections
- /api/video: Streams video for the frontend
- /api/ais: Fetches AIS data from external API
- /api/ais/stream: Streams live AIS data in geographical field of view
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from queue import Empty
from typing import List
from urllib.parse import urlparse
import logging
import re
from contextlib import asynccontextmanager
from typing import List

import cv2
from fastapi import FastAPI, HTTPException, Request, WebSocket
from starlette.websockets import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from ais import service as ais_service
from ais.fetch_ais import fetch_ais_stream_geojson
from common.config import BASE_DIR, VIDEO_PATH, load_samples
from redis.exceptions import RedisError

from ais import service as ais_service
from ais.fetch_ais import fetch_ais_stream_geojson
from ais.logger import AISSessionLogger
from common.config import (
    DEFAULT_DETECTIONS_STREAM_ID,
    VIDEO_PATH,
    create_async_redis_client,
    detections_channel,
    load_samples,
)
from common.types import DetectedVessel
from fusion import fusion
from orchestrator import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
    StreamConfig,
    StreamNotFoundError,
    WorkerOrchestrator,
)
from storage import s3

logger = logging.getLogger(__name__)

app = FastAPI(
    title="OpenAR Backend API",
    description="API for boat detection and AIS vessel data",
    version="0.2.0"
)

# Configure CORS to allow frontend requests.
# Includes localhost and common LAN/private-network ranges for device testing.
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",  # Vite default dev server
    "http://localhost:3000",  # Alternative React dev server
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "https://demo.bridgable.ai",  # Production frontend
    "http://demo.bridgable.ai",   # Production frontend (HTTP)
]
ENV_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[*DEFAULT_ALLOWED_ORIGINS, *ENV_ALLOWED_ORIGINS],
    allow_origin_regex=r"^https?://(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "OpenAR Backend API is running",
        "endpoints": {
            "detections": "/api/detections",
            "detections_file": "/api/detections/file",
            "detections_ws": "/api/detections/ws/{stream_id}",
            "streams": "/api/streams",
            "video": "/api/video",
            "ais": "/api/ais",
            "ais_stream": "/api/ais/stream",
            "ais_projections": "/api/ais/projections",
            "ais_projections_mmsi": "/api/ais/projections/mmsi",
            "samples": "/api/samples",
            "storage_presign": "/api/storage/presign",
            "health": "/health"
        }
    }


@app.get("/health")
def health_check():
    """Health check with file availability status"""
    try:
        return s3.health_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")


@app.get("/api/samples")
def list_samples():
    """List available AIS + Datavision samples."""
    try:
        return {"samples": load_samples()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading samples: {str(e)}")


@app.post("/api/fusion/reset")
def reset_fusion_timer():
    """Reset fusion sample timer to sync detections with video playback."""
    try:
        start = fusion.reset_sample_timer()
        return {"status": "ok", "start_mono": start}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error resetting fusion timer: {str(e)}")


@app.post("/api/storage/presign")
def presign_storage(request: s3.PresignRequest):
    """Generate a presigned URL for GET/PUT against S3 storage."""
    try:
        return s3.presign_storage(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating presigned URL: {str(e)}")


@app.get("/api/detections", response_model=List[DetectedVessel])
def get_detections() -> List[DetectedVessel]:
    """
    Get current detected vessels with AIS data.

    For now, returns mock data or FVessel samples for frontend development.
    """
    try:
        return fusion.get_detections()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching detections: {str(e)}")


@app.get("/api/detections/file")
def get_detections_file(request: Request):
    """Serve precomputed detections JSON via backend (S3/local fallback)."""
    try:
        return s3.detections_response(request)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Detections file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving detections file: {str(e)}")


@app.get("/api/video")
def get_video():
    """Serve video file directly."""
    path = VIDEO_PATH
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail=f"Video not found: {path}")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/video/mjpeg")
async def stream_mjpeg():
    return await stream_mjpeg_for_stream(DEFAULT_STREAM_ID)


@app.get("/api/video/mjpeg/{stream_id}")
async def stream_mjpeg_for_stream(stream_id: str):
    """MJPEG stream from inference worker - synced with detections."""
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator unavailable")

    try:
        initial_handle = orchestrator.get_stream(stream_id)
    except StreamNotFoundError:
        raise HTTPException(status_code=404, detail=f"Stream '{stream_id}' is not running")

    async def generate():
        current_handle = initial_handle
        # Track queue identity, not handle identity — the orchestrator mutates the
        # handle in-place on restart (same Python object, new frame_queue attribute).
        current_queue = current_handle.frame_queue

        while True:
            try:
                data = await asyncio.to_thread(current_queue.get, True, 0.05)
            except Empty:
                # On timeout, verify stream still exists and pick up a new queue
                # if the worker was restarted since the last iteration.
                try:
                    orchestrator.get_stream(stream_id)
                except StreamNotFoundError:
                    break
                new_queue = current_handle.frame_queue
                if new_queue is not current_queue:
                    current_queue = new_queue
                continue

            if data is None:
                # Sentinel: worker exited. Don't break — the orchestrator will restart
                # the worker and update handle.frame_queue. Continue polling until the
                # new queue appears or the stream is fully removed.
                try:
                    orchestrator.get_stream(stream_id)
                except StreamNotFoundError:
                    break
                new_queue = current_handle.frame_queue
                if new_queue is not current_queue:
                    current_queue = new_queue
                # Either way continue — Empty path will poll until new frames arrive.
                continue

            frame, _, _ = data
            _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg.tobytes() + b"\r\n"

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"}
    )


@app.get("/api/video/fusion")
def get_fusion_video(request: Request):
    """Stream FVessel sample video for AIS + Datavision."""
    try:
        return s3.fusion_video_response(request)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fusion video file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error streaming fusion video: {str(e)}")


@app.get("/api/assets/oceanbackground")
def get_components_background():
    """Serve the Components page background image."""
    try:
        return s3.components_background_response()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Background image not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving background image: {str(e)}")


@app.get("/api/video/stream")
async def stream_video(request: Request):
    """
    Advanced video streaming endpoint with range request support
    """
    try:
        return s3.video_stream_response(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in video stream: {str(e)}")


@app.get("/api/ais")
async def get_ais_data():
    """Fetch AIS data from external API (Barentswatch AIS)"""
    try:
        return await ais_service.get_ais_data()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching AIS data: {str(e)}"
        )


@app.get("/api/ais/stream")
async def stream_ais_geojson(
    ship_lat: float = 63.4365,
    ship_lon: float = 10.3835,
    heading: float = 90,
    offset_meters: float = 1000,
    fov_degrees: float = 60,
    log: bool = False
):
    """
    Stream live AIS data in ship's triangular field of view.
    
    Server-Sent Events (SSE) endpoint that streams AIS vessel data for vessels 
    within a triangular field of view from the observer's position.
    
    Args:
        ship_lat: Observer latitude
        ship_lon: Observer longitude
        heading: Observer heading in degrees
        offset_meters: Distance from observer to triangle base in meters
        fov_degrees: Field of view angle in degrees
    
    Example response:
        {
            "courseOverGround": 91.6,
            "latitude": 63.439217,
            "longitude": 10.398745,
            "name": "OCEAN SPACE DRONE1",
            "rateOfTurn": -9,
            "shipType": 99,
            "speedOverGround": 0,
            "trueHeading": 140,
            "navigationalStatus": 0,
            "mmsi": 257030830,
            "msgtime": "2026-02-17T14:40:14+00:00",
            "stream": "terra"
        }
    """
    logger = AISSessionLogger() if log else None
    
    async def event_generator():
        try:
            async for feature in fetch_ais_stream_geojson(
                ship_lat=ship_lat,
                ship_lon=ship_lon,
                heading=heading,
                offset_meters=offset_meters,
                fov_degrees=fov_degrees
            ):
                if logger:
                    logger.log(feature)
                yield f"data: {json.dumps(feature)}\n\n"
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
        finally:
            if logger:
                print(f"[API] Stream closed. Calling logger.end_session()")
                metadata = logger.end_session()
                print(f"[API] Logging session ended. Total logged: {metadata.get('total_records', 0)}, Files: {metadata.get('total_splits', 0)}")
                # Notify frontend if logging failed
                if not metadata.get("flush_success", False):
                    warning = {
                        "type": "error",
                        "message": "AIS logging failed",
                        "detail": metadata.get("flush_error"),
                        "total_logged": metadata.get("total_records", 0),
                        "records_written": metadata.get("total_file_size_bytes", 0)
                    }
                    yield f"data: {json.dumps(warning)}\n\n"
                # Notify frontend if logging was split into multiple files
                elif metadata.get("total_splits", 1) > 1:
                    info = {
                        "type": "info",
                        "message": "AIS logging completed with multiple files",
                        "detail": f"Session was split into {metadata.get('total_splits')} files due to buffer size",
                        "total_logged": metadata.get("total_records", 0),
                        "total_file_size_bytes": metadata.get("total_file_size_bytes", 0),
                        "log_files": metadata.get("log_files", [])
                    }
                    yield f"data: {json.dumps(info)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )


MAX_WORKERS = int(os.getenv("MAX_WORKERS", "8"))
DEFAULT_STREAM_ID = os.getenv("DEFAULT_STREAM_ID", "default")

orchestrator: WorkerOrchestrator | None = None
connected_clients: dict[str, set[WebSocket]] = {}
broadcast_tasks: dict[str, asyncio.Task] = {}
video_info: dict[str, dict] = {}


class StreamStartRequest(BaseModel):
    source_url: str | None = None
    loop: bool = True


async def broadcast_detections(stream_id: str):
    while True:
        if not orchestrator:
            await asyncio.sleep(0.25)
            continue

        try:
            handle = orchestrator.get_stream(stream_id)
        except StreamNotFoundError:
            break

        try:
            data = await asyncio.to_thread(handle.inference_queue.get, True, 0.05)
        except Empty:
            continue
        except asyncio.CancelledError:
            raise

        if data is None:
            await asyncio.sleep(0.1)
            continue
        if data.get("type") == "ready":
            video_info[stream_id] = data
            continue

        dead = []
        for ws in connected_clients.get(stream_id, set()):
            try:
                await ws.send_json({"type": "detections", **data})
            except Exception:
                dead.append(ws)
        for ws in dead:
            connected_clients.get(stream_id, set()).discard(ws)


def ensure_broadcast_task(stream_id: str):
    existing = broadcast_tasks.get(stream_id)
    if existing and not existing.done():
        return
    broadcast_tasks[stream_id] = asyncio.create_task(broadcast_detections(stream_id))


def resolve_default_source() -> str | None:
    if VIDEO_PATH and VIDEO_PATH.exists():
        return str(VIDEO_PATH)
    return None


def _is_remote_stream(source_url: str) -> bool:
    scheme = urlparse(source_url).scheme.lower()
    return scheme in {"rtsp", "http", "https", "rtmp", "udp", "tcp"}


def resolve_stream_source(source_url: str | None) -> str | None:
    """Resolve local paths robustly while preserving remote stream URLs."""
    if not source_url or not source_url.strip():
        return resolve_default_source()

    raw = source_url.strip()
    if _is_remote_stream(raw):
        return raw

    candidate = Path(raw)
    # Also try appending .mp4 so "test1" resolves the same as "test1.mp4".
    name_mp4 = candidate.name if candidate.suffix else candidate.name + ".mp4"
    video_dir = BASE_DIR / "data" / "raw" / "video"
    base_resolved = BASE_DIR.resolve()
    local_candidates = [
        candidate,
        BASE_DIR / candidate,
        video_dir / candidate.name,
        video_dir / name_mp4,
    ]
    for path in local_candidates:
        try:
            resolved = path.resolve()
            # Prevent path traversal: relative candidates must stay within BASE_DIR.
            if not path.is_absolute():
                resolved.relative_to(base_resolved)
            if resolved.exists():
                return str(resolved)
        except (ValueError, OSError):
            continue

    # Return original value so worker logs include what the caller provided.
    return raw

@asynccontextmanager
async def lifespan(_):
    global orchestrator
    orchestrator = WorkerOrchestrator(
        max_workers=MAX_WORKERS,
        protected_stream_ids={DEFAULT_STREAM_ID},
    )
    orchestrator.start_monitoring()
    source_url = resolve_default_source()
    if source_url:
        try:
            orchestrator.start_stream(
                StreamConfig(stream_id=DEFAULT_STREAM_ID, source_url=source_url, loop=True)
            )
            ensure_broadcast_task(DEFAULT_STREAM_ID)
        except StreamAlreadyRunningError:
            pass
        except ResourceLimitExceededError:
            pass
    yield

    for task in list(broadcast_tasks.values()):
        task.cancel()
    broadcast_tasks.clear()
    connected_clients.clear()
    video_info.clear()

    if orchestrator:
        orchestrator.shutdown()
        orchestrator = None

app.router.lifespan_context = lifespan


@app.post("/api/streams/{stream_id}/start", status_code=201)
async def start_stream(stream_id: str, request: StreamStartRequest):
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")

    source_url = resolve_stream_source(request.source_url)
    if not source_url:
        raise HTTPException(status_code=400, detail="source_url is required for this stream")

    config = StreamConfig(stream_id=stream_id, source_url=source_url, loop=request.loop)
    try:
        handle = orchestrator.start_stream(config)
    except StreamAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ResourceLimitExceededError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    ensure_broadcast_task(stream_id)
    return {"status": "started", **handle.to_dict()}


@app.delete("/api/streams/{stream_id}", status_code=204)
async def stop_stream(stream_id: str):
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")

    try:
        orchestrator.stop_stream(stream_id)
    except StreamNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    task = broadcast_tasks.pop(stream_id, None)
    if task:
        task.cancel()
    connected_clients.pop(stream_id, None)
    video_info.pop(stream_id, None)


@app.get("/api/streams")
async def list_streams():
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")
    return {"streams": orchestrator.list_streams(), "max_workers": MAX_WORKERS}


@app.post("/api/streams/{stream_id}/heartbeat", status_code=204)
async def heartbeat_stream(stream_id: str):
    """Signal that a client still has this stream open as a tab."""
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")
    orchestrator.touch_stream(stream_id)


@app.websocket("/api/detections/ws/{stream_id}")
async def websocket_detections_stream(websocket: WebSocket, stream_id: str):
    await websocket.accept()
    if not orchestrator:
        await websocket.send_json({"type": "error", "message": "Orchestrator unavailable"})
        return

    try:
        orchestrator.get_stream(stream_id)
    except StreamNotFoundError:
        await websocket.send_json({"type": "error", "message": f"Stream '{stream_id}' is not running"})
        return

    ensure_broadcast_task(stream_id)

    if stream_id in video_info:
        try:
            await websocket.send_json(video_info[stream_id])
        except WebSocketDisconnect:
            return
        except Exception:
            return

    connected_clients.setdefault(stream_id, set()).add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
@app.get("/api/ais/projections")
async def stream_ais_projections(
    ship_lat: float = 63.4365,
    ship_lon: float = 10.3835,
    heading: float = 90,
    offset_meters: float = 3000,
    fov_degrees: float = 120
):
    """
    Stream live AIS data of vessels within ships FOV and enrich with 
    GPS position being projected as pixel coordinates. These can be 
    used to visualize the AIS vessels in the camera view of the frontend.
    
    Args:
        ship_lat: Observer latitude
        ship_lon: Observer longitude
        heading: Observer heading in degrees
        offset_meters: Distance from observer to triangle base in meters
        fov_degrees: Field of view angle in degrees
    
    Example response:
        {
            "courseOverGround": 91.6,
            "latitude": 63.439217,
            "longitude": 10.398745,
            "name": "OCEAN SPACE DRONE1",
            "rateOfTurn": -9,
            "shipType": 99,
            "speedOverGround": 0,
            "trueHeading": 140,
            "navigationalStatus": 0,
            "mmsi": 257030830,
            "msgtime": "2026-02-17T14:40:14+00:00",
            "stream": "terra",
            "projection": {
                "x_px": 612,
                "y_px": 444,
                "distance_m": 816.0120734200536,
                "bearing_deg": 68.26304202314327,
                "rel_bearing_deg": -21.73695797685673
            }
        }
    """

    async def event_generator():
        try:
            async for feature in fetch_ais_stream_projections(
                ship_lat=ship_lat,
                ship_lon=ship_lon,
                heading=heading,
                offset_meters=offset_meters,
                fov_degrees=fov_degrees
            ):
                yield f"data: {json.dumps(feature)}\n\n"

        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            yield f"data: {json.dumps({'error': error_msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )


@app.get("/api/ais/projections/mmsi")
async def stream_ais_projections_by_mmsi(
    mmsi: str,
    offset_meters: float = 3000,
    fov_degrees: float = 120
):
    """
    Stream live AIS data in vessel's FOV + projected camera pixel positions.
    Fetches vessel position and heading by MMSI from Barentswatch API,
    then projects nearby vessels to camera pixel coordinates.
    This is a single API call combining vessel lookup + projection.
    
    Args:
        mmsi: Maritime Mobile Service Identity (vessel ID)
        offset_meters: Distance from vessel to triangle base in meters
        fov_degrees: Field of view angle in degrees
    
    Example response:
        {
            "courseOverGround": 316.4,
            "latitude": 63.43917,
            "longitude": 10.398723,
            "name": "LISE",
            "rateOfTurn": null,
            "shipType": 50,
            "speedOverGround": 0,
            "trueHeading": null,
            "navigationalStatus": 0,
            "mmsi": 257347700,
            "msgtime": "2026-02-17T14:40:15+00:00",
            "stream": "terra",
            "projection": {
                "x_px": 617,
                "y_px": 444,
                "distance_m": 813.0737502642806,
                "bearing_deg": 68.57663714470652,
                "rel_bearing_deg": -21.423362855293476
            }
        }
    """
    
    async def event_generator():
        try:
            from ais.fetch_ais import fetch_ais_stream_projections_by_mmsi
            async for feature in fetch_ais_stream_projections_by_mmsi(
                mmsi=mmsi,
                offset_meters=offset_meters,
                fov_degrees=fov_degrees
            ):
                yield f"data: {json.dumps(feature)}\n\n"

        except ValueError as e:
            error_msg = str(e)
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            yield f"data: {json.dumps({'error': error_msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )


@app.get("/api/ais/projections")
async def stream_ais_projections(
    ship_lat: float = 63.4365,
    ship_lon: float = 10.3835,
    heading: float = 90,
    offset_meters: float = 3000,
    fov_degrees: float = 120
):
    """
    Stream live AIS data of vessels within ships FOV and enrich with 
    GPS position being projected as pixel coordinates. These can be 
    used to visualize the AIS vessels in the camera view of the frontend.
    
    Args:
        ship_lat: Observer latitude
        ship_lon: Observer longitude
        heading: Observer heading in degrees
        offset_meters: Distance from observer to triangle base in meters
        fov_degrees: Field of view angle in degrees
    
    Example response:
        {
            "courseOverGround": 91.6,
            "latitude": 63.439217,
            "longitude": 10.398745,
            "name": "OCEAN SPACE DRONE1",
            "rateOfTurn": -9,
            "shipType": 99,
            "speedOverGround": 0,
            "trueHeading": 140,
            "navigationalStatus": 0,
            "mmsi": 257030830,
            "msgtime": "2026-02-17T14:40:14+00:00",
            "stream": "terra",
            "projection": {
                "x_px": 612,
                "y_px": 444,
                "distance_m": 816.0120734200536,
                "bearing_deg": 68.26304202314327,
                "rel_bearing_deg": -21.73695797685673
            }
        }
    """

    async def event_generator():
        try:
            async for feature in fetch_ais_stream_projections(
                ship_lat=ship_lat,
                ship_lon=ship_lon,
                heading=heading,
                offset_meters=offset_meters,
                fov_degrees=fov_degrees
            ):
                yield f"data: {json.dumps(feature)}\n\n"

        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            yield f"data: {json.dumps({'error': error_msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )


@app.get("/api/ais/projections/mmsi")
async def stream_ais_projections_by_mmsi(
    mmsi: str,
    offset_meters: float = 3000,
    fov_degrees: float = 120
):
    """
    Stream live AIS data in vessel's FOV + projected camera pixel positions.
    Fetches vessel position and heading by MMSI from Barentswatch API,
    then projects nearby vessels to camera pixel coordinates.
    This is a single API call combining vessel lookup + projection.
    
    Args:
        mmsi: Maritime Mobile Service Identity (vessel ID)
        offset_meters: Distance from vessel to triangle base in meters
        fov_degrees: Field of view angle in degrees
    
    Example response:
        {
            "courseOverGround": 316.4,
            "latitude": 63.43917,
            "longitude": 10.398723,
            "name": "LISE",
            "rateOfTurn": null,
            "shipType": 50,
            "speedOverGround": 0,
            "trueHeading": null,
            "navigationalStatus": 0,
            "mmsi": 257347700,
            "msgtime": "2026-02-17T14:40:15+00:00",
            "stream": "terra",
            "projection": {
                "x_px": 617,
                "y_px": 444,
                "distance_m": 813.0737502642806,
                "bearing_deg": 68.57663714470652,
                "rel_bearing_deg": -21.423362855293476
            }
        }
    """
    
    async def event_generator():
        try:
            from ais.fetch_ais import fetch_ais_stream_projections_by_mmsi
            async for feature in fetch_ais_stream_projections_by_mmsi(
                mmsi=mmsi,
                offset_meters=offset_meters,
                fov_degrees=fov_degrees
            ):
                yield f"data: {json.dumps(feature)}\n\n"

        except ValueError as e:
            error_msg = str(e)
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            yield f"data: {json.dumps({'error': error_msg})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        }
    )


frame_queue = None
STREAM_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,64}$")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global frame_queue
    process = None
    app.state.redis_client = create_async_redis_client()
    if VIDEO_PATH and VIDEO_PATH.exists():
        process, frame_queue = worker.start(VIDEO_PATH, stream_id=DEFAULT_DETECTIONS_STREAM_ID)
    yield
    await app.state.redis_client.aclose()
    if process:
        process.terminate()
        process.join(timeout=2)
        if process.is_alive():
            process.kill()

app.router.lifespan_context = lifespan

@app.websocket("/api/detections/ws/{stream_id}")
async def websocket_detections(websocket: WebSocket, stream_id: str):
    if not STREAM_ID_PATTERN.fullmatch(stream_id):
        await websocket.close(code=1008, reason="invalid_stream_id")
        return

    await websocket.accept()
    channel = detections_channel(stream_id)
    redis_client = websocket.app.state.redis_client
    pubsub = redis_client.pubsub()

    try:
        await pubsub.subscribe(channel)
    except RedisError as exc:
        logger.warning("Redis subscribe failed for channel '%s': %s", channel, exc)
        try:
            await websocket.send_json(
                {"type": "error", "message": f"Detection stream unavailable: {type(exc).__name__}"}
            )
        except Exception:
            logger.exception("Failed to send Redis unavailable message on channel '%s'", channel)
        try:
            await websocket.close(code=1011)
        except Exception:
            logger.exception("Failed to close websocket after Redis subscribe failure")
        return

    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            payload = message.get("data")
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8")
            await websocket.send_text(payload)
    except Exception:
        logger.exception("Detections websocket stream failed for channel '%s'", channel)
    finally:
        connected_clients.get(stream_id, set()).discard(websocket)


@app.websocket("/api/detections/ws")
async def websocket_detections(websocket: WebSocket):
    await websocket_detections_stream(websocket, DEFAULT_STREAM_ID)
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception:
            logger.exception("Failed to clean up pubsub for channel '%s'", channel)


@app.websocket("/api/fusion/ws")
async def websocket_fusion(websocket: WebSocket):
    """Dedicated WebSocket endpoint for Fusion page with ground truth data."""
    await fusion.handle_fusion_ws(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=1, loop="asyncio")
