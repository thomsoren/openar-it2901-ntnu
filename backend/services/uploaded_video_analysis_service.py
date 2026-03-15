from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import MediaAsset

ANALYSIS_STATUS_QUEUED = "queued"
ANALYSIS_STATUS_PROCESSING = "processing"
ANALYSIS_STATUS_COMPLETED = "completed"
ANALYSIS_STATUS_FAILED = "failed"
ANALYSIS_STATUSES = {
    ANALYSIS_STATUS_QUEUED,
    ANALYSIS_STATUS_PROCESSING,
    ANALYSIS_STATUS_COMPLETED,
    ANALYSIS_STATUS_FAILED,
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def build_detections_s3_key(owner_user_id: str, media_asset_id: str) -> str:
    return f"analysis/{owner_user_id}/{media_asset_id}/detections.json"


def get_analysis_s3_key(media_asset: MediaAsset) -> str:
    owner_user_id = (media_asset.owner_user_id or "").strip()
    if not owner_user_id:
        raise ValueError("Uploaded video analysis requires a media asset owner")
    return build_detections_s3_key(owner_user_id, media_asset.id)


def build_placeholder_payload(
    media_asset: MediaAsset,
    *,
    status: str = ANALYSIS_STATUS_QUEUED,
    error_message: str | None = None,
) -> dict[str, Any]:
    if status not in ANALYSIS_STATUSES:
        raise ValueError(f"Invalid analysis status: {status}")
    current_time = now_utc().isoformat()
    return {
        "status": status,
        "error_message": error_message,
        "updated_at": current_time,
        "completed_at": None,
        "fps": None,
        "total_frames": None,
        "video_width": None,
        "video_height": None,
        "frames": {},
    }


def build_result_payload(
    *,
    frames: dict[str, list[dict[str, Any]]],
    fps: float | None,
    total_frames: int | None,
    video_width: int | None,
    video_height: int | None,
) -> dict[str, Any]:
    completed_at = now_utc().isoformat()
    return {
        "status": ANALYSIS_STATUS_COMPLETED,
        "error_message": None,
        "updated_at": completed_at,
        "completed_at": completed_at,
        "fps": fps,
        "total_frames": total_frames,
        "video_width": video_width,
        "video_height": video_height,
        "frames": frames,
    }


def read_analysis_payload(media_asset: MediaAsset) -> dict[str, Any] | None:
    from storage import s3

    return s3.read_json(get_analysis_s3_key(media_asset))


def write_analysis_payload(media_asset: MediaAsset, payload: dict[str, Any]) -> str:
    from storage import s3

    key = get_analysis_s3_key(media_asset)
    s3.write_json(key, payload)
    return key


def build_summary(media_asset: MediaAsset) -> dict[str, Any] | None:
    payload = read_analysis_payload(media_asset)
    if payload is None:
        return None
    status = str(payload.get("status") or "").strip().lower()
    if status not in ANALYSIS_STATUSES:
        return None
    return {
        "status": status,
        "error_message": payload.get("error_message"),
        "updated_at": payload.get("updated_at"),
        "completed_at": payload.get("completed_at"),
        "fps": payload.get("fps"),
        "video_width": payload.get("video_width"),
        "video_height": payload.get("video_height"),
        "has_result": status == ANALYSIS_STATUS_COMPLETED,
    }


def mark_payload_processing(payload: dict[str, Any] | None) -> dict[str, Any]:
    next_payload = dict(payload or {})
    next_payload["status"] = ANALYSIS_STATUS_PROCESSING
    next_payload["error_message"] = None
    next_payload["updated_at"] = now_utc().isoformat()
    next_payload["completed_at"] = None
    next_payload.setdefault("fps", None)
    next_payload.setdefault("total_frames", None)
    next_payload.setdefault("video_width", None)
    next_payload.setdefault("video_height", None)
    next_payload.setdefault("frames", {})
    return next_payload


def mark_payload_failed(payload: dict[str, Any] | None, error_message: str) -> dict[str, Any]:
    next_payload = dict(payload or {})
    next_payload["status"] = ANALYSIS_STATUS_FAILED
    next_payload["error_message"] = error_message.strip() or "Processing failed"
    next_payload["updated_at"] = now_utc().isoformat()
    next_payload["completed_at"] = None
    next_payload.setdefault("fps", None)
    next_payload.setdefault("total_frames", None)
    next_payload.setdefault("video_width", None)
    next_payload.setdefault("video_height", None)
    next_payload.setdefault("frames", {})
    return next_payload


def claim_next_queued_asset(db: Session) -> MediaAsset | None:
    assets = (
        db.execute(
            select(MediaAsset)
            .where(MediaAsset.media_type == "video")
            .where(MediaAsset.owner_user_id.is_not(None))
            .order_by(MediaAsset.created_at.asc())
        )
        .scalars()
        .all()
    )
    for asset in assets:
        payload = read_analysis_payload(asset)
        if payload is None:
            continue
        if str(payload.get("status") or "").strip().lower() != ANALYSIS_STATUS_QUEUED:
            continue
        write_analysis_payload(asset, mark_payload_processing(payload))
        return asset
    return None
