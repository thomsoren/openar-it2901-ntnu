"""Inference worker process with Redis publishing and in-process queues."""
from __future__ import annotations

import logging
import os
import threading
import time
from multiprocessing import Process, Queue
from queue import Empty, Full
from urllib.parse import urlparse

import cv2

from common.config.mediamtx import (
    FFMPEG_SCALE_HEIGHT,
    FFMPEG_SCALE_WIDTH,
)
from cv.ffmpeg import FFmpegPublisher

logger = logging.getLogger(__name__)


def _offer_latest(queue_obj: Queue, item) -> None:
    """Keep queue non-blocking and biased toward newest data."""
    try:
        queue_obj.put_nowait(item)
    except Full:
        try:
            queue_obj.get_nowait()
            queue_obj.put_nowait(item)
        except (Empty, Full):
            pass


def _is_remote_stream_url(source_url: str) -> bool:
    scheme = urlparse(source_url).scheme.lower()
    return scheme in {"rtsp", "http", "https", "rtmp", "udp", "tcp"}


def _scale_detection(detection: dict, scale_x: float, scale_y: float) -> dict:
    if scale_x == 1.0 and scale_y == 1.0:
        return detection
    scaled = dict(detection)
    scaled["x"] = float(detection.get("x", 0.0)) * scale_x
    scaled["y"] = float(detection.get("y", 0.0)) * scale_y
    scaled["width"] = float(detection.get("width", 0.0)) * scale_x
    scaled["height"] = float(detection.get("height", 0.0)) * scale_y
    return scaled


