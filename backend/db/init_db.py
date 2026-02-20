from __future__ import annotations

from db.database import Base, engine
from db import models  # noqa: F401 - ensure metadata is registered


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
