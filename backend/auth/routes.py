from __future__ import annotations

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from auth.config import settings
from auth.deps import get_current_user, require_admin
from auth.security import create_access_token
from db.database import get_db
from db.models import AppUser

logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(tags=["auth"])

_BETTER_AUTH_COOKIE_PREFIXES = ("better-auth.",)


def _filter_better_auth_cookies(cookie_header: str) -> str:
    """Keep only Better Auth cookies; drop analytics/tracking/unrelated cookies."""
    pairs = [
        pair.strip()
        for pair in cookie_header.split(";")
        if any(pair.strip().startswith(p) for p in _BETTER_AUTH_COOKIE_PREFIXES)
    ]
    return "; ".join(pairs)


class AppUserResponse(BaseModel):
    id: str
    email: str | None
    username: str
    is_admin: bool

    model_config = {"from_attributes": True}


class TokenExchangeResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class MeResponse(BaseModel):
    user: AppUserResponse


class LogoutResponse(BaseModel):
    success: bool


class UpdateUserAdminPayload(BaseModel):
    is_admin: bool


class UpdateUserAdminResponse(BaseModel):
    user: AppUserResponse


class ListUsersResponse(BaseModel):
    users: list[AppUserResponse]


@limiter.limit("10/minute")
@router.post("/auth/token/exchange", response_model=TokenExchangeResponse)
async def exchange_token(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    raw_cookies = request.headers.get("cookie", "")
    cookie_header = _filter_better_auth_cookies(raw_cookies)
    if not cookie_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No Better Auth session cookie found",
        )

    base_path = settings.better_auth_base_path
    if not base_path.startswith("/"):
        base_path = f"/{base_path}"

    session_url = f"{settings.better_auth_base_url.rstrip('/')}{base_path}/get-session"

    try:
        async with httpx.AsyncClient(timeout=settings.auth_request_timeout_sec) as client:
            session_response = await client.get(
                session_url,
                headers={
                    "cookie": cookie_header,
                    "accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Auth service unavailable: {exc}",
        ) from exc

    if session_response.status_code != status.HTTP_200_OK:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No active Better Auth session",
        )

    try:
        payload = session_response.json()
    except Exception as exc:
        logger.warning("Auth service returned non-JSON response: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session response",
        ) from exc

    user_payload = payload.get("user") if isinstance(payload, dict) else None
    if not isinstance(user_payload, dict):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session payload",
        )

    user_id = user_payload.get("id")
    if not isinstance(user_id, str) or not user_id.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session payload missing required id field",
        )
    user_id = user_id.strip()

    username = user_payload.get("username")
    if not isinstance(username, str) or not username.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session payload missing required username field",
        )
    normalized_username = username.strip().lower()

    email = user_payload.get("email")
    normalized_email = str(email).strip().lower() if isinstance(email, str) else None
    normalized_email = normalized_email or None

    user = db.get(AppUser, user_id)
    if user is None:
        user = AppUser(
            id=user_id,
            email=normalized_email,
            username=normalized_username,
        )
    else:
        user.email = normalized_email
        user.username = normalized_username

    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(subject=user.id)
    return TokenExchangeResponse(
        access_token=access_token,
        expires_in=settings.jwt_access_ttl_min * 60,
    )


@router.get("/auth/me", response_model=MeResponse)
def get_me(
    current_user: Annotated[AppUser, Depends(get_current_user)],
):
    return MeResponse(user=current_user)


@limiter.limit("10/minute")
@router.post("/auth/logout", response_model=LogoutResponse)
async def logout(request: Request, response: Response):
    base_path = settings.better_auth_base_path
    if not base_path.startswith("/"):
        base_path = f"/{base_path}"

    signout_url = f"{settings.better_auth_base_url.rstrip('/')}{base_path}/sign-out"
    cookie_header = _filter_better_auth_cookies(request.headers.get("cookie", ""))

    if cookie_header:
        try:
            async with httpx.AsyncClient(timeout=settings.auth_request_timeout_sec) as client:
                signout_response = await client.post(
                    signout_url,
                    headers={
                        "cookie": cookie_header,
                        "accept": "application/json",
                    },
                )
                if signout_response.status_code >= 500:
                    # Log-through behavior; logout remains idempotent from client perspective.
                    logger.warning(
                        "Better Auth sign-out returned %s", signout_response.status_code
                    )
        except httpx.HTTPError as exc:
            logger.warning("Better Auth sign-out request failed: %s", exc)

    for cookie_name in (
        "better-auth.session_token",
        "better-auth.session_data",
        "better-auth.csrf_token",
    ):
        response.delete_cookie(cookie_name, path="/")

    return LogoutResponse(success=True)


@router.get("/admin/users", response_model=ListUsersResponse)
def list_users(
    _: Annotated[AppUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    users = db.query(AppUser).order_by(AppUser.created_at.desc()).limit(200).all()
    return ListUsersResponse(users=users)


@router.patch("/admin/users/{user_id}", response_model=UpdateUserAdminResponse)
def update_user_admin(
    user_id: str,
    payload: UpdateUserAdminPayload,
    _: Annotated[AppUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_admin = payload.is_admin
    db.add(user)
    db.commit()
    db.refresh(user)

    return UpdateUserAdminResponse(user=user)
