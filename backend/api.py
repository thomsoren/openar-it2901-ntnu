"""FastAPI backend for boat detection and AIS data."""
from __future__ import annotations

import json
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List
from urllib.parse import urlparse

import cv2
import shutil

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from redis.exceptions import RedisError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.websockets import WebSocketDisconnect

from ais.fetch_ais import fetch_ais_stream_geojson, fetch_historic_ais_data
from ais_mapping_service.pixel_projection.current_ship_config import CameraConfig, ShipConfig
from ais_mapping_service.pixel_projection.projection import project_ais_to_pixel
from ais.logger import AISSessionLogger
from auth.deps import require_admin
from auth.routes import limiter, router as auth_router
from common.config import (
    BASE_DIR,
    MEDIAMTX_ENABLED,
    VIDEO_PATH,
    build_playback_urls,
    create_async_redis_client,
    detections_channel,
    load_samples,
)
from common.types import DetectedVessel
from db.init_db import init_db
from db.models import AppUser
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
    version="0.2.0",
)

# Configure CORS to allow frontend requests
# Origins are read from CORS_ORIGINS env var, falling back to
# localhost dev defaults.  See auth/config.py for parsing logic.
from auth.config import settings as auth_settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(auth_settings.cors_origins),
    allow_origin_regex=r"^https?://(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.include_router(auth_router)

MAX_WORKERS = int(os.getenv("MAX_WORKERS", "8"))
STREAM_IDLE_TIMEOUT_SECONDS = float(os.getenv("STREAM_IDLE_TIMEOUT_SECONDS", "300"))
STREAM_NO_VIEWER_TIMEOUT_SECONDS = float(os.getenv("STREAM_NO_VIEWER_TIMEOUT_SECONDS", "15"))
DEFAULT_STREAM_ID = os.getenv("DEFAULT_STREAM_ID", "default")
PROTECT_DEFAULT_STREAM = os.getenv("PROTECT_DEFAULT_STREAM", "0").lower() in {"1", "true", "yes"}
STREAM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

orchestrator: WorkerOrchestrator | None = None


class StreamStartRequest(BaseModel):
    source_url: str | None = None
    loop: bool = True


def _is_remote_stream(source_url: str) -> bool:
    return urlparse(source_url).scheme.lower() in {"rtsp", "http", "https", "rtmp", "udp", "tcp"}


def resolve_default_source() -> str | None:
    if VIDEO_PATH and VIDEO_PATH.exists():
        return str(VIDEO_PATH)
    return None


def _download_s3_to_cache(s3_key: str) -> str:
    """Download an S3 object to a local cache directory and return the local path."""
    cache_dir = BASE_DIR / "data" / "cache" / "s3"
    cache_dir.mkdir(parents=True, exist_ok=True)

    # Use the filename from the S3 key
    filename = Path(s3_key).name
    local_path = cache_dir / filename

    if local_path.exists():
        logger.info("[s3] Using cached file: %s", local_path)
        return str(local_path)

    logger.info("[s3] Downloading s3://%s to %s", s3_key, local_path)
    try:
        client = s3._client()
        full_key, _ = s3._normalize_key(s3_key)
        client.download_file(s3.S3_BUCKET, full_key, str(local_path))
        logger.info("[s3] Download complete: %s", local_path)
        return str(local_path)
    except Exception as exc:
        # Clean up partial download
        if local_path.exists():
            local_path.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to download s3://{s3_key}: {exc}") from exc


def resolve_stream_source(source_url: str | None) -> str | None:
    """Resolve local paths robustly while preserving remote stream URLs."""
    if not source_url or not source_url.strip():
        return resolve_default_source()

    raw = source_url.strip()

    # Handle s3:// references — download to local cache for OpenCV
    if raw.startswith("s3://"):
        s3_key = raw[5:]  # strip "s3://"
        return _download_s3_to_cache(s3_key)

    if _is_remote_stream(raw):
        return raw

    candidate = Path(raw)
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
            if not path.is_absolute():
                resolved.relative_to(base_resolved)
            if resolved.exists():
                return str(resolved)
        except (ValueError, OSError):
            continue

    return raw


