from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, WebSocket, status
from redis.exceptions import RedisError
from starlette.websockets import WebSocketDisconnect

from auth.deps import extract_token_from_websocket
from auth.security import decode_access_token
from db.database import SessionLocal
from db.models import AppUser
from webapi import state
from settings import app_settings
from common.config import detections_channel
from orchestrator import ResourceLimitExceededError, StreamNotFoundError
from webapi.constants import SYSTEM_STREAM_IDS

logger = logging.getLogger(__name__)
router = APIRouter()


def _valid_stream_id(stream_id: str) -> bool:
    return bool(app_settings.stream_id_pattern.fullmatch(stream_id))


def _try_authenticate_websocket(websocket: WebSocket) -> AppUser | None:
    token = extract_token_from_websocket(websocket)
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except HTTPException:
        return None
    with SessionLocal() as db:
        return db.get(AppUser, str(payload["sub"]))


async def _safe_ws_send_json(websocket: WebSocket, payload: dict) -> bool:
    try:
        await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


async def _safe_ws_send_text(websocket: WebSocket, payload: str) -> bool:
    try:
        await websocket.send_text(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


@router.websocket("/api/detections/ws/{stream_id}")
async def websocket_detections(websocket: WebSocket, stream_id: str):
    if not _valid_stream_id(stream_id):
        await websocket.close(code=1008, reason="invalid_stream_id")
        return

    user = _try_authenticate_websocket(websocket)

    if user is None and stream_id not in SYSTEM_STREAM_IDS:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if not state.orchestrator:
        await websocket.close(code=1011, reason="Orchestrator unavailable")
        return

    if user and not user.is_admin and stream_id not in SYSTEM_STREAM_IDS and not state.orchestrator.is_stream_owner(stream_id, user.id):
        await websocket.close(code=1008, reason="Access denied")
        return

    await websocket.accept()

    viewer_attached = False
    try:
        state.orchestrator.acquire_stream_viewer(stream_id)
        viewer_attached = True
    except StreamNotFoundError:
        await _safe_ws_send_json(websocket, {"type": "error", "message": f"Stream '{stream_id}' not found"})
        await websocket.close(code=1008)
        return
    except ResourceLimitExceededError as exc:
        await _safe_ws_send_json(websocket, {"type": "error", "message": str(exc)})
        await websocket.close(code=1013)
        return

    channel = detections_channel(stream_id)
    redis_client = websocket.app.state.redis_client
    pubsub = redis_client.pubsub()

    try:
        await pubsub.subscribe(channel)
    except RedisError as exc:
        logger.warning("Redis subscribe failed for channel '%s': %s", channel, exc)
        try:
            await _safe_ws_send_json(
                websocket,
                {"type": "error", "message": f"Detection stream unavailable: {type(exc).__name__}"},
            )
        finally:
            await websocket.close(code=1011)
        return

    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            payload = message.get("data")
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8")
            if not await _safe_ws_send_text(websocket, payload):
                break
    except WebSocketDisconnect:
        logger.debug("WebSocket disconnected for channel '%s'", channel)
    except RuntimeError:
        logger.debug("WebSocket runtime error for channel '%s'", channel)
    except Exception as exc:
        logger.exception("Detections websocket stream failed for channel '%s': %s", channel, exc)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception as exc:
            logger.exception("Failed to clean up pubsub for channel '%s': %s", channel, exc)
        if viewer_attached and state.orchestrator:
            state.orchestrator.release_stream_viewer(stream_id)


@router.websocket("/api/detections/ws")
async def websocket_detections_default(websocket: WebSocket):
    await websocket_detections(websocket, app_settings.default_stream_id)
