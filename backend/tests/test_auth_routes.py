"""Tests for auth routes — /auth/token/exchange, /auth/me, /admin/users, /admin/users/{id}."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.orm import Session

from auth.security import create_access_token, decode_access_token
from db.models import AppUser


def _auth_header(user_id: str) -> dict[str, str]:
    token = create_access_token(subject=user_id)
    return {"Authorization": f"Bearer {token}"}


def _mock_better_auth_session(user_id: str, username: str, email: str | None = None):
    """Return a mock httpx.Response mimicking Better Auth /get-session."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {
        "session": {"id": "sess-1", "userId": user_id},
        "user": {"id": user_id, "username": username, "email": email},
    }
    return resp


# ---------- /auth/token/exchange ----------

_SESSION_COOKIE = "better-auth.session_token=abc123"


class TestTokenExchange:
    """Tests for POST /auth/token/exchange — the most security-critical endpoint."""

    def _post_exchange(self, client, cookies: str = _SESSION_COOKIE):
        return client.post("/auth/token/exchange", headers={"cookie": cookies})

    @patch("auth.routes.httpx.AsyncClient")
    def test_creates_new_user_and_returns_jwt(self, mock_client_cls, client, db_session: Session):
        mock_ctx = AsyncMock()
        mock_ctx.get = AsyncMock(return_value=_mock_better_auth_session("new-1", "alice", "alice@test.io"))
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        resp = self._post_exchange(client)

        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert body["expires_in"] > 0

        # Verify JWT decodes with correct subject
        payload = decode_access_token(body["access_token"])
        assert payload["sub"] == "new-1"

        # Verify user was persisted in DB
        user = db_session.get(AppUser, "new-1")
        assert user is not None
        assert user.username == "alice"
        assert user.email == "alice@test.io"
        assert user.is_admin is False

    @patch("auth.routes.httpx.AsyncClient")
    def test_updates_existing_user(self, mock_client_cls, client, regular_user: AppUser, db_session: Session):
        mock_ctx = AsyncMock()
        mock_ctx.get = AsyncMock(
            return_value=_mock_better_auth_session(regular_user.id, "newname", "new@test.io")
        )
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        resp = self._post_exchange(client)

        assert resp.status_code == 200
        db_session.refresh(regular_user)
        assert regular_user.username == "newname"
        assert regular_user.email == "new@test.io"

    def test_no_cookie_returns_401(self, client, db_session: Session):
        resp = client.post("/auth/token/exchange")
        assert resp.status_code == 401

    def test_non_better_auth_cookie_returns_401(self, client, db_session: Session):
        resp = self._post_exchange(client, cookies="_ga=tracking123; _fbp=abc")
        assert resp.status_code == 401

    @patch("auth.routes.httpx.AsyncClient")
    def test_invalid_session_returns_401(self, mock_client_cls, client, db_session: Session):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 401
        mock_ctx = AsyncMock()
        mock_ctx.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        resp = self._post_exchange(client)
        assert resp.status_code == 401

    @patch("auth.routes.httpx.AsyncClient")
    def test_missing_username_returns_401(self, mock_client_cls, client, db_session: Session):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "user": {"id": "u-1", "username": None, "email": "a@b.c"},
        }
        mock_ctx = AsyncMock()
        mock_ctx.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        resp = self._post_exchange(client)
        assert resp.status_code == 401

    @patch("auth.routes.httpx.AsyncClient")
    def test_auth_service_down_returns_502(self, mock_client_cls, client, db_session: Session):
        mock_ctx = AsyncMock()
        mock_ctx.get = AsyncMock(side_effect=httpx.ConnectError("connection refused"))
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        resp = self._post_exchange(client)
        assert resp.status_code == 502

    @patch("auth.routes.httpx.AsyncClient")
    def test_filters_non_better_auth_cookies(self, mock_client_cls, client, db_session: Session):
        """Only better-auth.* cookies should be forwarded to the auth service."""
        mock_ctx = AsyncMock()
        mock_ctx.get = AsyncMock(return_value=_mock_better_auth_session("u-1", "bob"))
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        mixed_cookies = "_ga=track; better-auth.session_token=abc; _fbp=xyz"
        self._post_exchange(client, cookies=mixed_cookies)

        # Verify only better-auth cookie was forwarded
        call_kwargs = mock_ctx.get.call_args
        forwarded_cookie = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {})).get("cookie", "")
        assert "better-auth.session_token=abc" in forwarded_cookie
        assert "_ga" not in forwarded_cookie
        assert "_fbp" not in forwarded_cookie


