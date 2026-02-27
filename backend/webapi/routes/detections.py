from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket
from redis.exceptions import RedisError
from starlette.websockets import WebSocketDisconnect

from webapi import state
from common.config import detections_channel
from orchestrator import ResourceLimitExceededError, StreamNotFoundError
from services.detection_service import safe_ws_send_json, safe_ws_send_text

logger = logging.getLogger(__name__)
router = APIRouter()


def _valid_stream_id(stream_id: str) -> bool:
    return bool(state.STREAM_ID_PATTERN.fullmatch(stream_id))


@router.websocket("/api/detections/ws/{stream_id}")
async def websocket_detections(websocket: WebSocket, stream_id: str):
    if not _valid_stream_id(stream_id):
        await websocket.close(code=1008, reason="invalid_stream_id")
        return

    await websocket.accept()

    if not state.orchestrator:
        await safe_ws_send_json(websocket, {"type": "error", "message": "Orchestrator unavailable"})
        await websocket.close(code=1011)
        return

    viewer_attached = False
    try:
        state.orchestrator.acquire_stream_viewer(stream_id)
        viewer_attached = True
    except StreamNotFoundError:
        await safe_ws_send_json(websocket, {"type": "error", "message": f"Stream '{stream_id}' not found"})
        await websocket.close(code=1008)
        return
    except ResourceLimitExceededError as exc:
        await safe_ws_send_json(websocket, {"type": "error", "message": str(exc)})
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
            await safe_ws_send_json(
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
            if not await safe_ws_send_text(websocket, payload):
                break
    except WebSocketDisconnect:
        logger.debug("WebSocket disconnected for channel '%s'", channel)
    except RuntimeError:
        logger.debug("WebSocket runtime error for channel '%s'", channel)
    except Exception:
        logger.exception("Detections websocket stream failed for channel '%s'", channel)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception:
            logger.exception("Failed to clean up pubsub for channel '%s'", channel)
        if viewer_attached and state.orchestrator:
            state.orchestrator.release_stream_viewer(stream_id)


@router.websocket("/api/detections/ws")
async def websocket_detections_default(websocket: WebSocket):
    await websocket_detections(websocket, state.DEFAULT_STREAM_ID)
