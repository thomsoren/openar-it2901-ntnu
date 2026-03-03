from __future__ import annotations

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import FileResponse, Response

from webapi.errors import not_found, wrap_internal
from common.config import VIDEO_PATH
from common.types import DetectedVessel
from fusion import fusion
from storage import s3

router = APIRouter()

# API boundary note: handlers intentionally catch broad exceptions and map
# them to HTTP errors so failures are returned consistently.


@router.get("/api/detections", response_model=list[DetectedVessel])
def get_detections() -> list[DetectedVessel]:
    try:
        return fusion.get_detections()
    except Exception as exc:
        wrap_internal("Error fetching detections", exc)


@router.get("/api/detections/file")
def get_detections_file(request: Request) -> Response:
    try:
        return s3.detections_response(request)
    except FileNotFoundError:
        not_found("Detections file not found")
    except Exception as exc:
        wrap_internal("Error serving detections file", exc)


@router.get("/api/video")
def get_video() -> FileResponse:
    path = VIDEO_PATH
    if not path or not path.exists():
        not_found(f"Video not found: {path}")
    return FileResponse(path, media_type="video/mp4")


@router.get("/api/video/fusion")
def get_fusion_video(request: Request) -> Response:
    try:
        return s3.fusion_video_response(request)
    except FileNotFoundError:
        not_found("Fusion video file not found")
    except Exception as exc:
        wrap_internal("Error streaming fusion video", exc)


@router.get("/api/assets/oceanbackground")
def get_components_background() -> Response:
    try:
        return s3.components_background_response()
    except FileNotFoundError:
        not_found("Background image not found")
    except Exception as exc:
        wrap_internal("Error serving background image", exc)


@router.get("/api/video/stream")
async def stream_video(request: Request) -> Response:
    try:
        return s3.video_stream_response(request)
    except Exception as exc:
        wrap_internal("Error in video stream", exc)


@router.websocket("/api/fusion/ws")
async def websocket_fusion(websocket: WebSocket) -> None:
    await fusion.handle_fusion_ws(websocket)
