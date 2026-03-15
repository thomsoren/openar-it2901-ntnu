from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from auth.deps import get_current_user
from db.database import get_db
from db.models import AppUser, MediaAsset
from webapi.errors import not_found, wrap_internal
from common.types import DetectedVessel
from fusion import fusion
from services.uploaded_video_analysis_service import (
    ANALYSIS_STATUS_COMPLETED,
    build_placeholder_payload,
    build_summary,
    read_analysis_payload,
    write_analysis_payload,
)
from storage import s3

router = APIRouter()

# API boundary note: handlers intentionally catch broad exceptions and map
# them to HTTP errors so failures are returned consistently.
PIRBADET_VIDEO_ASSET_NAMES = ("fusion_video_pirbadet",)


def _stream_pirbadet_video(request: Request) -> Response:
    try:
        _, key = s3.resolve_first_system_asset_key(PIRBADET_VIDEO_ASSET_NAMES)
        return s3._stream_s3_response(key, request, "Pirbadet-edited.mp4")
    except HTTPException:
        raise
    except Exception:
        not_found("Pirbadet fusion video file not found in media_assets/S3")


def _get_owned_media_asset(
    db: Session,
    asset_id: str,
    current_user: AppUser,
) -> MediaAsset:
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        not_found("Media asset not found")
    if not current_user.is_admin and asset.owner_user_id != current_user.id:
        not_found("Media asset not found")
    return asset


@router.get("/api/detections", response_model=list[DetectedVessel])
def get_detections() -> list[DetectedVessel]:
    try:
        return fusion.get_detections()
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


@router.get("/api/video/fusion")
def get_fusion_video(request: Request, profile: str = "mock") -> Response:
    try:
        if profile.strip().lower() == "pirbadet":
            return _stream_pirbadet_video(request)
        return s3.fusion_video_response(request)
    except FileNotFoundError:
        not_found("Fusion video file not found")
    except HTTPException:
        # Preserve deliberate 4xx/5xx from helper functions.
        raise
    except Exception as exc:
        wrap_internal("Error streaming fusion video", exc)


@router.get("/api/video/fusion/pirbadet")
def get_fusion_video_pirbadet(request: Request) -> Response:
    try:
        return _stream_pirbadet_video(request)
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error streaming Pirbadet fusion video", exc)


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


@router.get("/api/media/{asset_id}/analysis")
def get_uploaded_video_analysis(
    asset_id: str,
    current_user: Annotated[AppUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    try:
        asset = _get_owned_media_asset(db, asset_id, current_user)
        if asset.media_type != "video":
            not_found("Uploaded video analysis is only available for video assets")
        analysis = build_summary(asset)
        if analysis is None:
            not_found("Uploaded video analysis not found")
        return {
            "asset_id": asset.id,
            "analysis": analysis,
        }
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error fetching uploaded video analysis", exc)


@router.post("/api/media/{asset_id}/analysis/retry")
def retry_uploaded_video_analysis(
    asset_id: str,
    current_user: Annotated[AppUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    try:
        asset = _get_owned_media_asset(db, asset_id, current_user)
        if asset.media_type != "video":
            not_found("Uploaded video analysis is only available for video assets")
        write_analysis_payload(asset, build_placeholder_payload(asset))
        return {
            "asset_id": asset.id,
            "analysis": build_summary(asset),
        }
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error retrying uploaded video analysis", exc)


@router.get("/api/media/{asset_id}/analysis/result")
def get_uploaded_video_analysis_result(
    asset_id: str,
    current_user: Annotated[AppUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> JSONResponse:
    try:
        asset = _get_owned_media_asset(db, asset_id, current_user)
        if asset.media_type != "video":
            not_found("Uploaded video analysis is only available for video assets")
        payload = read_analysis_payload(asset)
        if payload is None:
            not_found("Uploaded video analysis not found")
        if str(payload.get("status") or "").strip().lower() != ANALYSIS_STATUS_COMPLETED:
            raise HTTPException(status_code=409, detail="Uploaded video analysis is not complete")
        return JSONResponse(payload)
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error fetching uploaded video analysis result", exc)


@router.websocket("/api/fusion/ws")
async def websocket_fusion(websocket: WebSocket, profile: str = "mock") -> None:
    await fusion.handle_fusion_ws(websocket, profile=profile)
