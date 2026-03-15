from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, WebSocket
from fastapi.responses import Response

from webapi.errors import not_found, wrap_internal
from common.types import DetectedVessel
from mock_stream import mock_stream
from storage import s3

router = APIRouter()

# API boundary note: handlers intentionally catch broad exceptions and map
# them to HTTP errors so failures are returned consistently.


@router.get("/api/detections", response_model=list[DetectedVessel])
def get_detections() -> list[DetectedVessel]:
    try:
        return mock_stream.get_detections()
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error fetching detections", exc)


@router.get("/api/detections/file")
def get_detections_file(request: Request) -> Response:
    try:
        return s3.detections_response(request)
    except FileNotFoundError:
        not_found("Detections file not found")
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error serving detections file", exc)


@router.get("/api/video")
def get_video(request: Request) -> Response:
    try:
        return s3.video_stream_response(request)
    except FileNotFoundError:
        not_found("Video not found")
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error streaming video", exc)


@router.get("/api/video/mock_stream")
def get_mock_stream_video(request: Request) -> Response:
    try:
        return s3.fusion_video_response(request)
    except FileNotFoundError:
        not_found("Mock stream video file not found")
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error streaming mock stream video", exc)


@router.get("/api/assets/oceanbackground")
def get_components_background() -> Response:
    try:
        return s3.components_background_response()
    except FileNotFoundError:
        not_found("Background image not found")
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error serving background image", exc)


@router.get("/api/video/stream")
async def stream_video(request: Request) -> Response:
    try:
        return s3.video_stream_response(request)
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error in video stream", exc)


@router.websocket("/api/mock_stream/ws")
async def websocket_mock_stream(websocket: WebSocket, profile: str = "mock") -> None:
    """profile param accepted for API compatibility but ignored — always serves mock data."""
    await mock_stream.handle_mock_stream_ws(websocket)
