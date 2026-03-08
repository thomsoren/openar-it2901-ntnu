"""IDUN bridge — sends frames to remote IDUN worker, receives detections.

This module is self-contained. It reads frames from the orchestrator's
DecodeThreads, JPEG-encodes them, sends them over WebSocket to the IDUN
inference worker, and publishes received detections to Redis via
DetectionPublisher (same channel and format as local InferenceThread).
"""
from __future__ import annotations

import asyncio
import json
import logging
import struct
import time

import cv2
from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from cv.idun.config import (
    IDUN_FRAME_JPEG_QUALITY,
    IDUN_HEARTBEAT_TIMEOUT_S,
    IDUN_TARGET_SEND_FPS,
)
from cv.idun.noop_inference import NoopInferenceThread
from cv.publisher import DetectionPublisher
from cv.utils import build_ready_payload

logger = logging.getLogger(__name__)

JPEG_ENCODE_PARAMS = [cv2.IMWRITE_JPEG_QUALITY, IDUN_FRAME_JPEG_QUALITY]


class IdunBridge:
    """Bridges the orchestrator's decode threads to a remote IDUN worker.

    The bridge does not modify the orchestrator. It reads the active stream
    from the NoopInferenceThread (set by the orchestrator's acquire/release
    viewer logic) and grabs frames from the corresponding DecodeThread.
    """

    def __init__(
        self,
        noop_inference: NoopInferenceThread,
        publisher: DetectionPublisher,
    ) -> None:
        self._noop = noop_inference
        self._publisher = publisher
        self.is_connected = False

    async def handle_worker_connection(self, websocket: WebSocket) -> None:
        """Main handler for an IDUN worker WebSocket connection.

        Called by the route handler after authentication. Runs two concurrent
        tasks: one sends frames, the other receives detections.
        """
        if self.is_connected:
            await websocket.close(code=1013, reason="Another IDUN worker is already connected")
            return

        self.is_connected = True
        logger.info("IDUN worker connected")

        sender_task: asyncio.Task | None = None
        try:
            # Wait for the "ready" message from IDUN
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            msg = json.loads(raw)
            if msg.get("type") != "ready":
                logger.warning("IDUN worker sent unexpected first message: %s", msg.get("type"))
                await websocket.close(code=1008, reason="Expected 'ready' message")
                return
            logger.info("IDUN worker ready")

            sender_task = asyncio.create_task(self._sender_loop(websocket))
            await self._receiver_loop(websocket)
        except WebSocketDisconnect:
            logger.info("IDUN worker disconnected")
        except asyncio.TimeoutError:
            logger.warning("IDUN worker did not send 'ready' within 30s")
        except Exception as exc:
            logger.error("IDUN bridge error: %s", exc)
        finally:
            self.is_connected = False
            if sender_task and not sender_task.done():
                sender_task.cancel()
                try:
                    await sender_task
                except asyncio.CancelledError:
                    pass
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()
            logger.info("IDUN bridge connection closed")

    async def _sender_loop(self, websocket: WebSocket) -> None:
        """Send frames to IDUN at the target FPS."""
        interval = 1.0 / IDUN_TARGET_SEND_FPS
        prev_stream_id: str | None = None
        prev_frame_idx = -1
        is_paused = True
        ready_sent: set[str] = set()

        while True:
            active_id = self._noop.get_active_stream()

            # No active stream: pause
            if active_id is None:
                if not is_paused:
                    await websocket.send_text(json.dumps({"type": "pause"}))
                    is_paused = True
                    prev_stream_id = None
                    logger.debug("IDUN bridge: sent pause (no viewers)")
                await asyncio.sleep(1.0)
                continue

            decode_thread = self._noop.get_decode_thread(active_id)
            if decode_thread is None:
                await asyncio.sleep(0.1)
                continue

            # Stream changed: notify IDUN to reset tracker
            if active_id != prev_stream_id:
                stream_info = {
                    "type": "stream_changed",
                    "stream_id": active_id,
                    "width": decode_thread.width or 0,
                    "height": decode_thread.height or 0,
                    "fps": decode_thread.fps or 0.0,
                }
                await websocket.send_text(json.dumps(stream_info))
                prev_stream_id = active_id
                prev_frame_idx = -1
                ready_sent.discard(active_id)
                logger.info("IDUN bridge: stream changed to '%s'", active_id)

            # Resume if we were paused
            if is_paused:
                await websocket.send_text(json.dumps({
                    "type": "resume",
                    "stream_id": active_id,
                }))
                is_paused = False
                logger.debug("IDUN bridge: sent resume for '%s'", active_id)

            # Send ready payload to Redis on first frame of a stream
            if active_id not in ready_sent and decode_thread.is_alive:
                self._publisher.publish(
                    active_id,
                    build_ready_payload(decode_thread.width, decode_thread.height, decode_thread.fps),
                )
                ready_sent.add(active_id)

            # Grab latest frame
            frame, frame_idx, ts = decode_thread.get_latest()
            if frame is None or frame_idx == prev_frame_idx:
                await asyncio.sleep(0.005)
                continue
            prev_frame_idx = frame_idx

            # JPEG encode (CPU-bound — run in thread pool to avoid blocking the event loop)
            loop = asyncio.get_running_loop()
            ok, jpeg_buf = await loop.run_in_executor(
                None, cv2.imencode, ".jpg", frame, JPEG_ENCODE_PARAMS,
            )
            if not ok:
                logger.warning("IDUN bridge: JPEG encode failed for frame %d", frame_idx)
                await asyncio.sleep(interval)
                continue

            # Build binary message: [header_len(4 bytes)][json header][jpeg data]
            header = json.dumps({
                "type": "frame",
                "stream_id": active_id,
                "frame_index": frame_idx,
                "timestamp_ms": ts,
                "fps": decode_thread.fps or 0.0,
            }).encode()
            jpeg_bytes: bytes = jpeg_buf.tobytes()
            message = struct.pack(">I", len(header)) + header + jpeg_bytes
            await websocket.send_bytes(message)

            await asyncio.sleep(interval)

    async def _receiver_loop(self, websocket: WebSocket) -> None:
        """Receive detection results and heartbeats from IDUN."""
        while True:
            try:
                raw = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=IDUN_HEARTBEAT_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "IDUN worker heartbeat timeout (%.0fs)",
                    IDUN_HEARTBEAT_TIMEOUT_S,
                )
                break

            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "heartbeat":
                continue

            if msg_type == "detections":
                stream_id = msg.get("stream_id")
                if not stream_id:
                    continue

                # Discard detections for a stale stream
                active_id = self._noop.get_active_stream()
                if stream_id != active_id:
                    continue

                msg["frame_sent_at_ms"] = time.time() * 1000.0
                self._publisher.publish(stream_id, msg)

            elif msg_type == "error":
                logger.error("IDUN worker error: %s", msg.get("message", "unknown"))
            else:
                logger.debug("IDUN bridge: unknown message type '%s'", msg_type)
