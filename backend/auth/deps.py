from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, WebSocket, status
from sqlalchemy.orm import Session

from auth.security import decode_access_token
from db.database import SessionLocal, get_db
from db.models import AppUser


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None

    return token.strip()


def extract_token_from_request(request: Request) -> str | None:
    return _extract_bearer_token(request.headers.get("authorization"))


def extract_token_from_websocket(websocket: WebSocket) -> str | None:
    return _extract_bearer_token(websocket.headers.get("authorization")) or websocket.query_params.get(
        "access_token"
    )


def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> AppUser:
    token = extract_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    user_id = str(payload["sub"])
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def require_admin(
    current_user: Annotated[AppUser, Depends(get_current_user)],
) -> AppUser:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


async def authenticate_websocket(websocket: WebSocket) -> AppUser | None:
    token = extract_token_from_websocket(websocket)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    try:
        payload = decode_access_token(token)
    except HTTPException:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    with SessionLocal() as db:
        user = db.get(AppUser, str(payload["sub"]))

    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    return user
