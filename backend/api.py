"""
FastAPI backend for serving detections and video stream to frontend
"""
import json
import asyncio
import time
import threading
from pathlib import Path
from typing import Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
import cv2
from cv.boat_detection_streamer import BoatDetectionStreamer, StreamConfig
from streaming.frame_source import FrameSource

load_dotenv()

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

# File paths (override with env vars if needed)
BASE_DIR = Path(__file__).parent
DEFAULT_VIDEO_PATH = BASE_DIR / "data" / "raw" / "video"  / "Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4"

VIDEO_PATH = Path(os.getenv("VIDEO_PATH", DEFAULT_VIDEO_PATH))

FRAME_SOURCE = FrameSource(str(VIDEO_PATH))
DETECTION_THREAD: threading.Thread | None = None
DETECTION_LOCK = threading.Lock()
DETECTION_SUBSCRIBERS: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []


def broadcast_detection(frame: Dict[str, Any]) -> None:
    # Fan out detections to all active SSE subscribers.
    with DETECTION_LOCK:
        subscribers = list(DETECTION_SUBSCRIBERS)

    for loop, queue in subscribers:
        def enqueue(payload: Dict[str, Any] = frame, q: asyncio.Queue = queue) -> None:
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

        loop.call_soon_threadsafe(enqueue)


def broadcast_detection_error(message: str) -> None:
    broadcast_detection({"type": "error", "message": message})


def start_detection_worker() -> None:
    global DETECTION_THREAD

    with DETECTION_LOCK:
        if DETECTION_THREAD is not None and DETECTION_THREAD.is_alive():
            return

        if not VIDEO_PATH.exists():
            broadcast_detection_error(f"Video file not found at {VIDEO_PATH}")
            return

        # Start frame capture once; detections consume the same frames the client sees.
        FRAME_SOURCE.start()

        def worker() -> None:
            # Single detector runs continuously; clients just subscribe to its output.
            streamer = BoatDetectionStreamer(
                config=StreamConfig(),
                frame_source=FRAME_SOURCE,
                on_frame=broadcast_detection,
                on_error=broadcast_detection_error,
            )
            streamer.run()

        DETECTION_THREAD = threading.Thread(target=worker, daemon=True)
        DETECTION_THREAD.start()


@app.get("/")
def read_root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "OpenAR Backend API is running",
        "endpoints": {
            "detections_stream": "/api/detections/stream",
            "video_mjpeg": "/api/video/mjpeg",
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
        },
        "detections": {
            "mode": "stream"
        },
    }


@app.get("/api/detections/stream")
async def stream_detections(
    start_time: float = 0.0,
    realtime: bool = True
):
    """
    Stream detections in (simulated) real time using Server-Sent Events (SSE).

    Query params:
        start_time: start timestamp in seconds (default 0.0)
        realtime: if false, stream as fast as possible (default true)
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=5)
    with DETECTION_LOCK:
        DETECTION_SUBSCRIBERS.append((loop, queue))
    start_detection_worker()

    async def event_generator():
        start_wall = None
        base_timestamp = None

        try:
            while True:
                frame = await queue.get()
                if isinstance(frame, dict) and frame.get("type") == "error":
                    payload = json.dumps({"message": frame.get("message", "Unknown detection error.")})
                    yield f"event: detections_error\ndata: {payload}\n\n"
                    continue

                frame_timestamp = float(frame.get("timestamp", 0.0))
                if frame_timestamp < start_time:
                    continue

                if base_timestamp is None:
                    base_timestamp = frame_timestamp
                    start_wall = time.monotonic()

                if realtime and start_wall is not None and base_timestamp is not None:
                    target_elapsed = frame_timestamp - base_timestamp
                    elapsed = time.monotonic() - start_wall
                    delay = target_elapsed - elapsed
                    if delay > 0:
                        await asyncio.sleep(delay)

                payload = json.dumps(frame)
                yield f"data: {payload}\n\n"
        finally:
            with DETECTION_LOCK:
                DETECTION_SUBSCRIBERS[:] = [
                    (subscriber_loop, subscriber_queue)
                    for subscriber_loop, subscriber_queue in DETECTION_SUBSCRIBERS
                    if subscriber_queue is not queue
                ]

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"}
    )


@app.get("/api/video/mjpeg")
async def stream_mjpeg():
    """
    Stream MJPEG frames from the shared frame source.
    """
    if not VIDEO_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Video file not found at {VIDEO_PATH}"
        )

    FRAME_SOURCE.start()
    loop = asyncio.get_running_loop()
    queue = FRAME_SOURCE.subscribe_async(loop)

    async def frame_generator():
        try:
            while True:
                packet = await queue.get()
                ret, jpeg = cv2.imencode(".jpg", packet.frame)
                if not ret:
                    continue
                # MJPEG boundary framing for <img> streaming.
                payload = jpeg.tobytes()
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" +
                    payload +
                    b"\r\n"
                )
        finally:
            FRAME_SOURCE.unsubscribe_async(queue)

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
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
