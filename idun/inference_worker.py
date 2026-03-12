"""IDUN inference worker — connects to Coolify backend via WebSocket.

Runs on an IDUN Slurm compute node. Receives JPEG frames from the
Coolify backend, runs RT-DETR + ByteTrack inference on the GPU, and
sends detection results back over the same WebSocket connection.

Usage:
    export COOLIFY_WS_URL=wss://api.demo.bridgable.ai/api/idun/ws
    export IDUN_API_KEY=your-shared-secret
    python inference_worker.py [--model best.pt]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import struct
import time

import cv2
import numpy as np
import websockets

from detectors import RTDETRDetector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("idun_worker")

COOLIFY_WS_URL = os.environ.get("COOLIFY_WS_URL", "")
IDUN_API_KEY = os.environ.get("IDUN_API_KEY", "")
HEARTBEAT_INTERVAL_S = 30.0
RECONNECT_BASE_S = 1.0
RECONNECT_MAX_S = 30.0
STATUS_LOG_INTERVAL_S = 30.0

shutdown_event = asyncio.Event()


def handle_signal(sig: int, _frame: object) -> None:
    logger.info("Received signal %d, shutting down gracefully", sig)
    shutdown_event.set()


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


async def run_worker(detector: RTDETRDetector) -> None:
    """Main loop: connect, process frames, reconnect on failure."""
    if not COOLIFY_WS_URL:
        logger.error("COOLIFY_WS_URL not set")
        return
    if not IDUN_API_KEY:
        logger.error("IDUN_API_KEY not set")
        return

    backoff = RECONNECT_BASE_S

    while not shutdown_event.is_set():
        try:
            logger.info("Connecting to %s", COOLIFY_WS_URL)
            async with websockets.connect(
                COOLIFY_WS_URL,
                additional_headers={"Authorization": f"Bearer {IDUN_API_KEY}"},
                max_size=10 * 1024 * 1024,  # 10 MB max message
                ping_interval=20,
                ping_timeout=30,
            ) as ws:
                logger.info("Connected, sending ready")
                await ws.send(json.dumps({"type": "ready"}))
                backoff = RECONNECT_BASE_S

                heartbeat_task = asyncio.create_task(
                    _heartbeat_loop(ws)
                )
                try:
                    await _process_loop(ws, detector)
                finally:
                    heartbeat_task.cancel()
                    try:
                        await heartbeat_task
                    except asyncio.CancelledError:
                        pass

        except (
            websockets.ConnectionClosed,
            ConnectionError,
            OSError,
            asyncio.TimeoutError,
        ) as exc:
            if shutdown_event.is_set():
                break
            logger.warning("Connection lost: %s. Reconnecting in %.1fs", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX_S)

    logger.info("Worker shutdown complete")


async def _heartbeat_loop(ws: websockets.WebSocketClientProtocol) -> None:
    """Send periodic heartbeats to keep the connection alive."""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_S)
        try:
            await ws.send(json.dumps({"type": "heartbeat"}))
        except websockets.ConnectionClosed:
            break


async def _process_loop(
    ws: websockets.WebSocketClientProtocol,
    detector: RTDETRDetector,
) -> None:
    """Receive frames and control messages, send back detections."""
    is_paused = True
    inference_count = 0
    total_detections_sent = 0
    last_inference_time = time.monotonic()
    last_status_log = time.monotonic()
    current_stream_id = ""

    async for message in ws:
        if shutdown_event.is_set():
            break

        # Binary message = frame data
        if isinstance(message, bytes):
            if is_paused:
                continue

            # Parse binary frame: [4-byte header len][json header][jpeg data]
            if len(message) < 4:
                continue
            header_len = struct.unpack(">I", message[:4])[0]
            if len(message) < 4 + header_len:
                continue

            header = json.loads(message[4 : 4 + header_len])
            jpeg_data = message[4 + header_len :]

            # Decode JPEG
            frame = cv2.imdecode(
                np.frombuffer(jpeg_data, np.uint8), cv2.IMREAD_COLOR
            )
            if frame is None:
                logger.warning("Failed to decode JPEG frame %d", header.get("frame_index", -1))
                continue

            # Run inference
            detections = detector.detect(frame, track=True)

            # Calculate inference FPS
            now = time.monotonic()
            elapsed = now - last_inference_time
            inf_fps = 1.0 / elapsed if elapsed > 0 else 0.0
            last_inference_time = now
            inference_count += 1

            if inference_count == 1:
                logger.info(
                    "First frame processed (idx=%d, %dx%d)",
                    header.get("frame_index", -1),
                    frame.shape[1],
                    frame.shape[0],
                )

            total_detections_sent += len(detections)

            # Periodic status log
            now_status = time.monotonic()
            if now_status - last_status_log >= STATUS_LOG_INTERVAL_S:
                logger.info(
                    "Status: stream='%s' frames=%d detections_sent=%d inference_fps=%.1f paused=%s",
                    current_stream_id, inference_count, total_detections_sent, inf_fps, is_paused,
                )
                last_status_log = now_status

            # Build response (same format as InferenceThread payload)
            vessels = [
                {
                    "detection": d.model_dump(),
                    "vessel": None,
                }
                for d in detections
            ]

            response = json.dumps({
                "type": "detections",
                "stream_id": header.get("stream_id", ""),
                "frame_index": header.get("frame_index", 0),
                "timestamp_ms": header.get("timestamp_ms", 0.0),
                "fps": header.get("fps", 0.0),
                "inference_fps": round(inf_fps, 1),
                "vessels": vessels,
            })
            await ws.send(response)
            continue

        # Text message = control
        msg = json.loads(message)
        msg_type = msg.get("type")

        if msg_type == "pause":
            if not is_paused:
                logger.info("Paused (no active viewers)")
                is_paused = True

        elif msg_type == "resume":
            stream_id = msg.get("stream_id", "")
            logger.info("Resumed for stream '%s'", stream_id)
            is_paused = False
            current_stream_id = stream_id
            inference_count = 0

        elif msg_type == "stream_changed":
            stream_id = msg.get("stream_id", "")
            logger.info(
                "Stream changed to '%s' (%dx%d @ %.1f FPS)",
                stream_id,
                msg.get("width", 0),
                msg.get("height", 0),
                msg.get("fps", 0.0),
            )
            detector.reset_tracker()
            current_stream_id = stream_id
            inference_count = 0

        elif msg_type == "ping":
            await ws.send(json.dumps({"type": "pong"}))
            logger.info("Ping received, pong sent")

        else:
            logger.debug("Unknown message type: %s", msg_type)


def main() -> None:
    parser = argparse.ArgumentParser(description="IDUN inference worker")
    parser.add_argument("--model", default="best.pt", help="Path to RT-DETR model weights")
    args = parser.parse_args()

    logger.info("Loading model: %s", args.model)
    detector = RTDETRDetector(model_path=args.model)
    logger.info("Model loaded, starting worker")

    asyncio.run(run_worker(detector))


if __name__ == "__main__":
    main()
