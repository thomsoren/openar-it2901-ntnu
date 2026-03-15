"""IDUN WebSocket endpoint — self-contained FastAPI router.

Conditionally included in the main app only when IDUN_ENABLED=true.
"""
from __future__ import annotations

import hmac
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket
from pydantic import BaseModel

from cv.idun.bridge import IdunBridge
from cv.idun.config import IDUN_API_KEY
from db.database import SessionLocal
from db.models import MediaAsset
from services.uploaded_video_analysis_service import (
    ANALYSIS_STATUS_COMPLETED,
    ANALYSIS_STATUS_PROCESSING,
    build_result_payload,
    build_placeholder_payload,
    claim_next_queued_asset,
    get_analysis_s3_key,
    mark_payload_failed,
    mark_payload_processing,
    read_analysis_payload,
    write_analysis_payload,
)
from storage import s3

logger = logging.getLogger(__name__)

router = APIRouter()

# Singleton bridge instance, set during app startup via ``init_bridge()``.
_bridge: IdunBridge | None = None


def init_bridge(bridge: IdunBridge) -> None:
    """Register the bridge instance (called from app lifespan)."""
    global _bridge
    _bridge = bridge


class AnalysisFailurePayload(BaseModel):
    error_message: str


class AnalysisCompletePayload(BaseModel):
    fps: float | None = None
    total_frames: int | None = None
    video_width: int | None = None
    video_height: int | None = None
    frames: dict[str, list[dict[str, Any]]]


def _require_idun_api_key(request: Request) -> None:
    auth_header = request.headers.get("authorization", "")
    _, _, token = auth_header.partition(" ")
    if not token or not hmac.compare_digest(token.strip(), IDUN_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")


def _load_asset_or_404(db, asset_id: str):
    asset = db.get(MediaAsset, asset_id)
    if asset is None or asset.media_type != "video":
        raise HTTPException(status_code=404, detail="Uploaded video asset not found")
    return asset


@router.websocket("/api/idun/ws")
async def websocket_idun_worker(websocket: WebSocket) -> None:
    """WebSocket endpoint that IDUN inference workers connect to.

    Authentication is via a shared API key in the Authorization header.
    Only one worker connection is accepted at a time.
    """
    await websocket.accept()

    if _bridge is None:
        await websocket.close(code=1011, reason="IDUN bridge not initialized")
        return

    # Authenticate
    auth_header = websocket.headers.get("authorization", "")
    _, _, token = auth_header.partition(" ")
    if not token or not hmac.compare_digest(token.strip(), IDUN_API_KEY):
        await websocket.close(code=1008, reason="Invalid API key")
        logger.warning("IDUN worker rejected: invalid API key")
        return

    await _bridge.handle_worker_connection(websocket)


@router.post("/api/idun/jobs/claim")
def claim_uploaded_video_job(
    _auth: None = Depends(_require_idun_api_key),
):
    with SessionLocal() as db:
        asset = claim_next_queued_asset(db)
        if asset is None:
            return Response(status_code=204)
        return {
            "job": {
                "id": asset.id,
                "media_asset_id": asset.id,
                "input_s3_key": asset.s3_key,
                "detections_s3_key": get_analysis_s3_key(asset),
                "status": ANALYSIS_STATUS_PROCESSING,
                "owner_user_id": asset.owner_user_id,
                "input_url": s3.presign_get(asset.s3_key, expires=3600),
            }
        }


@router.post("/api/idun/jobs/{job_id}/start")
def start_uploaded_video_job(
    job_id: str,
    _auth: None = Depends(_require_idun_api_key),
):
    with SessionLocal() as db:
        asset = _load_asset_or_404(db, job_id)
        current_payload = read_analysis_payload(asset) or build_placeholder_payload(asset)
        write_analysis_payload(asset, mark_payload_processing(current_payload))
        return {"job_id": asset.id, "status": ANALYSIS_STATUS_PROCESSING}


@router.put("/api/idun/jobs/{job_id}/complete")
def complete_uploaded_video_job(
    job_id: str,
    payload: AnalysisCompletePayload,
    _auth: None = Depends(_require_idun_api_key),
):
    with SessionLocal() as db:
        asset = _load_asset_or_404(db, job_id)
        result_payload = build_result_payload(
            frames=payload.frames,
            fps=payload.fps,
            total_frames=payload.total_frames,
            video_width=payload.video_width,
            video_height=payload.video_height,
        )
        write_analysis_payload(asset, result_payload)
        return {"job_id": asset.id, "status": ANALYSIS_STATUS_COMPLETED}


@router.put("/api/idun/jobs/{job_id}/fail")
def fail_uploaded_video_job(
    job_id: str,
    payload: AnalysisFailurePayload,
    _auth: None = Depends(_require_idun_api_key),
):
    with SessionLocal() as db:
        asset = _load_asset_or_404(db, job_id)
        current_payload = read_analysis_payload(asset) or build_placeholder_payload(asset)
        failed_payload = mark_payload_failed(current_payload, payload.error_message)
        write_analysis_payload(asset, failed_payload)
        return {"job_id": asset.id, "status": failed_payload["status"]}