# ---------- /auth/me ----------

class TestGetMe:
    def test_returns_user(self, client, regular_user: AppUser):
        resp = client.get("/auth/me", headers=_auth_header(regular_user.id))
        assert resp.status_code == 200
        body = resp.json()
        assert body["user"]["id"] == regular_user.id
        assert body["user"]["username"] == regular_user.username
        assert body["user"]["is_admin"] is False

    def test_admin_user(self, client, admin_user: AppUser):
        resp = client.get("/auth/me", headers=_auth_header(admin_user.id))
        assert resp.status_code == 200
        assert resp.json()["user"]["is_admin"] is True

    def test_no_token_returns_401(self, client, regular_user: AppUser):
        resp = client.get("/auth/me")
        assert resp.status_code == 401

    def test_invalid_token_returns_401(self, client, regular_user: AppUser):
        resp = client.get("/auth/me", headers={"Authorization": "Bearer bad-token"})
        assert resp.status_code == 401

    def test_nonexistent_user_returns_401(self, client, db_session: Session):
        resp = client.get("/auth/me", headers=_auth_header("no-such-user"))
        assert resp.status_code == 401


# ---------- /admin/users ----------

class TestListUsers:
    def test_admin_can_list(self, client, admin_user: AppUser, regular_user: AppUser):
        resp = client.get("/admin/users", headers=_auth_header(admin_user.id))
        assert resp.status_code == 200
        ids = [u["id"] for u in resp.json()["users"]]
        assert admin_user.id in ids
        assert regular_user.id in ids

    def test_non_admin_forbidden(self, client, regular_user: AppUser):
        resp = client.get("/admin/users", headers=_auth_header(regular_user.id))
        assert resp.status_code == 403

    def test_unauthenticated_returns_401(self, client, regular_user: AppUser):
        resp = client.get("/admin/users")
        assert resp.status_code == 401


# ---------- /admin/users/{user_id} PATCH ----------

class TestUpdateUserAdmin:
    def test_promote_user(self, client, admin_user: AppUser, regular_user: AppUser):
        resp = client.patch(
            f"/admin/users/{regular_user.id}",
            json={"is_admin": True},
            headers=_auth_header(admin_user.id),
        )
        assert resp.status_code == 200
        assert resp.json()["user"]["is_admin"] is True

    def test_demote_user(self, client, admin_user: AppUser, regular_user: AppUser, db_session: Session):
        regular_user.is_admin = True
        db_session.add(regular_user)
        db_session.commit()

        resp = client.patch(
            f"/admin/users/{regular_user.id}",
            json={"is_admin": False},
            headers=_auth_header(admin_user.id),
        )
        assert resp.status_code == 200
        assert resp.json()["user"]["is_admin"] is False

    def test_non_admin_forbidden(self, client, regular_user: AppUser):
        resp = client.patch(
            f"/admin/users/{regular_user.id}",
            json={"is_admin": True},
            headers=_auth_header(regular_user.id),
        )
        assert resp.status_code == 403

    def test_unknown_user_returns_404(self, client, admin_user: AppUser):
        resp = client.patch(
            "/admin/users/no-such-user",
            json={"is_admin": True},
            headers=_auth_header(admin_user.id),
        )
        assert resp.status_code == 404
