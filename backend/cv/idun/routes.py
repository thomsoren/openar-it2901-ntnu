"""IDUN WebSocket endpoint — self-contained FastAPI router.

Conditionally included in the main app only when IDUN_ENABLED=true.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket

from cv.idun.bridge import IdunBridge
from cv.idun.config import IDUN_API_KEY

logger = logging.getLogger(__name__)

router = APIRouter()

# Singleton bridge instance, set during app startup via ``init_bridge()``.
_bridge: IdunBridge | None = None


def init_bridge(bridge: IdunBridge) -> None:
    """Register the bridge instance (called from app lifespan)."""
    global _bridge
    _bridge = bridge


@router.websocket("/api/idun/ws")
async def websocket_idun_worker(websocket: WebSocket) -> None:
    """WebSocket endpoint that IDUN inference workers connect to.

    Authentication is via a shared API key in the Authorization header.
    Only one worker connection is accepted at a time.
    """
    if _bridge is None:
        await websocket.close(code=1011, reason="IDUN bridge not initialized")
        return

    # Authenticate
    auth_header = websocket.headers.get("authorization", "")
    _, _, token = auth_header.partition(" ")
    if not token or token.strip() != IDUN_API_KEY:
        await websocket.close(code=1008, reason="Invalid API key")
        logger.warning("IDUN worker rejected: invalid API key")
        return

    await websocket.accept()
    await _bridge.handle_worker_connection(websocket)
