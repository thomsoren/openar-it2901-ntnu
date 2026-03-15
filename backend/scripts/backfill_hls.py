"""Backfill transcode + HLS segmentation for all existing video assets.

Run from the backend directory:
    python scripts/backfill_hls.py

Phase 1: Transcode video assets that haven't been transcoded yet
         (run_transcode_task auto-chains HLS after transcode).
Phase 2: HLS-only for assets already transcoded but missing HLS.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

# Ensure backend root is on the path so imports work
backend_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_root))

# Load .env before any settings import
from dotenv import load_dotenv
load_dotenv(backend_root / ".env")

from sqlalchemy import or_, select

from db.database import SessionLocal
from db.models import MediaAsset
from services.transcode_service import (
    hls_prefix_for,
    set_hls_status,
    set_transcode_status,
    segment_to_hls,
    transcode_to_h264,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("backfill_hls")


def main() -> None:
    # Phase 1: Transcode + HLS for video assets not yet transcoded
    with SessionLocal() as db:
        untranscoded = db.execute(
            select(MediaAsset).where(
                MediaAsset.media_type == "video",
                or_(
                    MediaAsset.transcode_status.is_(None),
                    MediaAsset.transcode_status.in_(["pending", "failed"]),
                ),
            )
        ).scalars().all()
        transcode_keys = [row.s3_key for row in untranscoded]

    if transcode_keys:
        logger.info("Phase 1: Transcoding %d video(s)", len(transcode_keys))
        for i, s3_key in enumerate(transcode_keys, 1):
            logger.info("[transcode %d/%d] %s", i, len(transcode_keys), s3_key)
            set_transcode_status(s3_key, "processing")
            try:
                transcoded_key = transcode_to_h264(s3_key)
                set_transcode_status(s3_key, "complete", transcoded_key)
                logger.info("[transcode] Done: %s -> %s", s3_key, transcoded_key or "(original ok)")

                # Chain HLS
                effective_key = transcoded_key or s3_key
                set_hls_status(s3_key, "processing")
                try:
                    hls_prefix = segment_to_hls(effective_key)
                    set_hls_status(s3_key, "complete", hls_prefix)
                    logger.info("[hls] Done: %s -> %s", s3_key, hls_prefix)
                except Exception as exc:
                    logger.error("[hls] Failed for %s: %s", s3_key, exc)
                    set_hls_status(s3_key, "failed")
            except Exception as exc:
                logger.error("[transcode] Failed for %s: %s", s3_key, exc)
                set_transcode_status(s3_key, "failed")
    else:
        logger.info("Phase 1: All videos already transcoded")

    # Phase 2: HLS-only for assets already transcoded but missing HLS
    with SessionLocal() as db:
        needs_hls = db.execute(
            select(MediaAsset).where(
                MediaAsset.transcode_status == "complete",
                or_(
                    MediaAsset.hls_status.is_(None),
                    MediaAsset.hls_status.in_(["pending", "failed"]),
                ),
            )
        ).scalars().all()
        hls_assets = [(row.s3_key, row.transcoded_s3_key) for row in needs_hls]

    if hls_assets:
        logger.info("Phase 2: HLS segmentation for %d asset(s)", len(hls_assets))
        for i, (s3_key, transcoded_key) in enumerate(hls_assets, 1):
            effective_key = transcoded_key or s3_key
            logger.info("[hls %d/%d] %s", i, len(hls_assets), effective_key)
            set_hls_status(s3_key, "processing")
            try:
                hls_prefix = segment_to_hls(effective_key)
                set_hls_status(s3_key, "complete", hls_prefix)
                logger.info("[hls] Done: %s -> %s", s3_key, hls_prefix)
            except Exception as exc:
                logger.error("[hls] Failed for %s: %s", s3_key, exc)
                set_hls_status(s3_key, "failed")
    else:
        logger.info("Phase 2: All transcoded assets already have HLS")

    logger.info("Backfill complete")


if __name__ == "__main__":
    main()
