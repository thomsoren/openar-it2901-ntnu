"""
FastAPI backend for boat detection and AIS data.

Architecture:
- /api/detections: Returns current detected vessels (YOLO + AIS)
- /api/detections/ws: WebSocket for real-time YOLO streaming detections
- /api/video: Streams video for the frontend
- /api/ais: Fetches AIS data from external API
"""
from typing import List

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from ais import service as ais_service
from common import settings
from common.types import DetectedVessel
from cv import pipeline
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
        return {"samples": settings.load_samples()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading samples: {str(e)}")


@app.post("/api/fusion/reset")
def reset_fusion_timer():
    """Reset fusion sample timer to sync detections with video playback."""
    try:
        start = settings.reset_sample_timer()
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
        return pipeline.get_detections()
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
def get_video(request: Request):
    """
    Stream video file with support for range requests (seeking)
    """
    try:
        return s3.video_response(request)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Video file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error streaming video: {str(e)}")


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


@app.websocket("/api/detections/ws")
async def websocket_detections(websocket: WebSocket):
    await pipeline.handle_detections_ws(websocket)
