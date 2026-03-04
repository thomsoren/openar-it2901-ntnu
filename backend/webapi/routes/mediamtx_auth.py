from __future__ import annotations

import ipaddress
import logging
import time
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from auth.security import decode_access_token
from common.config.mediamtx import MEDIAMTX_PUBLISH_PASS, MEDIAMTX_PUBLISH_USER
from db.database import SessionLocal
from db.models import AppUser
from settings._env import get_bool, get_str

logger = logging.getLogger(__name__)
router = APIRouter()

_ALLOW_LOCAL_PUBLISH_WITHOUT_CREDENTIALS = get_bool(
    "MEDIAMTX_ALLOW_LOCAL_PUBLISH_WITHOUT_CREDENTIALS", default=False
)
_ALLOW_LOCAL_READ_WITHOUT_TOKEN = get_bool(
    "MEDIAMTX_ALLOW_LOCAL_READ_WITHOUT_TOKEN", default=True
)
_PUBLIC_READ_STREAM_IDS = {
    value.strip().lower()
    for value in get_str("MEDIAMTX_PUBLIC_READ_STREAM_IDS", "fusion").split(",")
    if value.strip()
}

_READ_ACTIONS = {"read", "playback"}
_PUBLISH_ACTIONS = {"publish"}
_READER_ID_TTL_SECONDS = 600.0
_AUTHORIZED_READER_IDS: dict[str, float] = {}
_AUTHORIZED_READ_CONTEXTS: dict[tuple[str, str, str], float] = {}


class MediaMTXAuthRequest(BaseModel):
    user: str = ""
    password: str = ""
    token: str = ""
    ip: str = ""
    action: str = ""
    path: str = ""
    protocol: str = ""
    id: str = ""
    query: str = ""


