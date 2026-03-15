"""HLS playback routes — serve presigned .m3u8 playlists for uploaded videos."""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select

from auth.deps import get_optional_user_with_query_token
from db.database import SessionLocal
from db.models import AppUser, MediaAsset
from services.hls_service import get_hls_playlist_for_asset

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/playback/{asset_id}/hls")
async def get_hls_playlist(
    asset_id: str,
    current_user: Annotated[AppUser | None, Depends(get_optional_user_with_query_token)],
) -> Response:
    """Return the .m3u8 playlist with presigned .ts URLs for direct S3 playback.

    Public/system assets are accessible without login.
    Private assets require JWT + ownership or admin.
    """
    with SessionLocal() as db:
        asset = db.execute(
            select(MediaAsset).where(MediaAsset.id == asset_id)
        ).scalar_one_or_none()
        if asset is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        if asset.visibility != "public":
            if current_user is None:
                raise HTTPException(status_code=403, detail="Authentication required for private assets")
            elif not current_user.is_admin and asset.owner_user_id != current_user.id:
                raise HTTPException(status_code=403, detail="You do not have access to this asset")

    result = get_hls_playlist_for_asset(asset_id)
    if result is None:
        raise HTTPException(status_code=404, detail="HLS playlist not available for this asset")

    content_type, body = result
    return Response(content=body, media_type=content_type)
