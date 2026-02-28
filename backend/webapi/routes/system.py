from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from webapi.errors import bad_request, wrap_internal
from auth.deps import get_current_user
from common.config import load_samples
from db.models import AppUser
from fusion import fusion
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


@router.post("/api/fusion/reset")
def reset_fusion_timer() -> dict[str, Any]:
    try:
        start = fusion.reset_sample_timer()
        return {"status": "ok", "start_mono": start}
    except Exception as exc:
        wrap_internal("Error resetting fusion timer", exc)


@router.post("/api/storage/presign")
def presign_storage(
    request: s3.PresignRequest,
    current_user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        return s3.presign_storage(
            request,
            owner_user_id=current_user.id,
            is_admin=current_user.is_admin,
        )
    except ValueError as exc:
        bad_request(str(exc))
    except Exception as exc:
        wrap_internal("Error generating presigned URL", exc)