def _strip_bearer(value: str) -> str:
    token = (value or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


def _is_local_or_private_ip(raw_ip: str) -> bool:
    text = (raw_ip or "").strip()
    if not text:
        return False
    # Strip [] used by IPv6 and optional :port for IPv4.
    if text.startswith("[") and "]" in text:
        text = text[1:text.find("]")]
    elif ":" in text and text.count(":") == 1:
        host, _, maybe_port = text.partition(":")
        if maybe_port.isdigit():
            text = host
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def _extract_token(payload: MediaMTXAuthRequest) -> str:
    direct = _strip_bearer(payload.token)
    if direct:
        return direct

    # Support token passed as query parameter.
    query = (payload.query or "").strip()
    if query:
        if query.startswith("?"):
            query = query[1:]
        params = parse_qs(query, keep_blank_values=False)
        for key in ("access_token", "token", "jwt", "bearer"):
            candidate = _strip_bearer(params.get(key, [""])[0])
            if candidate:
                return candidate

    # Fallback: some clients can only place token in "password".
    pw = _strip_bearer(payload.password)
    if pw and payload.action in _READ_ACTIONS:
        return pw

    return ""


async def _read_payload(request: Request) -> MediaMTXAuthRequest:
    raw: dict[str, object] = {}

    try:
        body = await request.json()
        if isinstance(body, dict):
            raw.update(body)
    except Exception:
        pass

    if not raw:
        try:
            form_data = await request.form()
            raw.update({k: v for k, v in form_data.items()})
        except Exception:
            pass

    # Last-resort fallback: accept values from query params too.
    for key, value in request.query_params.items():
        raw.setdefault(key, value)

    # MediaMTX can send publisher password as "pass" in some callbacks.
    if "password" not in raw and "pass" in raw:
        raw["password"] = raw.get("pass")

    normalized = {k: (str(v) if v is not None else "") for k, v in raw.items()}
    return MediaMTXAuthRequest.model_validate(normalized)


def _validate_jwt_subject(token: str) -> str:
    claims = decode_access_token(token)
    subject = str(claims.get("sub", "")).strip()
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token")
    return subject


def _user_exists(user_id: str) -> bool:
    with SessionLocal() as db:
        user = db.get(AppUser, user_id)
        return user is not None


def _authorize_publish(payload: MediaMTXAuthRequest) -> bool:
    user = (payload.user or "").strip()
    password = (payload.password or "").strip()

    # Preferred: explicit publisher credentials.
    if MEDIAMTX_PUBLISH_USER or MEDIAMTX_PUBLISH_PASS:
        return user == MEDIAMTX_PUBLISH_USER and password == MEDIAMTX_PUBLISH_PASS

    # Dev fallback: when no explicit publish credentials are configured,
    # allow publisher callback. This keeps local backend->MediaMTX publish
    # working even if callback IP metadata is unavailable.
    if _ALLOW_LOCAL_PUBLISH_WITHOUT_CREDENTIALS:
        return True

    return False


def _purge_expired_auth_cache(now: float) -> None:
    for cache in (_AUTHORIZED_READER_IDS, _AUTHORIZED_READ_CONTEXTS):
        expired = [key for key, expiry in cache.items() if expiry <= now]
        for key in expired:
            cache.pop(key, None)


def _remember_authorized(cache: dict, key: object) -> None:
    if not key:
        return
    now = time.monotonic()
    cache[key] = now + _READER_ID_TTL_SECONDS
    _purge_expired_auth_cache(now)


def _is_authorized(cache: dict, key: object) -> bool:
    if not key:
        return False
    now = time.monotonic()
    expiry = cache.get(key)
    if expiry is None:
        return False
    if expiry <= now:
        cache.pop(key, None)
        return False
    return True


def _context_key(payload: MediaMTXAuthRequest) -> tuple[str, str, str]:
    ip = (payload.ip or "").strip()
    path = (payload.path or "").strip().lstrip("/")
    # Normalize to stream-level path so HLS playlist/segment requests share auth context.
    stream_path = path.split("/", 1)[0] if path else ""
    protocol = (payload.protocol or "").strip().lower()
    return (ip, stream_path, protocol)


def _stream_root(path: str) -> str:
    value = (path or "").strip().lstrip("/")
    if not value:
        return ""
    return value.split("/", 1)[0].lower()


def _is_public_read_stream(path: str) -> bool:
    root = _stream_root(path)
    return bool(root) and root in _PUBLIC_READ_STREAM_IDS


def _remember_read_context(payload: MediaMTXAuthRequest) -> None:
    key = _context_key(payload)
    if not any(key):
        return
    _remember_authorized(_AUTHORIZED_READ_CONTEXTS, key)


def _is_context_authorized(payload: MediaMTXAuthRequest) -> bool:
    key = _context_key(payload)
    if not any(key):
        return False
    return _is_authorized(_AUTHORIZED_READ_CONTEXTS, key)


def _allow_read(reader_id: str, payload: MediaMTXAuthRequest) -> Response:
    _remember_authorized(_AUTHORIZED_READER_IDS, reader_id)
    _remember_read_context(payload)
    return Response(status_code=204)


@router.post("/api/mediamtx/auth", status_code=204, response_class=Response)
async def mediamtx_auth(request: Request) -> Response:
    payload = await _read_payload(request)
    action = (payload.action or "").strip().lower()

    if action in _PUBLISH_ACTIONS:
        if _authorize_publish(payload):
            return Response(status_code=204)
        logger.warning(
            "Denied MediaMTX publish auth: user='%s' ip='%s' protocol='%s' path='%s'",
            payload.user,
            payload.ip,
            payload.protocol,
            payload.path,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Publish not authorized")

    if action in _READ_ACTIONS:
        reader_id = (payload.id or "").strip()
        if _is_authorized(_AUTHORIZED_READER_IDS, reader_id):
            return Response(status_code=204)
        if _is_context_authorized(payload):
            return Response(status_code=204)
        if _is_public_read_stream(payload.path):
            return _allow_read(reader_id, payload)

        token = _extract_token(payload)
        if not token:
            if _ALLOW_LOCAL_READ_WITHOUT_TOKEN and _is_local_or_private_ip(payload.ip):
                logger.info(
                    "Allowed MediaMTX read auth without token from local/private IP '%s' (protocol='%s' path='%s')",
                    payload.ip,
                    payload.protocol,
                    payload.path,
                )
                return _allow_read(reader_id, payload)
            logger.warning(
                "Denied MediaMTX read auth: missing token (protocol='%s' path='%s' id='%s' ip='%s' query='%s' user='%s')",
                payload.protocol,
                payload.path,
                payload.id,
                payload.ip,
                payload.query,
                payload.user,
            )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing read token")
        try:
            user_id = _validate_jwt_subject(token)
        except HTTPException:
            logger.warning(
                "Denied MediaMTX read auth: invalid token (protocol='%s' path='%s' id='%s' ip='%s' query='%s' user='%s' token_len=%d)",
                payload.protocol,
                payload.path,
                payload.id,
                payload.ip,
                payload.query,
                payload.user,
                len(token),
            )
            raise
        if not _user_exists(user_id):
            logger.warning(
                "Denied MediaMTX read auth: unknown user='%s' (protocol='%s' path='%s' id='%s' ip='%s')",
                user_id,
                payload.protocol,
                payload.path,
                payload.id,
                payload.ip,
            )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
        return _allow_read(reader_id, payload)

    # Only publish/read/playback are expected for stream transport.
    logger.warning(
        "Denied unsupported MediaMTX auth action='%s' protocol='%s' path='%s'",
        payload.action,
        payload.protocol,
        payload.path,
    )
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Action not allowed")
