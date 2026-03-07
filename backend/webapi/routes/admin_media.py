"""Admin endpoints for managing media assets."""
from __future__ import annotations

from typing import Annotated
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.deps import get_current_user
from db.database import get_db
from db.models import AppUser, MediaAsset
from webapi import state
from webapi.errors import conflict
from storage.s3 import S3_BUCKET, _client, _normalize_key, s3_enabled

router = APIRouter(prefix="/api/admin/media", tags=["admin"])


class MediaAssetResponse(BaseModel):
    id: str
    asset_name: str | None
    s3_key: str
    media_type: str
    visibility: str
    owner_user_id: str | None
    group_id: str | None
    is_system: bool
    created_at: str

    @classmethod
    def from_orm(cls, asset: MediaAsset) -> "MediaAssetResponse":
        return cls(
            id=asset.id,
            asset_name=asset.asset_name,
            s3_key=asset.s3_key,
            media_type=asset.media_type,
            visibility=asset.visibility,
            owner_user_id=asset.owner_user_id,
            group_id=asset.group_id,
            is_system=asset.is_system,
            created_at=asset.created_at.isoformat(),
        )


class VisibilityPayload(BaseModel):
    visibility: str


class RenamePayload(BaseModel):
    asset_name: str


def _stream_source_uses_key(source_url: str, s3_key: str) -> bool:
    normalized_key = s3_key.strip().lstrip("/")
    if not normalized_key:
        return False
    if source_url.startswith(f"s3://{normalized_key}"):
        return True
    try:
        parsed = urlparse(source_url)
        path = unquote(parsed.path).lstrip("/")
        return path.endswith(normalized_key) or f"/{normalized_key}" in path
    except Exception:
        return normalized_key in source_url


def _asset_exists_on_s3(asset: MediaAsset) -> bool:
    if not s3_enabled():
        return False
    try:
        full_key, _ = _normalize_key(asset.s3_key)
        _client().head_object(Bucket=S3_BUCKET, Key=full_key)
        return True
    except Exception:
        return False


@router.get("", response_model=list[MediaAssetResponse])
def list_media_assets(
    current_user: Annotated[AppUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if not s3_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="S3 is not configured for Media Library",
        )
    query = db.query(MediaAsset)
    if not current_user.is_admin:
        query = query.filter(MediaAsset.owner_user_id == current_user.id)
    assets = query.order_by(MediaAsset.created_at.desc()).all()
    s3_assets = [asset for asset in assets if _asset_exists_on_s3(asset)]
    return [MediaAssetResponse.from_orm(a) for a in s3_assets]


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media_asset(
    asset_id: str,
    current_user: Annotated[AppUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if not current_user.is_admin and asset.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    if state.orchestrator:
        for stream in state.orchestrator.list_streams():
            stream_id = str(stream.get("stream_id", "")).strip()
            source_url = str(stream.get("source_url", "")).strip()
            if not stream_id or not source_url:
                continue
            if _stream_source_uses_key(source_url, asset.s3_key):
                try:
                    state.orchestrator.stop_stream(stream_id)
                except Exception:
                    # Best-effort stop; media cleanup should continue.
                    pass

    if s3_enabled():
        try:
            full_key, _ = _normalize_key(asset.s3_key)
            _client().delete_object(Bucket=S3_BUCKET, Key=full_key)
        except Exception:
            pass  # S3 delete failures don't block DB cleanup

    db.delete(asset)
    db.commit()


@router.patch("/{asset_id}/visibility", response_model=MediaAssetResponse)
def update_visibility(
    asset_id: str,
    payload: VisibilityPayload,
    current_user: Annotated[AppUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if payload.visibility not in {"private", "group", "public"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="visibility must be private, group, or public",
        )
    if payload.visibility == "public" and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public visibility requires admin privileges",
        )

    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if not current_user.is_admin and asset.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    asset.visibility = payload.visibility
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return MediaAssetResponse.from_orm(asset)


@router.patch("/{asset_id}/name", response_model=MediaAssetResponse)
def rename_asset(
    asset_id: str,
    payload: RenamePayload,
    current_user: Annotated[AppUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    name = payload.asset_name.strip()
    if not name or len(name) > 120:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="asset_name must be 1–120 characters",
        )

    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if not current_user.is_admin and asset.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    asset.asset_name = name
    db.add(asset)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        conflict(f"An asset named '{name}' already exists", cause=exc)
    db.refresh(asset)
    return MediaAssetResponse.from_orm(asset)