def build_stream_playback_payload(stream_id: str) -> dict:
    payload = {"media_enabled": MEDIAMTX_ENABLED}
    if MEDIAMTX_ENABLED:
        payload.update(build_playback_urls(stream_id))
    return payload


def augment_stream_payload(stream: dict) -> dict:
    stream_id = str(stream.get("stream_id", "")).strip()
    if not stream_id:
        return stream
    return {**stream, "playback_urls": build_stream_playback_payload(stream_id)}


@asynccontextmanager
async def lifespan(_: FastAPI):
    global orchestrator

    init_db()
    app.state.redis_client = create_async_redis_client()
    protected_stream_ids = {DEFAULT_STREAM_ID} if PROTECT_DEFAULT_STREAM else set()
    orchestrator = WorkerOrchestrator(
        max_workers=MAX_WORKERS,
        idle_timeout_seconds=STREAM_IDLE_TIMEOUT_SECONDS,
        no_viewer_timeout_seconds=STREAM_NO_VIEWER_TIMEOUT_SECONDS,
        protected_stream_ids=protected_stream_ids,
    )
    orchestrator.start_monitoring()

    source_url = resolve_default_source()
    if source_url:
        try:
            orchestrator.start_stream(
                StreamConfig(stream_id=DEFAULT_STREAM_ID, source_url=source_url, loop=True)
            )
            logger.info("Default stream '%s' started from %s", DEFAULT_STREAM_ID, source_url)
        except (StreamAlreadyRunningError, ResourceLimitExceededError):
            pass
    else:
        logger.warning("No default video source found; skipping default stream")

    yield

    await app.state.redis_client.aclose()
    if orchestrator:
        orchestrator.shutdown()
        orchestrator = None


app.router.lifespan_context = lifespan


async def _safe_ws_send_json(websocket: WebSocket, payload: dict) -> bool:
    try:
        await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


