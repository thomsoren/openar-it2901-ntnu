from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from db.database import Base, engine
from db import models  # noqa: F401 - ensure metadata is registered

logger = logging.getLogger(__name__)

_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    ("media_assets", "transcoded_s3_key", "VARCHAR(1024)"),
    ("media_assets", "transcode_status", "VARCHAR(20)"),
]


def _add_missing_columns() -> None:
    """Add columns that create_all cannot add to existing tables."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, column, col_type in _COLUMN_MIGRATIONS:
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            if column not in existing:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{column}" {col_type}'))
                logger.info("Added column %s.%s", table, column)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
