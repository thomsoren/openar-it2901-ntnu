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
from contextlib import asynccontextmanager
from typing import List, Set

import cv2
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from ais import service as ais_service
from ais.fetch_ais import fetch_ais_stream_geojson, fetch_ais_stream_projections
from common.config import VIDEO_PATH, load_samples
from common.types import DetectedVessel
from cv import worker
from fusion import fusion
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
            "detections_ws": "/api/detections/ws",
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
    """MJPEG stream from inference worker - synced with detections."""
    if not frame_queue:
        raise HTTPException(status_code=503, detail="Video stream not available")

    async def generate():
        while True:
            data = await asyncio.to_thread(frame_queue.get)
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
    heading: float = 90,
    offset_meters: float = 1000,
    fov_degrees: float = 60
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


inference_queue = None
frame_queue = None
connected_clients: Set[WebSocket] = set()
broadcast_task = None

video_info = None

async def broadcast_detections():
    global video_info
    while True:
        data = await asyncio.to_thread(inference_queue.get)
        if data is None:
            break
        if data.get("type") == "ready":
            video_info = data
            continue
        dead = []
        for ws in connected_clients:
            try:
                await ws.send_json({"type": "detections", **data})
            except Exception:
                dead.append(ws)
        for ws in dead:
            connected_clients.discard(ws)

@asynccontextmanager
async def lifespan(_):
    global inference_queue, frame_queue, broadcast_task
    process = None
    if VIDEO_PATH and VIDEO_PATH.exists():
        process, inference_queue, frame_queue = worker.start(VIDEO_PATH)
        broadcast_task = asyncio.create_task(broadcast_detections())
    yield
    if broadcast_task:
        broadcast_task.cancel()
    if process:
        process.terminate()
        process.join(timeout=2)
        if process.is_alive():
            process.kill()

app.router.lifespan_context = lifespan

@app.websocket("/api/detections/ws")
async def websocket_detections(websocket: WebSocket):
    await websocket.accept()
    if not inference_queue:
        await websocket.send_json({"type": "error", "message": "No video configured"})
        return

    if video_info:
        await websocket.send_json(video_info)
    connected_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        connected_clients.discard(websocket)


@app.websocket("/api/fusion/ws")
async def websocket_fusion(websocket: WebSocket):
    """Dedicated WebSocket endpoint for Fusion page with ground truth data."""
    await fusion.handle_fusion_ws(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=1, loop="asyncio")
