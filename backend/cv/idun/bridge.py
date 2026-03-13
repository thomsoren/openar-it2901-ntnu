"""IDUN bridge — sends frames to remote IDUN worker, receives detections.

This module is self-contained. It reads frames from the orchestrator's
DecodeThreads, JPEG-encodes them, sends them over WebSocket to the IDUN
inference worker, and publishes received detections to Redis via
DetectionPublisher (same channel and format as local InferenceThread).

Supports multiple concurrent streams — frames from all active streams
are sent to the worker which batches them for a single GPU forward pass.
"""
from __future__ import annotations

import asyncio
import json
import logging
import struct

import cv2
from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from cv.idun.config import (
    IDUN_FRAME_JPEG_QUALITY,
    IDUN_HEARTBEAT_TIMEOUT_S,
    IDUN_TARGET_SEND_FPS,
)
from cv.idun.noop_inference import NoopInferenceThread
from cv.performance import now_epoch_ms
from cv.publisher import DetectionPublisher
from cv.utils import build_ready_payload

logger = logging.getLogger(__name__)

JPEG_ENCODE_PARAMS = [cv2.IMWRITE_JPEG_QUALITY, IDUN_FRAME_JPEG_QUALITY]


_PENDING_METRICS_MAX_AGE_S = 20.0
_PENDING_METRICS_MAX_PER_STREAM = 300


