"""Quick check of HLS status in the database."""
import sys
from pathlib import Path

backend_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_root))

from dotenv import load_dotenv
load_dotenv(backend_root / ".env")

from db.database import SessionLocal
from db.models import MediaAsset
from sqlalchemy import select

db = SessionLocal()
rows = db.execute(select(MediaAsset.s3_key, MediaAsset.transcode_status, MediaAsset.hls_status, MediaAsset.media_type)).all()
print(f"{'hls':>10} | {'xcode':>10} | {'type':>6} | s3_key")
print("-" * 100)
for r in rows:
    print(f"{str(r[2]):>10} | {str(r[1]):>10} | {str(r[3]):>6} | {r[0][-60:]}")
db.close()
