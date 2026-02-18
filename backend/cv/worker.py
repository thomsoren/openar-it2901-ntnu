"""Inference worker process.

Two threads:
- Reader: reads frames at video FPS, sends to MJPEG queue, keeps latest for inference
- Inference: runs on latest frame (skips naturally when slower than video)
"""
import logging
import threading
import time
from multiprocessing import Process, Queue

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

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
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
            except Exception:
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

    while not stopped.is_set():
        with lock:
            frame = latest["frame"].copy()
            frame_idx = latest["idx"]
            ts = latest["ts"]

        detections = detector.detect(frame, track=True)

        now = time.monotonic()
        inf_fps = 1.0 / (now - last_time) if now > last_time else 0.0
        last_time = now

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
    detection_queue: Queue = Queue()
    frame_queue: Queue = Queue(maxsize=30)
    p = Process(target=run, args=(source_url, stream_id, detection_queue, frame_queue, loop))
    p.start()
    return p, detection_queue, frame_queue
