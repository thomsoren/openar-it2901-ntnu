"""Debug DB connection."""
import sys
sys.path.insert(0, ".")
from sqlalchemy import text
from db.database import engine

conn = engine.connect()
r = conn.execute(text("SELECT current_database(), current_schema()")).fetchone()
print(f"db={r[0]} schema={r[1]}")

r2 = conn.execute(text("SELECT count(*) FROM information_schema.tables WHERE table_name='media_assets'")).fetchone()
print(f"media_assets tables found: {r2[0]}")

r3 = conn.execute(text("SELECT count(*) FROM media_assets")).fetchone()
print(f"media_assets rows: {r3[0]}")
conn.close()
