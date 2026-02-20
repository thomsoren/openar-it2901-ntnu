"""Inference worker process with Redis publishing and in-process queues."""
from __future__ import annotations

import logging
import os
import threading
import time
from multiprocessing import Process, Queue
from queue import Empty, Full

import cv2

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


def run(source_url: str, stream_id: str, detection_queue: Queue, frame_queue: Queue, loop: bool = True):
    from cv.detectors import get_detector
    from cv.publisher import DetectionPublisher

    detector = get_detector()
    publisher = DetectionPublisher()

    cap = cv2.VideoCapture(source_url)
    if not cap.isOpened():
        logger.error("[%s] Failed to open source: %s", stream_id, source_url)
        _offer_latest(detection_queue, None)
        _offer_latest(frame_queue, None)
        publisher.close()
        return

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    max_read_fps = float(os.getenv("STREAM_READ_FPS_CAP", "0"))
    max_inference_fps = float(os.getenv("STREAM_INFERENCE_FPS_CAP", "6"))
    fps = min(source_fps, max_read_fps) if max_read_fps > 0 else source_fps
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    ready_payload = {"type": "ready", "width": width, "height": height, "fps": fps}
    _offer_latest(detection_queue, ready_payload)
    publisher.publish(stream_id, ready_payload)

    lock = threading.Lock()
    latest = {"frame": None, "idx": 0, "ts": 0.0}
    stopped = threading.Event()

    def reader():
        frame_idx = 0
        interval = 1.0 / fps if fps > 0 else 0.04
        next_time = time.monotonic()

        while not stopped.is_set() and cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                if loop:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                break

            ts = (frame_idx / fps) * 1000 if fps > 0 else frame_idx * 40.0
            with lock:
                latest["frame"] = frame
                latest["idx"] = frame_idx
                latest["ts"] = ts

            _offer_latest(frame_queue, (frame, frame_idx, ts))

            frame_idx += 1
            next_time += interval
            sleep = next_time - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)

        stopped.set()

    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()

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

        if latest_frame is None or frame_idx == last_processed_idx:
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

        payload = {
            "type": "detections",
            "frame_index": frame_idx,
            "timestamp_ms": ts,
            "fps": fps,
            "inference_fps": round(inf_fps, 1),
            "vessels": [{"detection": d.model_dump(), "vessel": None} for d in detections],
        }
        _offer_latest(detection_queue, payload)
        publisher.publish(stream_id, payload)

    reader_thread.join(timeout=1)
    cap.release()
    publisher.close()
    _offer_latest(detection_queue, None)
    _offer_latest(frame_queue, None)


def start(source_url: str, stream_id: str, loop: bool = True) -> tuple[Process, Queue, Queue]:
    detection_queue: Queue = Queue(maxsize=30)
    frame_queue: Queue = Queue(maxsize=30)
    process = Process(target=run, args=(source_url, stream_id, detection_queue, frame_queue, loop))
    process.start()
    return process, detection_queue, frame_queue