async def _safe_ws_send_text(websocket: WebSocket, payload: str) -> bool:
    try:
        await websocket.send_text(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


@app.get("/")
def read_root():
    return {
        "status": "ok",
        "message": "OpenAR Backend API is running",
        "endpoints": {
            "detections": "/api/detections",
            "detections_file": "/api/detections/file",
            "detections_ws": "/api/detections/ws/{stream_id}",
            "streams": "/api/streams",
            "stream_playback": "/api/streams/{stream_id}/playback",
            "video": "/api/video",
            "ais": "/api/ais",
            "ais_stream": "/api/ais/stream",
            "ais_historical": "/api/ais/historical",
            "samples": "/api/samples",
            "storage_presign": "/api/storage/presign",
            "health": "/health",
        },
    }


@app.get("/health")
def health_check():
    try:
        return s3.health_status()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Health check failed: {exc}")


@app.get("/api/samples")
def list_samples():
    try:
        return {"samples": load_samples()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error loading samples: {exc}")


@app.post("/api/fusion/reset")
def reset_fusion_timer():
    try:
        start = fusion.reset_sample_timer()
        return {"status": "ok", "start_mono": start}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error resetting fusion timer: {exc}")


@app.post("/api/storage/presign")
def presign_storage(
    request: s3.PresignRequest,
    _: AppUser = Depends(require_admin),
):
    """Generate a presigned URL for GET/PUT against S3 storage."""
    try:
        return s3.presign_storage(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error generating presigned URL: {exc}")


@app.get("/api/detections", response_model=List[DetectedVessel])
def get_detections() -> List[DetectedVessel]:
    try:
        return fusion.get_detections()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error fetching detections: {exc}")


@app.get("/api/detections/file")
def get_detections_file(request: Request):
    try:
        return s3.detections_response(request)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Detections file not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error serving detections file: {exc}")


@app.get("/api/video")
def get_video():
    path = VIDEO_PATH
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail=f"Video not found: {path}")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/video/fusion")
def get_fusion_video(request: Request):
    try:
        return s3.fusion_video_response(request)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fusion video file not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error streaming fusion video: {exc}")


@app.get("/api/assets/oceanbackground")
def get_components_background():
    try:
        return s3.components_background_response()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Background image not found")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error serving background image: {exc}")


@app.get("/api/video/stream")
async def stream_video(request: Request):
    try:
        return s3.video_stream_response(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error in video stream: {exc}")

class AISHistoricalRequest(BaseModel):
    polygon: dict
    msgTimeFrom: str
    msgTimeTo: str
    ship_lat: float
    ship_lon: float
    heading: float
    log: bool = False


@app.post("/api/ais/historical")
async def get_historical_ais_data(body: AISHistoricalRequest):
    session_logger = AISSessionLogger() if body.log else None
    ship_cfg = ShipConfig(
        latitude=body.ship_lat,
        longitude=body.ship_lon,
        heading_deg=body.heading
    )
    cam_cfg = CameraConfig()
    try:
        results = []
        async for item in fetch_historic_ais_data(
            polygon=body.polygon,
            from_date=body.msgTimeFrom,
            to_date=body.msgTimeTo,
        ):
            lat = item.get("latitude")
            lon = item.get("longitude")
            item["projection"] = (
                project_ais_to_pixel(
                    ship_cfg=ship_cfg,
                    target_lat=lat,
                    target_lon=lon,
                    cam_cfg=cam_cfg,
                )
                if lat is not None and lon is not None
                else None
            )
            results.append(item)
            if session_logger:
                session_logger.log(item)
        if session_logger:
            session_logger.end_session()
        return results
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error fetching historical AIS data: {exc}")

class AISStreamRequest(BaseModel):
    # GeoJSON polygon: [[lon, lat], ...] computed by the frontend
    coordinates: List[List[float]]
    ship_lat: float
    ship_lon: float
    heading: float
    log: bool = False

@app.post("/api/ais/stream")
async def get_live_ais_data(body: AISStreamRequest):
    """Stream live AIS data inside the polygon, enriched with camera pixel projections."""
    session_logger = AISSessionLogger() if body.log else None
    ship_cfg = ShipConfig(
        latitude=body.ship_lat,
        longitude=body.ship_lon,
        heading_deg=body.heading
    )
    cam_cfg = CameraConfig()
    async def event_generator():
        try:
            async for feature in fetch_ais_stream_geojson(
                coordinates=body.coordinates
            ):
                lat = feature.get("latitude")
                lon = feature.get("longitude")
                feature["projection"] = (
                    project_ais_to_pixel(
                        ship_cfg=ship_cfg,
                        target_lat=lat,
                        target_lon=lon,
                        cam_cfg=cam_cfg,
                    )
                    if lat is not None and lon is not None
                    else None
                )
                if session_logger:
                    session_logger.log(feature)
                yield f"data: {json.dumps(feature)}\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': f'{type(exc).__name__}: {exc}'})}\n"
        finally:
            if session_logger:
                session_logger.end_session()
        
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.post("/api/streams/{stream_id}/start", status_code=201)
async def start_stream(stream_id: str, request: StreamStartRequest):
    if not STREAM_ID_PATTERN.fullmatch(stream_id):
        raise HTTPException(status_code=400, detail="Invalid stream_id")
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")

    try:
        source_url = resolve_stream_source(request.source_url)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if not source_url:
        raise HTTPException(status_code=400, detail="source_url is required for this stream")

    config = StreamConfig(stream_id=stream_id, source_url=source_url, loop=request.loop)
    try:
        handle = orchestrator.start_stream(config)
    except StreamAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ResourceLimitExceededError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {
        "status": "started",
        **handle.to_dict(),
        "playback_urls": build_stream_playback_payload(stream_id),
    }


@app.post("/api/streams/{stream_id}/upload", status_code=201)
async def upload_and_start_stream(stream_id: str, file: UploadFile, loop: bool = True):
    """Accept a video file upload, save locally, and start a stream from it."""
    if not STREAM_ID_PATTERN.fullmatch(stream_id):
        raise HTTPException(status_code=400, detail="Invalid stream_id")
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    upload_dir = BASE_DIR / "data" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    local_path = upload_dir / file.filename

    try:
        with open(local_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}")

    config = StreamConfig(
        stream_id=stream_id, source_url=str(local_path), loop=loop
    )
    try:
        handle = orchestrator.start_stream(config)
    except StreamAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ResourceLimitExceededError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {"status": "started", **handle.to_dict()}


@app.delete("/api/streams/{stream_id}", status_code=204)
async def stop_stream(stream_id: str):
    if not STREAM_ID_PATTERN.fullmatch(stream_id):
        raise HTTPException(status_code=400, detail="Invalid stream_id")
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")

    try:
        orchestrator.stop_stream(stream_id)
    except StreamNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/streams")
async def list_streams():
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")
    streams = [augment_stream_payload(stream) for stream in orchestrator.list_streams()]
    return {"streams": streams, "max_workers": MAX_WORKERS}


@app.get("/api/streams/{stream_id}/playback")
async def get_stream_playback(stream_id: str):
    if not STREAM_ID_PATTERN.fullmatch(stream_id):
        raise HTTPException(status_code=400, detail="Invalid stream_id")
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")

    try:
        orchestrator.get_stream(stream_id)
    except StreamNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {"stream_id": stream_id, "playback_urls": build_stream_playback_payload(stream_id)}


@app.post("/api/streams/{stream_id}/heartbeat", status_code=204)
async def heartbeat_stream(stream_id: str):
    if not STREAM_ID_PATTERN.fullmatch(stream_id):
        raise HTTPException(status_code=400, detail="Invalid stream_id")
    if not orchestrator:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")
    orchestrator.touch_stream(stream_id)


@app.websocket("/api/detections/ws/{stream_id}")
async def websocket_detections(websocket: WebSocket, stream_id: str):
    if not STREAM_ID_PATTERN.fullmatch(stream_id):
        await websocket.close(code=1008, reason="invalid_stream_id")
        return

    await websocket.accept()

    if not orchestrator:
        await _safe_ws_send_json(websocket, {"type": "error", "message": "Orchestrator unavailable"})
        await websocket.close(code=1011)
        return

    viewer_attached = False
    try:
        handle = orchestrator.acquire_stream_viewer(stream_id)
        viewer_attached = True
    except StreamNotFoundError:
        await _safe_ws_send_json(websocket, {"type": "error", "message": f"Stream '{stream_id}' not found"})
        await websocket.close(code=1008)
        return
    except ResourceLimitExceededError as exc:
        await _safe_ws_send_json(websocket, {"type": "error", "message": str(exc)})
        await websocket.close(code=1013)
        return

    channel = detections_channel(stream_id)
    redis_client = websocket.app.state.redis_client
    pubsub = redis_client.pubsub()

    try:
        await pubsub.subscribe(channel)
    except RedisError as exc:
        logger.warning("Redis subscribe failed for channel '%s': %s", channel, exc)
        try:
            await _safe_ws_send_json(
                websocket,
                {"type": "error", "message": f"Detection stream unavailable: {type(exc).__name__}"}
            )
        finally:
            await websocket.close(code=1011)
        return

    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            payload = message.get("data")
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8")
            if not await _safe_ws_send_text(websocket, payload):
                break
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        # Client already closed; normal during tab switches/reconnects.
        pass
    except Exception:
        logger.exception("Detections websocket stream failed for channel '%s'", channel)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception:
            logger.exception("Failed to clean up pubsub for channel '%s'", channel)
        if viewer_attached:
            orchestrator.release_stream_viewer(stream_id)


@app.websocket("/api/detections/ws")
async def websocket_detections_default(websocket: WebSocket):
    await websocket_detections(websocket, DEFAULT_STREAM_ID)


@app.websocket("/api/fusion/ws")
async def websocket_fusion(websocket: WebSocket):
    await fusion.handle_fusion_ws(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, workers=1, loop="asyncio")
