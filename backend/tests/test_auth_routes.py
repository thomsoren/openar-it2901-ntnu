"""Tests for auth routes — /auth/me, /admin/users, /admin/users/{id}."""
from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from auth.security import create_access_token
from db.models import AppUser


def _auth_header(user_id: str) -> dict[str, str]:
    token = create_access_token(subject=user_id)
    return {"Authorization": f"Bearer {token}"}


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
