from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi import HTTPException

from webapi.errors import bad_request, wrap_internal
from auth.deps import get_current_user
from common.config import load_samples
from db.models import AppUser
from mock_stream import mock_stream
from services.transcode_service import run_transcode_task
from storage import s3

router = APIRouter()

# API boundary note: handlers intentionally catch broad exceptions and map
# them to HTTP errors so failures are returned consistently.


@router.get("/")
def read_root() -> dict[str, Any]:
    return {
        "status": "ok",
        "message": "OpenAR Backend API is running",
        "endpoints": {
            "detections": "/api/detections",
            "detections_file": "/api/detections/file",
            "detections_ws": "/api/detections/ws/{stream_id}",
            "streams": "/api/streams",
            "stream_playback": "/api/streams/{stream_id}/playback",
            "video": "/api/video",
            "ais": "/api/ais",
            "ais_stream": "/api/ais/stream",
            "ais_projections": "/api/ais/projections",
            "ais_projections_mmsi": "/api/ais/projections/mmsi",
            "samples": "/api/samples",
            "storage_presign": "/api/storage/presign",
            "health": "/health",
        },
    }


@router.get("/health")
def health_check() -> dict[str, Any]:
    try:
        return s3.health_status()
    except Exception as exc:
        wrap_internal("Health check failed", exc)


@router.get("/api/samples")
def list_samples() -> dict[str, Any]:
    try:
        return {"samples": load_samples()}
    except Exception as exc:
        wrap_internal("Error loading samples", exc)


@router.post("/api/mock_stream/reset")
def reset_mock_stream_timer(profile: str = "mock") -> dict[str, Any]:
    """profile param accepted for API compatibility but ignored."""
    try:
        start = mock_stream.reset_sample_timer()
        return {"status": "ok", "start_mono": start}
    except Exception as exc:
        wrap_internal("Error resetting mock stream timer", exc)


@router.post("/api/storage/presign")
def presign_storage(
    request: s3.PresignRequest,
    background_tasks: BackgroundTasks,
    current_user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        result = s3.presign_storage(
            request,
            owner_user_id=current_user.id,
            is_admin=current_user.is_admin,
        )

        key = result.get("key", "")
        is_video_key = key.startswith("videos/")
        is_completed_upload = result.get("completed") and is_video_key
        is_put_upload = result.get("method") == "PUT" and is_video_key
        if is_completed_upload or is_put_upload:
            background_tasks.add_task(run_transcode_task, key)

        return result
    except ValueError as exc:
        bad_request(str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        wrap_internal("Error generating presigned URL", exc)
