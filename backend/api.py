"""
FastAPI backend for boat detection and AIS data.

Architecture:
- /api/detections: Returns current detected vessels (YOLO + AIS)
- /api/detections/ws: WebSocket for real-time YOLO streaming detections
- /api/video: Streams video for the frontend
- /api/ais: Fetches AIS data from external API
"""
import asyncio
import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from ais.fetch_ais import fetch_ais
from schemas import Detection, Vessel, DetectedVessel
from cv.yolo_stream import get_processor

load_dotenv()

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
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# File paths (override with env vars if needed)
BASE_DIR = Path(__file__).parent
DEFAULT_VIDEO_PATH = BASE_DIR / "data" / "raw" / "video" / "Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4"
VIDEO_PATH = Path(os.getenv("VIDEO_PATH", DEFAULT_VIDEO_PATH))


@app.get("/")
def read_root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "OpenAR Backend API is running",
        "endpoints": {
            "detections": "/api/detections",
            "detections_ws": "/api/detections/ws",
            "video": "/api/video",
            "ais": "/api/ais",
            "health": "/health"
        }
    }


@app.get("/health")
def health_check():
    """Health check with file availability status"""
    video_exists = VIDEO_PATH.exists()

    return {
        "status": "healthy" if video_exists else "degraded",
        "files": {
            "video": {
                "path": str(VIDEO_PATH),
                "exists": video_exists,
                "size_mb": round(VIDEO_PATH.stat().st_size / (1024 * 1024), 2) if video_exists else None
            }
        }
    }


@app.get("/api/detections", response_model=List[DetectedVessel])
def get_detections() -> List[DetectedVessel]:
    """
    Get current detected vessels with AIS data.

    TODO: Implement real-time detection pipeline:
    1. Capture frame from video/camera
    2. Run YOLO detection
    3. Match detections to AIS vessels
    4. Return combined data

    For now, returns mock data for frontend development.
    """
    # Mock data for frontend development
    # Replace with real YOLO + AIS pipeline
    mock_vessels: List[DetectedVessel] = [
        DetectedVessel(
            detection=Detection(
                x=500,
                y=400,
                width=120,
                height=80,
                confidence=0.92,
                track_id=1
            ),
            vessel=Vessel(
                mmsi="259000001",
                name="MS Nordkapp",
                ship_type="Passenger",
                speed=15.2,
                heading=45.0,
                destination="Tromsø"
            )
        ),
        DetectedVessel(
            detection=Detection(
                x=1200,
                y=350,
                width=80,
                height=50,
                confidence=0.85,
                track_id=2
            ),
            vessel=Vessel(
                mmsi="259000002",
                name="Fishing Vessel",
                ship_type="Fishing",
                speed=8.5,
                heading=180.0
            )
        ),
        DetectedVessel(
            detection=Detection(
                x=800,
                y=500,
                width=60,
                height=40,
                confidence=0.78,
                track_id=3
            ),
            vessel=None  # Detected but no AIS match
        ),
    ]

    return mock_vessels


@app.get("/api/video")
def get_video():
    """
    Stream video file with support for range requests (seeking)

    Returns:
        Video file stream with proper headers for browser playback
    """
    if not VIDEO_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Video file not found at {VIDEO_PATH}"
        )

    return FileResponse(
        path=VIDEO_PATH,
        media_type="video/mp4",
        filename="boat-detection-video.mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": "inline"
        }
    )


@app.get("/api/video/stream")
async def stream_video():
    """
    Advanced video streaming endpoint with range request support
    This allows seeking in the video player
    """
    if not VIDEO_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Video file not found at {VIDEO_PATH}"
        )

    return FileResponse(
        path=VIDEO_PATH,
        media_type="video/mp4",
        filename="boat-detection-video.mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": "inline; filename=boat-detection-video.mp4"
        }
    )


@app.get("/api/ais")
async def get_ais_data():
    """Fetch AIS data from external API (Barentswatch AIS)"""
    try:
        ais_data = await fetch_ais()
        return ais_data
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching AIS data: {str(e)}"
        )


@app.websocket("/api/detections/ws")
async def websocket_detections(websocket: WebSocket):
    """
    WebSocket endpoint for YOLO detection streaming.

    Sends detection updates as YOLO processes video frames.
    Frontend plays video separately at native speed.

    Config (via initial message):
        source: Video source (default: VIDEO_PATH)
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

        source = config.get("source", str(VIDEO_PATH))
        track = config.get("track", True)
        loop = config.get("loop", True)

        # Validate source
        if isinstance(source, str) and not source.startswith(("rtsp://", "http://")):
            if not source.isdigit() and not Path(source).exists():
                await websocket.send_json({"type": "error", "message": f"Source not found: {source}"})
                await websocket.close()
                return

        # Get video dimensions for frontend
        import cv2
        cap = cv2.VideoCapture(source)
        video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        cap.release()

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
                except Exception as e:
                    print(f"Processing error: {e}")
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
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    print("Starting OpenAR Backend API...")
    print(f"Video path: {VIDEO_PATH}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
