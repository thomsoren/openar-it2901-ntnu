"""Inference thread — runs detection on the active stream's latest frame."""
from __future__ import annotations

import logging
import threading
import time

from cv.decode_thread import DecodeThread
from cv.detectors import RTDETRDetector
from cv.publisher import DetectionPublisher

logger = logging.getLogger(__name__)


class InferenceThread:
    """Single thread that runs RT-DETR detection on whichever stream is active.

    The orchestrator calls ``set_active_stream`` when viewer acquire/release
    happens. On stream switch the ByteTrack tracker is reset so track IDs
    restart cleanly for the new stream.
    """

    def __init__(self, detector: RTDETRDetector, publisher: DetectionPublisher):
        self._detector = detector
        self._publisher = publisher

        self._lock = threading.Lock()
        self._streams: dict[str, DecodeThread] = {}
        self._active_stream_id: str | None = None
        self._prev_active_stream_id: str | None = None

        self._last_processed_idx: dict[str, int] = {}
        self._ready_sent: set[str] = set()

        self._thread: threading.Thread | None = None
        self._stopped = threading.Event()

    def set_active_stream(self, stream_id: str | None) -> None:
        with self._lock:
            self._active_stream_id = stream_id

    def get_active_stream(self) -> str | None:
        with self._lock:
            return self._active_stream_id

    def register_stream(self, stream_id: str, decode_thread: DecodeThread) -> None:
        with self._lock:
            self._streams[stream_id] = decode_thread

    def unregister_stream(self, stream_id: str) -> None:
        with self._lock:
            self._streams.pop(stream_id, None)
            self._last_processed_idx.pop(stream_id, None)
            self._ready_sent.discard(stream_id)
            if self._active_stream_id == stream_id:
                self._active_stream_id = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stopped.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("Inference thread started")

    def stop(self) -> None:
        self._stopped.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
        logger.info("Inference thread stopped")

    def _reset_tracker(self) -> None:
        """Reset ByteTrack state so track IDs restart for a new stream."""
        try:
            predictor = getattr(self._detector.model, "predictor", None)
            if predictor is not None and hasattr(predictor, "trackers"):
                for tracker in predictor.trackers:
                    if tracker is not None and hasattr(tracker, "reset"):
                        tracker.reset()
        except Exception as exc:
            logger.debug("Tracker reset failed (non-critical): %s", exc)

    def _loop(self) -> None:
        last_time = time.monotonic()
        logger.info("Inference thread loop started, waiting for active stream")

        while not self._stopped.is_set():
            with self._lock:
                active_id = self._active_stream_id
                decode_thread = self._streams.get(active_id) if active_id else None

            if active_id is None or decode_thread is None:
                time.sleep(0.01)
                continue

            # Stream switch: reset tracker
            if active_id != self._prev_active_stream_id:
                self._reset_tracker()
                self._prev_active_stream_id = active_id
                logger.info("[%s] Inference thread switched to stream", active_id)

            # Send ready message on first activation
            if active_id not in self._ready_sent and decode_thread.is_alive:
                ready_payload = {
                    "type": "ready",
                    "width": decode_thread.width,
                    "height": decode_thread.height,
                    "fps": decode_thread.fps,
                }
                self._publisher.publish(active_id, ready_payload)
                self._ready_sent.add(active_id)

            frame, frame_idx, ts = decode_thread.get_latest()

            if frame is None or frame_idx == self._last_processed_idx.get(active_id, -1):
                time.sleep(0.005)
                continue

            detections = self._detector.detect(frame, track=True)
            if self._last_processed_idx.get(active_id, -1) == -1:
                logger.info("[%s] First frame processed (idx=%d, %dx%d)",
                            active_id, frame_idx, frame.shape[1], frame.shape[0])
            self._last_processed_idx[active_id] = frame_idx

            now = time.monotonic()
            inf_fps = 1.0 / (now - last_time) if now > last_time else 0.0
            last_time = now

            payload = {
                "type": "detections",
                "frame_index": frame_idx,
                "timestamp_ms": ts,
                "frame_sent_at_ms": time.time() * 1000.0,
                "fps": decode_thread.fps,
                "inference_fps": round(inf_fps, 1),
                "vessels": [
                    {"detection": d.model_dump(), "vessel": None}
                    for d in detections
                ],
            }
            self._publisher.publish(active_id, payload)
