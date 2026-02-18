"""Fixed-rate detection publisher loop."""
from __future__ import annotations

import time
from multiprocessing import Queue

from cv.correction_pipeline import CorrectionPipeline


def run_publisher_loop(
    detection_queue: Queue,
    lock,
    state_lock,
    latest: dict,
    stopped,
    stats: dict,
    pipeline: CorrectionPipeline,
    fps: float,
    publish_hz: float = 25.0,
) -> None:
    interval = 1.0 / publish_hz
    next_time = time.monotonic()

    while not stopped.is_set():
        with lock:
            frame_idx = latest["idx"]
            ts = latest["ts"]

        now = time.monotonic()
        with state_lock:
            detections = pipeline.snapshot(now)
            inf_fps = stats["inference_fps"]

        detection_queue.put(
            {
                "frame_index": frame_idx,
                "timestamp_ms": ts,
                "fps": fps,
                "inference_fps": round(inf_fps, 1),
                "vessels": [{"detection": d.model_dump(), "vessel": None} for d in detections],
            }
        )

        next_time += interval
        sleep = next_time - time.monotonic()
        if sleep > 0:
            time.sleep(sleep)
