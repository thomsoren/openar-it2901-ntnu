from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(255), primary_key=True, default=lambda: str(uuid4()))
    asset_name: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True, index=True)
    s3_key: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(40), nullable=False, default="video")
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="private", server_default=text("'private'"))
    owner_user_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )
    group_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    transcoded_s3_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    transcode_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_system: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
