"""
FastAPI backend for serving detections and video stream to frontend
"""
import json
from pathlib import Path
from typing import List, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(
    title="OpenAR Backend API",
    description="API for serving boat detections and video streams",
    version="0.1.0"
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

# File paths
BASE_DIR = Path(__file__).parent
DETECTIONS_PATH = BASE_DIR / "data" / "raw" / "detections.json"
VIDEO_PATH = BASE_DIR / "data" / "processed" / "video" / "Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4"


@app.get("/")
def read_root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "OpenAR Backend API is running",
        "endpoints": {
            "detections": "/api/detections",
            "video": "/api/video",
            "health": "/health"
        }
    }


@app.get("/health")
def health_check():
    """Health check with file availability status"""
    detections_exists = DETECTIONS_PATH.exists()
    video_exists = VIDEO_PATH.exists()

    return {
        "status": "healthy" if (detections_exists and video_exists) else "degraded",
        "files": {
            "detections": {
                "path": str(DETECTIONS_PATH),
                "exists": detections_exists,
                "size_mb": round(DETECTIONS_PATH.stat().st_size / (1024 * 1024), 2) if detections_exists else None
            },
            "video": {
                "path": str(VIDEO_PATH),
                "exists": video_exists,
                "size_mb": round(VIDEO_PATH.stat().st_size / (1024 * 1024), 2) if video_exists else None
            }
        }
    }


@app.get("/api/detections")
def get_detections() -> List[Dict[str, Any]]:
    """
    Get all boat detections from JSON file

    Returns:
        List of detection frames with timestamp and detection data
    """
    if not DETECTIONS_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Detections file not found at {DETECTIONS_PATH}"
        )

    try:
        with open(DETECTIONS_PATH, 'r') as f:
            detections = json.load(f)

        return detections
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse detections JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error reading detections: {str(e)}"
        )


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

    # Return video file with proper headers for streaming
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

    def iterfile():
        """Generator to stream video in chunks"""
        with open(VIDEO_PATH, mode="rb") as file_like:
            yield from file_like

    return StreamingResponse(
        iterfile(),
        media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": "inline; filename=boat-detection-video.mp4"
        }
    )


if __name__ == "__main__":
    import uvicorn

    print("Starting OpenAR Backend API...")
    print(f"Detections path: {DETECTIONS_PATH}")
    print(f"Video path: {VIDEO_PATH}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
