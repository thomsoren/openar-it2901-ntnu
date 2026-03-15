"""Tests for HLS playback routes — /api/playback/{asset_id}/hls.

Covers authorization logic: public vs private assets, owner access,
admin access, and unauthenticated access.
"""
from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from auth.security import create_access_token
from db.database import Base, get_db
from db.models import AppUser, MediaAsset
from webapi.routes.playback import router


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite://",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    TestSession = sessionmaker(bind=db_engine, autocommit=False, autoflush=False, class_=Session)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session: Session):
    app = FastAPI()
    app.include_router(router)

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db

    @contextmanager
    def _mock_session_local():
        yield db_session

    with patch("webapi.routes.playback.SessionLocal", _mock_session_local), \
         patch("auth.deps.SessionLocal", _mock_session_local):
        with TestClient(app) as c:
            yield c


@pytest.fixture()
def owner_user(db_session: Session) -> AppUser:
    user = AppUser(id="owner-1", username="owner", email="owner@test.local", is_admin=False)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def other_user(db_session: Session) -> AppUser:
    user = AppUser(id="other-1", username="other", email="other@test.local", is_admin=False)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def admin_user(db_session: Session) -> AppUser:
    user = AppUser(id="admin-1", username="admin", email="admin@test.local", is_admin=True)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _auth_header(user_id: str) -> dict[str, str]:
    token = create_access_token(subject=user_id)
    return {"Authorization": f"Bearer {token}"}


def _create_asset(
    db_session: Session,
    *,
    asset_id: str = "asset-1",
    visibility: str = "public",
    owner_user_id: str | None = None,
    hls_status: str = "complete",
    hls_s3_prefix: str = "videos/test_hls/",
    is_system: bool = False,
) -> MediaAsset:
    asset = MediaAsset(
        id=asset_id,
        s3_key=f"videos/{asset_id}.mp4",
        media_type="video",
        visibility=visibility,
        owner_user_id=owner_user_id,
        hls_status=hls_status,
        hls_s3_prefix=hls_s3_prefix,
        is_system=is_system,
    )
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    return asset


_FAKE_M3U8 = "application/vnd.apple.mpegurl"
_FAKE_BODY = "#EXTM3U\n#EXT-X-ENDLIST\n"


# ── Tests ───────────────────────────────────────────────────────────────────


class TestPlaybackPublicAsset:
    """Public assets should be accessible without authentication."""

    @patch("webapi.routes.playback.build_hls_playlist", return_value=(_FAKE_M3U8, _FAKE_BODY))
    def test_public_asset_no_auth(self, mock_hls, client, db_session):
        _create_asset(db_session, visibility="public")
        resp = client.get("/api/playback/asset-1/hls")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == _FAKE_M3U8
        mock_hls.assert_called_once_with("videos/test_hls/")

    @patch("webapi.routes.playback.build_hls_playlist", return_value=(_FAKE_M3U8, _FAKE_BODY))
    def test_public_asset_with_auth(self, mock_hls, client, db_session, owner_user):
        _create_asset(db_session, visibility="public", owner_user_id=owner_user.id)
        resp = client.get("/api/playback/asset-1/hls", headers=_auth_header(owner_user.id))
        assert resp.status_code == 200


class TestPlaybackPrivateAsset:
    """Private assets require auth + ownership or admin."""

    def test_private_asset_no_auth_returns_403(self, client, db_session, owner_user):
        _create_asset(db_session, visibility="private", owner_user_id=owner_user.id)
        resp = client.get("/api/playback/asset-1/hls")
        assert resp.status_code == 403

    @patch("webapi.routes.playback.build_hls_playlist", return_value=(_FAKE_M3U8, _FAKE_BODY))
    def test_private_asset_owner_allowed(self, mock_hls, client, db_session, owner_user):
        _create_asset(db_session, visibility="private", owner_user_id=owner_user.id)
        resp = client.get("/api/playback/asset-1/hls", headers=_auth_header(owner_user.id))
        assert resp.status_code == 200

    def test_private_asset_other_user_returns_403(self, client, db_session, owner_user, other_user):
        _create_asset(db_session, visibility="private", owner_user_id=owner_user.id)
        resp = client.get("/api/playback/asset-1/hls", headers=_auth_header(other_user.id))
        assert resp.status_code == 403

    @patch("webapi.routes.playback.build_hls_playlist", return_value=(_FAKE_M3U8, _FAKE_BODY))
    def test_private_asset_admin_allowed(self, mock_hls, client, db_session, owner_user, admin_user):
        _create_asset(db_session, visibility="private", owner_user_id=owner_user.id)
        resp = client.get("/api/playback/asset-1/hls", headers=_auth_header(admin_user.id))
        assert resp.status_code == 200


class TestPlaybackNotFound:
    """Missing assets and unavailable HLS should return 404."""

    def test_nonexistent_asset_returns_404(self, client):
        resp = client.get("/api/playback/nonexistent/hls")
        assert resp.status_code == 404

    @patch("webapi.routes.playback.build_hls_playlist", return_value=None)
    def test_hls_not_ready_returns_404(self, mock_hls, client, db_session):
        _create_asset(db_session, visibility="public")
        resp = client.get("/api/playback/asset-1/hls")
        assert resp.status_code == 404

    def test_hls_status_not_complete_returns_404(self, client, db_session):
        _create_asset(db_session, visibility="public", hls_status="processing")
        resp = client.get("/api/playback/asset-1/hls")
        assert resp.status_code == 404


class TestPlaybackSystemAsset:
    """System assets (is_system=True) are accessible without authentication."""

    @patch("webapi.routes.playback.build_hls_playlist", return_value=(_FAKE_M3U8, _FAKE_BODY))
    def test_system_asset_no_auth(self, mock_hls, client, db_session):
        _create_asset(db_session, visibility="private", is_system=True)
        resp = client.get("/api/playback/asset-1/hls")
        assert resp.status_code == 200

    @patch("webapi.routes.playback.build_hls_playlist", return_value=(_FAKE_M3U8, _FAKE_BODY))
    def test_system_asset_with_auth(self, mock_hls, client, db_session, owner_user):
        _create_asset(db_session, visibility="private", is_system=True, owner_user_id=owner_user.id)
        resp = client.get("/api/playback/asset-1/hls", headers=_auth_header(owner_user.id))
        assert resp.status_code == 200


class TestPlaybackQueryToken:
    """The ?access_token= query param should work for HLS playback."""

    @patch("webapi.routes.playback.build_hls_playlist", return_value=(_FAKE_M3U8, _FAKE_BODY))
    def test_query_param_token_works(self, mock_hls, client, db_session, owner_user):
        _create_asset(db_session, visibility="private", owner_user_id=owner_user.id)
        token = create_access_token(subject=owner_user.id)
        resp = client.get(f"/api/playback/asset-1/hls?access_token={token}")
        assert resp.status_code == 200
