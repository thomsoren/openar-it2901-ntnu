"""Reset stuck 'processing' transcode/HLS statuses back to 'pending'."""
import sys
from pathlib import Path

backend_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_root))

from dotenv import load_dotenv
load_dotenv(backend_root / ".env")

from sqlalchemy import update
from db.database import SessionLocal
from db.models import MediaAsset

with SessionLocal() as db:
    # Reset stuck transcode_status = 'processing' to 'pending'
    r1 = db.execute(
        update(MediaAsset)
        .where(MediaAsset.transcode_status == "processing")
        .values(transcode_status="pending")
    )
    # Reset stuck hls_status = 'processing' to 'pending'
    r2 = db.execute(
        update(MediaAsset)
        .where(MediaAsset.hls_status == "processing")
        .values(hls_status="pending")
    )
    db.commit()
    print(f"Reset {r1.rowcount} stuck transcode(s), {r2.rowcount} stuck HLS job(s)")
