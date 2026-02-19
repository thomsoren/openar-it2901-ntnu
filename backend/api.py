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
import logging
import re
from contextlib import asynccontextmanager
from typing import List

import cv2
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from redis.exceptions import RedisError

from ais import service as ais_service
from ais.fetch_ais import fetch_ais_stream_geojson
from auth.deps import require_admin
from auth.routes import router as auth_router
from common.config import (
    DEFAULT_DETECTIONS_STREAM_ID,
    VIDEO_PATH,
    create_async_redis_client,
    detections_channel,
    load_samples,
)
from common.types import DetectedVessel
from cv import worker
from db.init_db import init_db
from db.models import AppUser
from fusion import fusion
from storage import s3

logger = logging.getLogger(__name__)

app = FastAPI(
    title="OpenAR Backend API",
    description="API for boat detection and AIS vessel data",
    version="0.2.0"
)

# Configure CORS to allow frontend requests
# Origins are read from CORS_ORIGINS env var, falling back to
# localhost dev defaults.  See auth/config.py for parsing logic.
from auth.config import settings as auth_settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(auth_settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

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
def presign_storage(
    request: s3.PresignRequest,
    _: AppUser = Depends(require_admin),
):
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
async def stream_mjpeg(request: Request):
    """MJPEG stream from inference worker - synced with detections."""
    queue = request.app.state.frame_queue
    if not queue:
        raise HTTPException(status_code=503, detail="Video stream not available")

    async def generate():
        while True:
            data = await asyncio.to_thread(queue.get)
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
    fov_degrees: float = 60,
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


STREAM_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,64}$")

@asynccontextmanager
async def lifespan(app: FastAPI):
    process = None
    init_db()
    app.state.redis_client = create_async_redis_client()
    app.state.frame_queue = None
    if VIDEO_PATH and VIDEO_PATH.exists():
        process, app.state.frame_queue = worker.start(VIDEO_PATH, stream_id=DEFAULT_DETECTIONS_STREAM_ID)
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
