"""HLS playlist service — presign .ts segment URLs in a .m3u8 playlist."""
from __future__ import annotations

import logging
import re
from typing import Callable

from sqlalchemy import select

from db.database import SessionLocal
from db.models import MediaAsset
from storage import s3

logger = logging.getLogger(__name__)

_HLS_PRESIGN_EXPIRES = 7200  # 2 hours, matches FFmpeg presign


def rewrite_m3u8_with_presigned_urls(
    m3u8_text: str,
    hls_prefix: str,
    presign_fn: Callable[[str, int], str] | None = None,
) -> str | None:
    """Replace bare .ts filenames in a .m3u8 playlist with presigned S3 URLs.

    Args:
        m3u8_text: Raw contents of the index.m3u8 file.
        hls_prefix: S3 prefix where segments live (e.g. 'videos/.../clip_hls/').
        presign_fn: Optional presign function (for testing). Defaults to s3.presign_get.

    Returns:
        Modified .m3u8 text with .ts lines replaced by presigned URLs.
    """
    if presign_fn is None:
        presign_fn = lambda key, expires=_HLS_PRESIGN_EXPIRES: s3.presign_get(key, expires=expires)

    lines = m3u8_text.splitlines()
    result = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and stripped.endswith(".ts"):
            segment_key = hls_prefix + stripped
            try:
                presigned_url = presign_fn(segment_key, _HLS_PRESIGN_EXPIRES)
            except Exception:
                logger.exception("[hls] Failed to presign segment %s", segment_key)
                return None
            result.append(presigned_url)
        else:
            result.append(line)
    return "\n".join(result) + "\n"


def get_hls_playlist_for_asset(asset_id: str) -> tuple[str, str] | None:
    """Return (content_type, rewritten_m3u8) for an asset, or None if not ready.

    Reads the index.m3u8 from S3 and rewrites .ts paths with presigned URLs.
    """
    with SessionLocal() as db:
        asset = db.execute(
            select(MediaAsset).where(MediaAsset.id == asset_id)
        ).scalar_one_or_none()
        if not asset or asset.hls_status != "complete" or not asset.hls_s3_prefix:
            return None
        hls_prefix = asset.hls_s3_prefix

    m3u8_key = hls_prefix + "index.m3u8"
    m3u8_text = s3.read_text_from_sources(m3u8_key)
    if not m3u8_text:
        logger.error("[hls] Failed to read m3u8 from s3://%s", m3u8_key)
        return None

    rewritten = rewrite_m3u8_with_presigned_urls(m3u8_text, hls_prefix)
    if rewritten is None:
        return None
    return "application/vnd.apple.mpegurl", rewritten


def get_hls_playback_url(s3_key: str) -> str | None:
    """Return the HLS playlist API URL for an asset, or None if not ready."""
    with SessionLocal() as db:
        asset = db.execute(
            select(MediaAsset).where(MediaAsset.s3_key == s3_key)
        ).scalar_one_or_none()
        if not asset or asset.hls_status != "complete" or not asset.hls_s3_prefix:
            return None
        return f"/api/playback/{asset.id}/hls"
