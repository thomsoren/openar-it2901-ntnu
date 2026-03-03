from __future__ import annotations

import os
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, WebSocket
from fastapi.responses import Response

from webapi.errors import not_found, wrap_internal
from common.types import DetectedVessel
from fusion import fusion
from storage import s3

router = APIRouter()

# API boundary note: handlers intentionally catch broad exceptions and map
# them to HTTP errors so failures are returned consistently.

PIRBADET_VIDEO_S3_KEY_DEFAULT = (
    "videos/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/Pirbadet-edited.mp4"
)


def _coerce_s3_key(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    if value.startswith("s3://"):
        return value[5:]
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        path = parsed.path.strip("/")
        if path.startswith("openar/"):
            return path[len("openar/") :]
        return path
    return value


def _stream_pirbadet_video(request: Request) -> Response:
    configured = os.getenv("FUSION_PIRBADET_VIDEO_S3_KEY", PIRBADET_VIDEO_S3_KEY_DEFAULT)
    key = _coerce_s3_key(configured)
    if key:
        try:
            return s3._stream_s3_response(key, request, "Pirbadet-edited.mp4")
        except HTTPException:
            # Continue to DB/local fallbacks when configured key is unavailable.
            pass

    try:
        key = s3.resolve_system_asset_key("fusion_video_pirbadet", "video")
        try:
            return s3._stream_s3_response(key, request, "Pirbadet-edited.mp4")
        except HTTPException:
            pass
    except Exception:
        pass

    not_found("Pirbadet fusion video file not found on S3")


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
def get_video(request: Request) -> Response:
    try:
        return s3.video_stream_response(request)
    except FileNotFoundError:
        not_found("Video not found")
    except Exception as exc:
        wrap_internal("Error streaming video", exc)


@router.get("/api/video/fusion")
def get_fusion_video(request: Request, profile: str = "mock") -> Response:
    try:
        if profile.strip().lower() == "pirbadet":
            return _stream_pirbadet_video(request)
        return s3.fusion_video_response(request)
    except FileNotFoundError:
        not_found("Fusion video file not found")
    except HTTPException as exc:
        # Preserve deliberate 4xx/5xx from helper functions.
        raise exc
    except Exception as exc:
        wrap_internal("Error streaming fusion video", exc)


@router.get("/api/video/fusion/pirbadet")
def get_fusion_video_pirbadet(request: Request) -> Response:
    try:
        return _stream_pirbadet_video(request)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        wrap_internal("Error streaming Pirbadet fusion video", exc)


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
async def websocket_fusion(websocket: WebSocket, profile: str = "mock") -> None:
    await fusion.handle_fusion_ws(websocket, profile=profile)