def run(
    source_url: str,
    stream_id: str,
    detection_queue: Queue,
    loop: bool = True,
):
    from cv.detectors import get_detector
    from cv.publisher import DetectionPublisher

    detector = get_detector()
    publisher = DetectionPublisher()

    cap = cv2.VideoCapture(source_url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        logger.error("[%s] Failed to open source: %s", stream_id, source_url)
        _offer_latest(detection_queue, None)
        publisher.close()
        return

    source_fps_raw = cap.get(cv2.CAP_PROP_FPS)
    # Some backends report invalid FPS (0/NaN/extreme values); keep sane default.
    if not source_fps_raw or source_fps_raw <= 1 or source_fps_raw > 240:
        source_fps = 25.0
    else:
        source_fps = float(source_fps_raw)
    # Keep output pacing tied to source timeline; throughput adapts by frame dropping under load.
    fps = source_fps
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    output_width = FFMPEG_SCALE_WIDTH if FFMPEG_SCALE_WIDTH > 0 else width
    output_height = FFMPEG_SCALE_HEIGHT if FFMPEG_SCALE_HEIGHT > 0 else height
    det_scale_x = (output_width / width) if width > 0 else 1.0
    det_scale_y = (output_height / height) if height > 0 else 1.0
    ffmpeg_publisher = FFmpegPublisher(stream_id=stream_id, width=width, height=height, fps=fps)
    ffmpeg_publisher.start()

    ready_payload = {"type": "ready", "width": output_width, "height": output_height, "fps": fps}
    _offer_latest(detection_queue, ready_payload)
    publisher.publish(stream_id, ready_payload)

    lock = threading.Lock()
    latest = {"frame": None, "idx": 0, "ts": 0.0, "frame_sent_at_ms": 0.0}
    stopped = threading.Event()
    is_remote_source = _is_remote_stream_url(source_url)
    allow_catchup_skips = not is_remote_source
    max_catchup_skip = max(1, int(os.getenv("STREAM_MAX_CATCHUP_SKIP", "8")))

    def reader():
        nonlocal cap
        frame_idx = -1
        start_mono = time.monotonic()
        read_interval = 1.0 / source_fps if source_fps > 0 else 0.04
        next_read_time = time.monotonic()
        last_ts_ms = 0.0
        reconnect_backoff = 0.5

        while not stopped.is_set():
            if not cap.isOpened():
                if is_remote_source:
                    logger.warning(
                        "[%s] Source disconnected; reconnecting in %.1fs",
                        stream_id,
                        reconnect_backoff,
                    )
                    time.sleep(reconnect_backoff)
                    reconnect_backoff = min(reconnect_backoff * 2.0, 8.0)
                    cap = cv2.VideoCapture(source_url)
                    continue
                break
            # Keep source timeline aligned to wall-clock when read FPS is capped below source FPS.
            if allow_catchup_skips and source_fps > 0:
                expected_source_idx = int((time.monotonic() - start_mono) * source_fps)
                lag_frames = expected_source_idx - (frame_idx + 1)
                if lag_frames > 0:
                    to_skip = min(lag_frames, max_catchup_skip)
                    for _ in range(to_skip):
                        if not cap.grab():
                            break
                        frame_idx += 1

            ret, frame = cap.read()
            if not ret:
                if is_remote_source:
                    logger.warning(
                        "[%s] Source read failed; reconnecting in %.1fs",
                        stream_id,
                        reconnect_backoff,
                    )
                    cap.release()
                    time.sleep(reconnect_backoff)
                    reconnect_backoff = min(reconnect_backoff * 2.0, 8.0)
                    cap = cv2.VideoCapture(source_url)
                    if cap.isOpened():
                        reconnect_backoff = 0.5
                        start_mono = time.monotonic()
                        next_read_time = time.monotonic()
                        continue
                    continue
                if loop:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    frame_idx = -1
                    start_mono = time.monotonic()
                    next_read_time = time.monotonic()
                    last_ts_ms = 0.0
                    continue
                break

            frame_idx += 1

            # Prefer source media PTS when available. Fallback to monotonic wall-time.
            ts_source = cap.get(cv2.CAP_PROP_POS_MSEC)
            if ts_source and ts_source > 0:
                ts = float(ts_source)
            else:
                ts = (time.monotonic() - start_mono) * 1000.0
            # Keep monotonic non-decreasing timestamps even if backend reports jittery PTS.
            if ts < last_ts_ms:
                ts = last_ts_ms
            else:
                last_ts_ms = ts
            with lock:
                latest["frame"] = frame
                latest["idx"] = frame_idx
                latest["ts"] = ts

            ffmpeg_publisher.push(frame)
            frame_sent_at_ms = time.time() * 1000.0
            publisher.publish(
                stream_id,
                {
                    "type": "frame_meta",
                    "frame_index": frame_idx,
                    "timestamp_ms": ts,
                    "frame_sent_at_ms": frame_sent_at_ms,
                    "fps": fps,
                },
            )

            # For file playback, keep reader paced by source FPS.
            # For live/RTSP sources, let source cadence drive timing.
            if not is_remote_source:
                next_read_time += read_interval
                sleep = next_read_time - time.monotonic()
                if sleep > 0:
                    time.sleep(sleep)
                elif sleep < -(read_interval * 3):
                    # Reset schedule if heavily behind to avoid unbounded drift accumulation.
                    next_read_time = time.monotonic()

            with lock:
                latest["frame_sent_at_ms"] = frame_sent_at_ms

        stopped.set()

    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()

    while latest["frame"] is None and not stopped.is_set():
        time.sleep(0.01)

    last_time = time.monotonic()
    last_processed_idx = -1

    while not stopped.is_set():
        with lock:
            latest_frame = latest["frame"]
            frame_idx = latest["idx"]
            ts = latest["ts"]
            frame_sent_at_ms = latest["frame_sent_at_ms"]

        if latest_frame is None or frame_idx == last_processed_idx:
            time.sleep(0.005)
            continue

        frame = latest_frame.copy()
        detections = detector.detect(frame, track=True)
        last_processed_idx = frame_idx

        now = time.monotonic()
        inf_fps = 1.0 / (now - last_time) if now > last_time else 0.0
        last_time = now

        payload = {
            "type": "detections",
            "frame_index": frame_idx,
            "timestamp_ms": ts,
            "frame_sent_at_ms": frame_sent_at_ms,
            "fps": fps,
            "inference_fps": round(inf_fps, 1),
            "vessels": [
                {"detection": _scale_detection(d.model_dump(), det_scale_x, det_scale_y), "vessel": None}
                for d in detections
            ],
        }
        _offer_latest(detection_queue, payload)
        publisher.publish(stream_id, payload)

    reader_thread.join(timeout=1)
    cap.release()
    ffmpeg_publisher.close()
    publisher.close()
    _offer_latest(detection_queue, None)


def start(source_url: str, stream_id: str, loop: bool = True) -> tuple[Process, Queue]:
    detection_queue_size = int(os.getenv("STREAM_DETECTION_QUEUE_SIZE", "30"))
    detection_queue: Queue = Queue(maxsize=max(1, detection_queue_size))
    process = Process(target=run, args=(source_url, stream_id, detection_queue, loop))
    process.start()
    return process, detection_queue
