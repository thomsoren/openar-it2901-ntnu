"""
FastAPI backend for boat detection and AIS data.

Architecture:
- /api/detections: Returns current detected vessels (YOLO + AIS)
- /api/detections/ws: WebSocket for real-time YOLO streaming detections
- /api/video: Streams video for the frontend
- /api/ais: Fetches AIS data from external API
- /api/ais/stream: Streams live AIS data in geographical field of view
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from queue import Empty
from typing import List

import cv2
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from ais import service as ais_service
from ais.fetch_ais import fetch_ais_stream_geojson
from common.config import VIDEO_PATH, load_samples
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

app = FastAPI(
    title="OpenAR Backend API",
    description="API for boat detection and AIS vessel data",
    version="0.2.0"
)

# Configure CORS to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite default dev server
        "http://localhost:3000",  # Alternative React dev server
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "https://demo.bridgable.ai",  # Production frontend
        "http://demo.bridgable.ai",   # Production frontend (HTTP)
    ],
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
        handle = orchestrator.get_stream(stream_id)
    except StreamNotFoundError:
        raise HTTPException(status_code=404, detail=f"Stream '{stream_id}' is not running")

    async def generate():
        while True:
            data = await asyncio.to_thread(handle.frame_queue.get)
            if data is None:
                break
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
    heading: float = 0,
    offset_meters: float = 1000,
    fov_degrees: float = 60
):
    """Stream live AIS data in ship's triangular field of view"""
    async def event_generator():
        try:
            async for feature in fetch_ais_stream_geojson(
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


MAX_WORKERS = int(os.getenv("MAX_WORKERS", "4"))
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
            data = await asyncio.to_thread(handle.inference_queue.get, True, 1.0)
        except Empty:
            continue

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

@asynccontextmanager
async def lifespan(_):
    global orchestrator
    orchestrator = WorkerOrchestrator(max_workers=MAX_WORKERS)
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

    source_url = request.source_url or resolve_default_source()
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
        await websocket.send_json(video_info[stream_id])

    connected_clients.setdefault(stream_id, set()).add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        connected_clients.get(stream_id, set()).discard(websocket)


@app.websocket("/api/detections/ws")
async def websocket_detections(websocket: WebSocket):
    await websocket_detections_stream(websocket, DEFAULT_STREAM_ID)


@app.websocket("/api/fusion/ws")
async def websocket_fusion(websocket: WebSocket):
    """Dedicated WebSocket endpoint for Fusion page with ground truth data."""
    await fusion.handle_fusion_ws(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=1, loop="asyncio")
