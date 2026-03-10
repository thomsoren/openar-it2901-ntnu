"""Inference thread — batched multi-stream detection using RT-DETR."""
from __future__ import annotations

import logging
import threading
import time

import numpy as np

from cv.adaptive_rate import AdaptiveRateController
from cv.config import MAX_INFERENCE_BATCH_SIZE
from cv.decode_thread import DecodeThread
from cv.detectors import RTDETRDetector
from cv.performance import build_detection_performance_payload, now_epoch_ms
from cv.publisher import DetectionPublisher
from cv.tracker_registry import TrackerRegistry
from cv.utils import build_ready_payload
from settings import cv_runtime_settings

logger = logging.getLogger(__name__)


class InferenceThread:
    """Runs RT-DETR detection on all active streams using batched inference.

    Multiple streams can be active simultaneously. Each inference cycle:
    1. Collects the latest frame from every active stream
    2. Runs a single batched ``model.predict()`` call on all frames
    3. Updates per-stream ByteTrack trackers via ``TrackerRegistry``
    4. Publishes results to per-stream Redis channels
    """

    def __init__(self, detector: RTDETRDetector, publisher: DetectionPublisher):
        self._detector = detector
        self._publisher = publisher
        self._tracker_registry = TrackerRegistry(
            class_name_map=detector.CLASS_NAME_MAP,
            boat_classes=detector.BOAT_CLASSES,
            filter_boats=detector.filter_boats,
        )
        self._max_batch_size = MAX_INFERENCE_BATCH_SIZE

        self._lock = threading.Lock()
        self._streams: dict[str, DecodeThread] = {}
        self._active_stream_ids: set[str] = set()

        self._last_processed_idx: dict[str, int] = {}
        self._ready_sent: set[str] = set()
        self._last_inf_time: dict[str, float] = {}
        self._rate_controllers: dict[str, AdaptiveRateController] = {}

        self._thread: threading.Thread | None = None
        self._stopped = threading.Event()

    # ── Public API (called by orchestrator) ──────────────────────────────

    def add_active_stream(self, stream_id: str) -> None:
        with self._lock:
            self._active_stream_ids.add(stream_id)

    def remove_active_stream(self, stream_id: str) -> None:
        with self._lock:
            self._active_stream_ids.discard(stream_id)

    def set_active_stream(self, stream_id: str | None) -> None:
        """Backward-compatible: sets a single active stream."""
        with self._lock:
            if stream_id is None:
                self._active_stream_ids.clear()
            else:
                self._active_stream_ids = {stream_id}

    def get_active_stream(self) -> str | None:
        """Backward-compatible: returns one active stream (arbitrary if multiple)."""
        with self._lock:
            return next(iter(self._active_stream_ids), None)

    def get_active_streams(self) -> set[str]:
        with self._lock:
            return set(self._active_stream_ids)

    def register_stream(self, stream_id: str, decode_thread: DecodeThread) -> None:
        with self._lock:
            self._streams[stream_id] = decode_thread
            self._rate_controllers[stream_id] = AdaptiveRateController()

    def unregister_stream(self, stream_id: str) -> None:
        with self._lock:
            self._streams.pop(stream_id, None)
            self._last_processed_idx.pop(stream_id, None)
            self._ready_sent.discard(stream_id)
            self._active_stream_ids.discard(stream_id)
            self._last_inf_time.pop(stream_id, None)
            self._rate_controllers.pop(stream_id, None)
        self._tracker_registry.remove(stream_id)

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

    # ── Internal helpers ─────────────────────────────────────────────────

    def _publish_ready_if_needed(self, stream_id: str, decode_thread: DecodeThread) -> None:
        if stream_id in self._ready_sent or not decode_thread.is_alive:
            return
        self._publisher.publish(
            stream_id,
            build_ready_payload(decode_thread.width, decode_thread.height, decode_thread.fps),
        )
        self._ready_sent.add(stream_id)

    def _loop(self) -> None:
        wait_no_stream = cv_runtime_settings.inference_wait_no_stream_sec
        wait_no_frame = cv_runtime_settings.inference_wait_no_frame_sec
        logger.info("Inference thread loop started, waiting for active streams")

        while not self._stopped.is_set():
            # 1. Snapshot active streams and their decode threads
            with self._lock:
                active_ids = set(self._active_stream_ids)
                streams = {
                    sid: self._streams[sid]
                    for sid in active_ids
                    if sid in self._streams
                }

            if not streams:
                time.sleep(wait_no_stream)
                continue

            # 2. Publish "ready" for any new streams
            for sid, dt in streams.items():
                self._publish_ready_if_needed(sid, dt)

            # 3. Collect pending frames from all active streams (respecting adaptive rate)
            batch: list[tuple[str, DecodeThread, np.ndarray, int, float, float]] = []
            for sid, dt in streams.items():
                latest = dt.get_latest_telemetry()
                frame = latest.frame
                frame_idx = latest.frame_index
                if frame is None or frame_idx == self._last_processed_idx.get(sid, -1):
                    continue
                rate_ctrl = self._rate_controllers.get(sid)
                if rate_ctrl and not rate_ctrl.should_process():
                    self._last_processed_idx[sid] = frame_idx
                    continue
                batch.append((sid, dt, frame, frame_idx, latest.timestamp_ms, latest.decoded_at_ms))
                if len(batch) >= self._max_batch_size:
                    break

            if not batch:
                time.sleep(wait_no_frame)
                continue

            # 4. Batch predict — single GPU forward pass for all frames
            frames = [entry[2] for entry in batch]
            inference_started_at_ms = now_epoch_ms()
            results_list = self._detector.predict_batch(frames)
            inference_completed_at_ms = now_epoch_ms()

            now = time.monotonic()

            # 5. Per-stream: track + publish + report to adaptive rate controller
            inference_duration_ms = inference_completed_at_ms - inference_started_at_ms
            per_stream_duration_ms = inference_duration_ms / len(batch) if batch else 0.0

            for i, (sid, dt, frame, frame_idx, ts, decoded_at_ms) in enumerate(batch):
                tracked_detections = self._tracker_registry.update(sid, results_list[i])

                last_time = self._last_inf_time.get(sid, now)
                inf_fps = 1.0 / (now - last_time) if now > last_time else 0.0
                self._last_inf_time[sid] = now

                rate_ctrl = self._rate_controllers.get(sid)
                if rate_ctrl:
                    rate_ctrl.report_inference(per_stream_duration_ms, dt.fps)
                skip_interval = rate_ctrl.skip_interval if rate_ctrl else 1

                if self._last_processed_idx.get(sid, -1) == -1:
                    logger.info(
                        "[%s] First frame processed (idx=%d, %dx%d)",
                        sid, frame_idx, frame.shape[1], frame.shape[0],
                    )
                self._last_processed_idx[sid] = frame_idx

                vessels = [{"detection": d.model_dump(), "vessel": None} for d in tracked_detections]
                published_at_ms = now_epoch_ms()
                payload = {
                    "type": "detections",
                    "frame_index": frame_idx,
                    "timestamp_ms": ts,
                    "frame_sent_at_ms": published_at_ms,
                    "fps": dt.fps,
                    "inference_fps": round(inf_fps, 1),
                    "vessels": vessels,
                    "performance": build_detection_performance_payload(
                        source_fps=dt.fps,
                        inference_fps=inf_fps,
                        decoded_at_ms=decoded_at_ms,
                        inference_started_at_ms=inference_started_at_ms,
                        inference_completed_at_ms=inference_completed_at_ms,
                        published_at_ms=published_at_ms,
                        skip_interval=skip_interval,
                    ),
                }
                self._publisher.publish(sid, payload)
