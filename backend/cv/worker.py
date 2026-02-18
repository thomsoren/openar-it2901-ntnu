"""Inference worker process.

Two threads:
- Reader: reads frames at video FPS, sends to MJPEG queue, keeps latest for inference
- Inference: runs on latest frame (skips naturally when slower than video)
"""
import logging
import os
import threading
import time
from multiprocessing import Process, Queue
from queue import Empty, Full

import cv2

logger = logging.getLogger(__name__)


def run(source_url: str, stream_id: str, detection_queue: Queue, frame_queue: Queue, loop: bool = True):
    from cv.detectors import get_detector
    detector = get_detector()

    cap = cv2.VideoCapture(source_url)
    if not cap.isOpened():
        logger.error("[%s] Failed to open source: %s", stream_id, source_url)
        detection_queue.put(None)
        frame_queue.put(None)
        return

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    max_read_fps = float(os.getenv("STREAM_READ_FPS_CAP", "0"))
    max_inference_fps = float(os.getenv("STREAM_INFERENCE_FPS_CAP", "6"))
    if max_read_fps > 0:
        fps = min(source_fps, max_read_fps)
    else:
        fps = source_fps
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    detection_queue.put(
        {"type": "ready", "stream_id": stream_id, "width": width, "height": height, "fps": fps}
    )

    # Shared state between threads
    lock = threading.Lock()
    latest = {"frame": None, "idx": 0, "ts": 0.0}
    stopped = threading.Event()

    def reader():
        frame_idx = 0
        interval = 1.0 / fps
        next_time = time.monotonic()

        while not stopped.is_set() and cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                if loop:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                break

            ts = (frame_idx / fps) * 1000
            with lock:
                latest["frame"] = frame
                latest["idx"] = frame_idx
                latest["ts"] = ts

            try:
                frame_queue.put_nowait((frame, frame_idx, ts))
            except Full:
                # Keep latency low by dropping stale frames when consumers lag.
                try:
                    frame_queue.get_nowait()
                    frame_queue.put_nowait((frame, frame_idx, ts))
                except (Empty, Full):
                    pass

            frame_idx += 1
            next_time += interval
            sleep = next_time - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)

        stopped.set()

    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()

    # Wait for first frame
    while latest["frame"] is None and not stopped.is_set():
        time.sleep(0.01)

    last_time = time.monotonic()
    last_processed_idx = -1
    min_inference_interval = (1.0 / max_inference_fps) if max_inference_fps > 0 else 0.0
    next_infer_time = time.monotonic()

    while not stopped.is_set():
        with lock:
            latest_frame = latest["frame"]
            frame_idx = latest["idx"]
            ts = latest["ts"]

        if latest_frame is None:
            time.sleep(0.005)
            continue
        if frame_idx == last_processed_idx:
            time.sleep(0.005)
            continue

        now = time.monotonic()
        if now < next_infer_time:
            time.sleep(min(next_infer_time - now, 0.01))
            continue

        frame = latest_frame.copy()
        detections = detector.detect(frame, track=True)
        last_processed_idx = frame_idx

        now = time.monotonic()
        inf_fps = 1.0 / (now - last_time) if now > last_time else 0.0
        last_time = now
        if min_inference_interval > 0:
            next_infer_time = now + min_inference_interval

        detection_queue.put({
            "stream_id": stream_id,
            "frame_index": frame_idx,
            "timestamp_ms": ts,
            "fps": fps,
            "inference_fps": round(inf_fps, 1),
            "vessels": [{"detection": d.model_dump(), "vessel": None} for d in detections],
        })

    reader_thread.join(timeout=1)
    cap.release()
    detection_queue.put(None)
    frame_queue.put(None)


def start(source_url: str, stream_id: str, loop: bool = True) -> tuple[Process, Queue, Queue]:
    frame_queue_size = int(os.getenv("STREAM_FRAME_QUEUE_SIZE", "4"))
    detection_queue: Queue = Queue()
    frame_queue: Queue = Queue(maxsize=max(1, frame_queue_size))
    p = Process(target=run, args=(source_url, stream_id, detection_queue, frame_queue, loop))
    p.start()
    return p, detection_queue, frame_queue
