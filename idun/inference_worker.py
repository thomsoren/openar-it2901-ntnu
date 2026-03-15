"""IDUN inference worker — connects to Coolify backend via WebSocket.

Runs on an IDUN Slurm compute node. Receives JPEG frames from the
Coolify backend, runs RT-DETR + ByteTrack inference on the GPU, and
sends detection results back over the same WebSocket connection.

Supports batched multi-stream inference: frames from multiple streams
are accumulated and processed in a single GPU forward pass, matching
the local InferenceThread's batching behavior.

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
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

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
IDUN_BATCH_API_BASE_URL = os.environ.get("IDUN_BATCH_API_BASE_URL", "")
IDUN_API_KEY = os.environ.get("IDUN_API_KEY", "")
HEARTBEAT_INTERVAL_S = 30.0
RECONNECT_BASE_S = 1.0
RECONNECT_MAX_S = 30.0
STATUS_LOG_INTERVAL_S = 30.0
JOB_POLL_INTERVAL_S = float(os.environ.get("IDUN_JOB_POLL_INTERVAL_S", "5.0"))

MAX_BATCH_SIZE = int(os.environ.get("IDUN_MAX_BATCH_SIZE", "10"))
BATCH_FILL_TIMEOUT_S = float(os.environ.get("IDUN_BATCH_FILL_TIMEOUT_S", "0.02"))

shutdown_event = asyncio.Event()


def handle_signal(sig: int, _frame: object) -> None:
    logger.info("Received signal %d, shutting down gracefully", sig)
    shutdown_event.set()


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def _derive_batch_api_base_url() -> str:
    if IDUN_BATCH_API_BASE_URL:
        return IDUN_BATCH_API_BASE_URL.rstrip("/")
    if not COOLIFY_WS_URL:
        return ""
    parsed = urllib.parse.urlparse(COOLIFY_WS_URL)
    if not parsed.scheme or not parsed.netloc:
        return ""
    scheme = "https" if parsed.scheme == "wss" else "http"
    return f"{scheme}://{parsed.netloc}"


def _http_json(method: str, url: str, payload: dict | None = None) -> dict | None:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {IDUN_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            body = response.read().decode("utf-8")
            if response.status == 204 or not body:
                return None
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body or exc.reason}") from exc


def _download_input_video(url: str) -> str:
    suffix = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(prefix="openar-idun-", suffix=suffix, delete=False)
    tmp.close()
    urllib.request.urlretrieve(url, tmp.name)
    return tmp.name


def _process_batch_job(detector: RTDETRDetector, api_base_url: str, job: dict) -> None:
    job_id = str(job["id"])
    input_url = str(job["input_url"])
    local_path = _download_input_video(input_url)
    detector.reset_tracker()
    _http_json("POST", f"{api_base_url}/api/idun/jobs/{job_id}/start", {})

    cap = cv2.VideoCapture(local_path)
    if not cap.isOpened():
        os.unlink(local_path)
        raise RuntimeError(f"Failed to open downloaded video for job {job_id}")

    fps_raw = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    fps = fps_raw if fps_raw > 0 else 25.0
    total_frames_raw = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0) or None
    video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0) or None
    frame_index = 0
    frames: dict[str, list[dict]] = {}

    try:
        while not shutdown_event.is_set():
            ret, frame = cap.read()
            if not ret:
                break

            detections = detector.detect(frame, track=True)
            if detections:
                frames[str(frame_index)] = [
                    {
                        "detection": detection.model_dump(),
                        "vessel": None,
                    }
                    for detection in detections
                ]
            frame_index += 1
    finally:
        cap.release()
        try:
            os.unlink(local_path)
        except OSError:
            pass

    _http_json(
        "PUT",
        f"{api_base_url}/api/idun/jobs/{job_id}/complete",
        {
            "fps": fps,
            "total_frames": total_frames_raw if total_frames_raw > 0 else frame_index,
            "video_width": video_width,
            "video_height": video_height,
            "frames": frames,
        },
    )


async def run_batch_worker(detector: RTDETRDetector) -> None:
    api_base_url = _derive_batch_api_base_url()
    if not api_base_url:
        logger.error("IDUN batch API base URL is not set")
        return
    if not IDUN_API_KEY:
        logger.error("IDUN_API_KEY not set")
        return

    logger.info("Starting batch worker against %s", api_base_url)

    while not shutdown_event.is_set():
        try:
            claimed = await asyncio.get_running_loop().run_in_executor(
                None,
                _http_json,
                "POST",
                f"{api_base_url}/api/idun/jobs/claim",
                {},
            )
            job = claimed.get("job") if claimed else None
            if not job:
                await asyncio.sleep(JOB_POLL_INTERVAL_S)
                continue

            logger.info("Claimed uploaded-video job %s", job.get("id"))
            try:
                await asyncio.get_running_loop().run_in_executor(
                    None,
                    _process_batch_job,
                    detector,
                    api_base_url,
                    job,
                )
                logger.info("Completed uploaded-video job %s", job.get("id"))
            except Exception as exc:
                logger.exception("Uploaded-video job %s failed: %s", job.get("id"), exc)
                await asyncio.get_running_loop().run_in_executor(
                    None,
                    _http_json,
                    "PUT",
                    f"{api_base_url}/api/idun/jobs/{job.get('id')}/fail",
                    {"error_message": str(exc)},
                )
        except Exception as exc:
            logger.warning("Batch worker loop failed: %s", exc)
            await asyncio.sleep(JOB_POLL_INTERVAL_S)


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
    """Receive frames and control messages, batch inference, send back detections.

    Two concurrent tasks:
    - _receive_task: reads WebSocket messages, decodes frames into a buffer,
      handles control messages (pause/resume/stream_added/stream_removed/ping)
    - _inference_task: periodically collects a batch from the buffer, runs
      batched predict + per-stream tracking, sends detection responses
    """
    state = _WorkerState(detector)

    receive = asyncio.create_task(_receive_task(ws, state))
    inference = asyncio.create_task(_inference_task(ws, state))

    done, pending = await asyncio.wait(
        [receive, inference],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    for task in done:
        if task.exception() is not None:
            raise task.exception()


class _WorkerState:
    """Shared mutable state between receive and inference tasks."""

    def __init__(self, detector: RTDETRDetector) -> None:
        self.detector = detector
        self.is_paused = True
        self.active_streams: set[str] = set()
        self.pending_frames: dict[str, tuple[dict, np.ndarray]] = {}
        self.frame_available = asyncio.Event()
        self.per_stream_inference_count: dict[str, int] = {}
        self.per_stream_last_inf_time: dict[str, float] = {}
        self.total_detections_sent = 0
        self.last_status_log = time.monotonic()


async def _receive_task(
    ws: websockets.WebSocketClientProtocol,
    state: _WorkerState,
) -> None:
    """Read messages from WebSocket, decode frames into buffer, handle control."""
    loop = asyncio.get_running_loop()

    async for message in ws:
        if shutdown_event.is_set():
            break

        if isinstance(message, bytes):
            if state.is_paused:
                continue

            if len(message) < 4:
                continue
            header_len = struct.unpack(">I", message[:4])[0]
            if len(message) < 4 + header_len:
                continue

            header = json.loads(message[4 : 4 + header_len])
            jpeg_data = message[4 + header_len :]
            stream_id = header.get("stream_id", "")

            if stream_id not in state.active_streams:
                continue

            frame = await loop.run_in_executor(
                None,
                lambda data=jpeg_data: cv2.imdecode(
                    np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR
                ),
            )
            if frame is None:
                logger.warning(
                    "Failed to decode JPEG frame %d for stream '%s'",
                    header.get("frame_index", -1),
                    stream_id,
                )
                continue

            state.pending_frames[stream_id] = (header, frame)
            state.frame_available.set()
            continue

        msg = json.loads(message)
        msg_type = msg.get("type")

        if msg_type == "pause":
            if not state.is_paused:
                logger.info("Paused (no active viewers)")
                state.is_paused = True

        elif msg_type == "resume":
            # Support both old single-stream and new multi-stream protocol
            stream_ids = msg.get("stream_ids")
            if stream_ids is not None:
                state.active_streams = set(stream_ids)
                logger.info("Resumed for streams: %s", stream_ids)
            else:
                stream_id = msg.get("stream_id", "")
                if stream_id:
                    state.active_streams.add(stream_id)
                logger.info("Resumed for stream '%s'", stream_id)
            state.is_paused = False

        elif msg_type == "stream_added":
            stream_id = msg.get("stream_id", "")
            logger.info(
                "Stream added: '%s' (%dx%d @ %.1f FPS)",
                stream_id,
                msg.get("width", 0),
                msg.get("height", 0),
                msg.get("fps", 0.0),
            )
            state.active_streams.add(stream_id)
            state.detector.reset_tracker_for_stream(stream_id)
            state.per_stream_inference_count[stream_id] = 0

        elif msg_type == "stream_removed":
            stream_id = msg.get("stream_id", "")
            logger.info("Stream removed: '%s'", stream_id)
            state.active_streams.discard(stream_id)
            state.pending_frames.pop(stream_id, None)
            state.detector.reset_tracker_for_stream(stream_id)
            state.per_stream_inference_count.pop(stream_id, None)
            state.per_stream_last_inf_time.pop(stream_id, None)

        elif msg_type == "stream_changed":
            # Backward compat: treat as remove-old + add-new
            stream_id = msg.get("stream_id", "")
            logger.info(
                "Stream changed to '%s' (%dx%d @ %.1f FPS)",
                stream_id,
                msg.get("width", 0),
                msg.get("height", 0),
                msg.get("fps", 0.0),
            )
            # Reset all trackers and set this as the only active stream
            for old_id in list(state.active_streams):
                state.detector.reset_tracker_for_stream(old_id)
            state.active_streams = {stream_id}
            state.pending_frames.clear()
            state.detector.reset_tracker_for_stream(stream_id)
            state.per_stream_inference_count = {stream_id: 0}

        elif msg_type == "ping":
            await ws.send(json.dumps({"type": "pong"}))
            logger.info("Ping received, pong sent")

        else:
            logger.debug("Unknown message type: %s", msg_type)


async def _inference_task(
    ws: websockets.WebSocketClientProtocol,
    state: _WorkerState,
) -> None:
    """Collect batches from the frame buffer and run batched inference."""
    loop = asyncio.get_running_loop()

    while not shutdown_event.is_set():
        # Wait until at least one frame is available
        try:
            await asyncio.wait_for(state.frame_available.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        state.frame_available.clear()

        if state.is_paused or not state.pending_frames:
            continue

        # Collect batch: wait up to BATCH_FILL_TIMEOUT_S for more frames
        deadline = time.monotonic() + BATCH_FILL_TIMEOUT_S
        while len(state.pending_frames) < min(MAX_BATCH_SIZE, len(state.active_streams)):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                await asyncio.wait_for(
                    state.frame_available.wait(),
                    timeout=remaining,
                )
                state.frame_available.clear()
            except asyncio.TimeoutError:
                break

        # Snapshot and clear the buffer
        batch_items: list[tuple[str, dict, np.ndarray]] = []
        for stream_id in list(state.pending_frames):
            if stream_id not in state.active_streams:
                state.pending_frames.pop(stream_id, None)
                continue
            header, frame = state.pending_frames.pop(stream_id)
            batch_items.append((stream_id, header, frame))
            if len(batch_items) >= MAX_BATCH_SIZE:
                break

        if not batch_items:
            continue

        frames = [item[2] for item in batch_items]

        # Run batched inference in executor to avoid blocking the event loop
        results_list = await loop.run_in_executor(
            None, state.detector.predict_batch, frames
        )

        now = time.monotonic()

        # Per-stream: track + send response
        for i, (stream_id, header, frame) in enumerate(batch_items):
            tracked_detections = state.detector.update_tracker(
                stream_id, results_list[i]
            )

            count = state.per_stream_inference_count.get(stream_id, 0)
            last_time = state.per_stream_last_inf_time.get(stream_id, now)
            elapsed = now - last_time
            inf_fps = 1.0 / elapsed if elapsed > 0 and count > 0 else 0.0
            state.per_stream_last_inf_time[stream_id] = now
            count += 1
            state.per_stream_inference_count[stream_id] = count

            if count == 1:
                logger.info(
                    "First frame processed for '%s' (idx=%d, %dx%d)",
                    stream_id,
                    header.get("frame_index", -1),
                    frame.shape[1],
                    frame.shape[0],
                )

            state.total_detections_sent += len(tracked_detections)

            vessels = [
                {
                    "detection": d.model_dump(),
                    "vessel": None,
                }
                for d in tracked_detections
            ]

            response = json.dumps({
                "type": "detections",
                "stream_id": stream_id,
                "frame_index": header.get("frame_index", 0),
                "timestamp_ms": header.get("timestamp_ms", 0.0),
                "fps": header.get("fps", 0.0),
                "inference_fps": round(inf_fps, 1),
                "vessels": vessels,
            })
            await ws.send(response)

        # Periodic status log
        if now - state.last_status_log >= STATUS_LOG_INTERVAL_S:
            logger.info(
                "Status: active_streams=%s batch_size=%d total_detections=%d paused=%s",
                list(state.active_streams),
                len(batch_items),
                state.total_detections_sent,
                state.is_paused,
            )
            state.last_status_log = now


def main() -> None:
    parser = argparse.ArgumentParser(description="IDUN inference worker")
    parser.add_argument("--model", default="best.pt", help="Path to RT-DETR model weights")
    parser.add_argument(
        "--mode",
        choices=("stream", "batch"),
        default=os.environ.get("IDUN_WORKER_MODE", "stream"),
        help="Worker mode: stream for live WebSocket inference, batch for uploaded-video jobs",
    )
    args = parser.parse_args()

    logger.info("Loading model: %s", args.model)
    detector = RTDETRDetector(model_path=args.model)
    logger.info(
        "Model loaded (max_batch=%d, fill_timeout=%.3fs), starting worker",
        MAX_BATCH_SIZE,
        BATCH_FILL_TIMEOUT_S,
    )
    if args.mode == "batch":
        asyncio.run(run_batch_worker(detector))
    else:
        asyncio.run(run_worker(detector))


if __name__ == "__main__":
    main()