class IdunBridge:
    """Bridges the orchestrator's decode threads to a remote IDUN worker.

    The bridge does not modify the orchestrator. It reads active streams
    from the NoopInferenceThread (set by the orchestrator's acquire/release
    viewer logic) and grabs frames from the corresponding DecodeThreads.
    """

    def __init__(
        self,
        noop_inference: NoopInferenceThread,
        publisher: DetectionPublisher,
    ) -> None:
        self._noop = noop_inference
        self._publisher = publisher
        self.is_connected = False
        self._pending_frame_metrics: dict[tuple[str, int], dict[str, float]] = {}
        self._last_eviction_ms: float = 0.0

    def _pop_pending_metrics(self, stream_id: str, frame_index: int) -> dict[str, float] | None:
        return self._pending_frame_metrics.pop((stream_id, frame_index), None)

    def _clear_pending_metrics_for_stream(self, stream_id: str) -> None:
        stale_keys = [key for key in self._pending_frame_metrics if key[0] == stream_id]
        for key in stale_keys:
            self._pending_frame_metrics.pop(key, None)

    def _clear_all_pending_metrics(self) -> None:
        self._pending_frame_metrics.clear()

    def _evict_stale_pending_metrics(self) -> None:
        """Remove entries older than _PENDING_METRICS_MAX_AGE_S. Runs at most once per second."""
        now = now_epoch_ms()
        if now - self._last_eviction_ms < 1000.0:
            return
        self._last_eviction_ms = now

        max_age_ms = _PENDING_METRICS_MAX_AGE_S * 1000.0
        stale_keys = [
            key for key, metrics in self._pending_frame_metrics.items()
            if now - metrics.get("decoded_at_ms", 0.0) > max_age_ms
        ]
        if stale_keys:
            for key in stale_keys:
                self._pending_frame_metrics.pop(key, None)
            logger.debug(
                "IDUN bridge: evicted %d stale pending metrics entries", len(stale_keys),
            )

        if len(self._pending_frame_metrics) > _PENDING_METRICS_MAX_PER_STREAM * 10:
            oldest_keys = sorted(
                self._pending_frame_metrics,
                key=lambda k: self._pending_frame_metrics[k].get("decoded_at_ms", 0.0),
            )
            to_remove = oldest_keys[: len(oldest_keys) - _PENDING_METRICS_MAX_PER_STREAM * 5]
            for key in to_remove:
                self._pending_frame_metrics.pop(key, None)
            logger.warning(
                "IDUN bridge: cap-evicted %d pending metrics entries (total was %d)",
                len(to_remove),
                len(oldest_keys),
            )

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
            self._clear_all_pending_metrics()
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
        """Send frames from all active streams to IDUN at the target FPS."""
        interval = 1.0 / IDUN_TARGET_SEND_FPS
        loop = asyncio.get_running_loop()
        known_streams: set[str] = set()
        prev_frame_idx: dict[str, int] = {}
        is_paused = True
        ready_sent: set[str] = set()

        while True:
            active_ids = self._noop.get_active_streams()

            # No active streams: pause
            if not active_ids:
                if not is_paused:
                    await websocket.send_text(json.dumps({"type": "pause"}))
                    is_paused = True
                    known_streams.clear()
                    logger.debug("IDUN bridge: sent pause (no viewers)")
                await asyncio.sleep(1.0)
                continue

            # Detect added/removed streams
            added = active_ids - known_streams
            removed = known_streams - active_ids

            for stream_id in removed:
                await websocket.send_text(json.dumps({
                    "type": "stream_removed",
                    "stream_id": stream_id,
                }))
                prev_frame_idx.pop(stream_id, None)
                ready_sent.discard(stream_id)
                self._clear_pending_metrics_for_stream(stream_id)
                logger.info("IDUN bridge: stream removed '%s'", stream_id)

            for stream_id in added:
                decode_thread = self._noop.get_decode_thread(stream_id)
                stream_info = {
                    "type": "stream_added",
                    "stream_id": stream_id,
                    "width": decode_thread.width if decode_thread else 0,
                    "height": decode_thread.height if decode_thread else 0,
                    "fps": decode_thread.fps if decode_thread else 0.0,
                }
                await websocket.send_text(json.dumps(stream_info))
                prev_frame_idx[stream_id] = -1
                ready_sent.discard(stream_id)
                logger.info("IDUN bridge: stream added '%s'", stream_id)

            known_streams = set(active_ids)

            # Resume if we were paused
            if is_paused:
                await websocket.send_text(json.dumps({
                    "type": "resume",
                    "stream_ids": list(active_ids),
                }))
                is_paused = False
                logger.debug("IDUN bridge: sent resume for %s", list(active_ids))

            # Send frames from all active streams
            sent_any = False
            for stream_id in active_ids:
                decode_thread = self._noop.get_decode_thread(stream_id)
                if decode_thread is None:
                    continue

                # Send ready payload to Redis on first frame of a stream
                if stream_id not in ready_sent and decode_thread.is_alive:
                    self._publisher.publish(
                        stream_id,
                        build_ready_payload(decode_thread.width, decode_thread.height, decode_thread.fps),
                    )
                    ready_sent.add(stream_id)

                # Grab latest frame
                latest = decode_thread.get_latest_telemetry()
                frame, frame_idx, ts = latest.frame, latest.frame_index, latest.timestamp_ms
                if frame is None or frame_idx == prev_frame_idx.get(stream_id, -1):
                    continue
                prev_frame_idx[stream_id] = frame_idx
                self._pending_frame_metrics[(stream_id, frame_idx)] = {
                    "decoded_at_ms": latest.decoded_at_ms,
                    "source_fps": decode_thread.fps or 0.0,
                }
                self._evict_stale_pending_metrics()

                # JPEG encode (CPU-bound — run in thread pool)
                ok, jpeg_buf = await loop.run_in_executor(
                    None, cv2.imencode, ".jpg", frame, JPEG_ENCODE_PARAMS,
                )
                if not ok:
                    self._pop_pending_metrics(stream_id, frame_idx)
                    logger.warning("IDUN bridge: JPEG encode failed for stream '%s' frame %d", stream_id, frame_idx)
                    continue

                # Build binary message: [header_len(4 bytes)][json header][jpeg data]
                header = json.dumps({
                    "type": "frame",
                    "stream_id": stream_id,
                    "frame_index": frame_idx,
                    "timestamp_ms": ts,
                    "fps": decode_thread.fps or 0.0,
                    "decoded_at_ms": latest.decoded_at_ms,
                }).encode()
                jpeg_bytes: bytes = jpeg_buf.tobytes()
                message = struct.pack(">I", len(header)) + header + jpeg_bytes
                await websocket.send_bytes(message)
                sent_any = True

            if not sent_any:
                await asyncio.sleep(0.005)
            else:
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

                # Discard detections for a stream that is no longer active
                active_ids = self._noop.get_active_streams()
                if stream_id not in active_ids:
                    self._pop_pending_metrics(stream_id, int(msg.get("frame_index", -1)))
                    continue

                published_at_ms = now_epoch_ms()
                msg["frame_sent_at_ms"] = published_at_ms
                frame_index = int(msg.get("frame_index", -1))
                pending = self._pop_pending_metrics(stream_id, frame_index)
                if pending is not None:
                    decoded_at_ms = pending["decoded_at_ms"]
                    source_fps = pending["source_fps"]
                    performance = msg.get("performance", {})
                    performance.update({
                        "source_fps": round(source_fps, 2),
                        "decoded_at_ms": round(decoded_at_ms, 3),
                        "published_at_ms": round(published_at_ms, 3),
                        "total_detection_latency_ms": round(max(0.0, published_at_ms - decoded_at_ms), 3),
                    })
                    msg["performance"] = performance
                self._publisher.publish(stream_id, msg)

            elif msg_type == "error":
                logger.error("IDUN worker error: %s", msg.get("message", "unknown"))
            else:
                logger.debug("IDUN bridge: unknown message type '%s'", msg_type)
