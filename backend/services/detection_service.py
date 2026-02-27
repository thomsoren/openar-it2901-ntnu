from __future__ import annotations

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect


async def safe_ws_send_json(websocket: WebSocket, payload: dict) -> bool:
    try:
        await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False


async def safe_ws_send_text(websocket: WebSocket, payload: str) -> bool:
    try:
        await websocket.send_text(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False
