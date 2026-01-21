"""
FastAPI backend for boat detection and AIS data.

Architecture:
- /api/detections: Returns current detected vessels (YOLO + AIS)
- /api/video: Streams video for the frontend
- /api/ais: Fetches AIS data from external API
"""
import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from ais.fetch_ais import fetch_ais
from schemas import Detection, Vessel, DetectedVessel

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
