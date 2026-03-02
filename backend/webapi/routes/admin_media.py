"""Admin endpoints for managing media assets."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth.deps import require_admin
from db.database import get_db
from db.models import AppUser, MediaAsset
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


@router.get("", response_model=list[MediaAssetResponse])
def list_media_assets(
    _: Annotated[AppUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    assets = db.query(MediaAsset).order_by(MediaAsset.created_at.desc()).all()
    return [MediaAssetResponse.from_orm(a) for a in assets]


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media_asset(
    asset_id: str,
    _: Annotated[AppUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

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
    _: Annotated[AppUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if payload.visibility not in {"private", "group", "public"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="visibility must be private, group, or public",
        )

    asset = db.get(MediaAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    asset.visibility = payload.visibility
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return MediaAssetResponse.from_orm(asset)
