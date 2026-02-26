"""Worker orchestrator for multi-stream lifecycle management."""
from __future__ import annotations

import logging
import subprocess
import threading
import time

from cv.decode_thread import DecodeThread
from cv.detectors import get_shared_detector
from cv.ffmpeg import FFmpegDirectPublisher
from cv.inference_thread import InferenceThread
from cv.publisher import get_fusion_publisher, DetectionPublisher
from orchestrator.exceptions import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
    StreamNotFoundError,
)
from orchestrator.types import StreamConfig, StreamHandle

logger = logging.getLogger(__name__)


class WorkerOrchestrator:
    def __init__(
        self,
        max_workers: int = 4,
        monitor_interval_seconds: float = 2.0,
        initial_backoff_seconds: float = 1.0,
        max_backoff_seconds: float = 60.0,
        idle_timeout_seconds: float = 300.0,
        no_viewer_timeout_seconds: float = 15.0,
        protected_stream_ids: set[str] | None = None,
        inference_thread: InferenceThread | None = None,
    ):
        self._workers: dict[str, StreamHandle] = {}
        self._stream_configs: dict[str, StreamConfig] = {}
        self._lock = threading.Lock()
        self._max_workers = max_workers
        self._monitor_interval_seconds = monitor_interval_seconds
        self._initial_backoff_seconds = initial_backoff_seconds
        self._max_backoff_seconds = max_backoff_seconds
        self._idle_timeout_seconds = idle_timeout_seconds
        self._no_viewer_timeout_seconds = no_viewer_timeout_seconds
        self._protected_stream_ids: set[str] = protected_stream_ids or set()
        self._monitor_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

        # Inference thread: shared across all streams, injected or created.
        self._inference_thread = inference_thread
        self._owns_inference_thread = inference_thread is None

    def _ensure_inference_thread(self) -> InferenceThread:
        """Lazily create and start the inference thread if not injected."""
        if self._inference_thread is None:
            detector = get_shared_detector()
            publisher = get_fusion_publisher()
            self._inference_thread = InferenceThread(detector, publisher)
            self._inference_thread.start()
        return self._inference_thread

    @staticmethod
    def _start_ffmpeg(config: StreamConfig) -> subprocess.Popen | None:
        """Start an FFmpeg direct publisher for the given stream config."""
        pub = FFmpegDirectPublisher(
            source_url=config.source_url,
            stream_id=config.stream_id,
            loop=config.loop,
        )
        if pub.start():
            return pub.process
        return None

    def _spawn_handle(self, config: StreamConfig, viewer_count: int = 0) -> StreamHandle:
        decode_thread = DecodeThread(
            source_url=config.source_url,
            stream_id=config.stream_id,
            loop=config.loop,
        )
        decode_thread.start()

        inf = self._ensure_inference_thread()
        inf.register_stream(config.stream_id, decode_thread)

        ffmpeg_proc = self._start_ffmpeg(config)
        return StreamHandle(
            decode_thread=decode_thread,
            config=config,
            ffmpeg_process=ffmpeg_proc,
            backoff_seconds=self._initial_backoff_seconds,
            viewer_count=max(0, viewer_count),
            no_viewer_since=0.0 if viewer_count > 0 else time.monotonic(),
        )

    def start_stream(self, config: StreamConfig) -> StreamHandle:
        with self._lock:
            if config.stream_id in self._workers:
                raise StreamAlreadyRunningError(f"Stream '{config.stream_id}' is already running")
            if len(self._workers) >= self._max_workers:
                raise ResourceLimitExceededError("Max concurrent streams reached")
            self._stream_configs[config.stream_id] = config
            handle = self._spawn_handle(config=config, viewer_count=0)
            self._workers[config.stream_id] = handle
            logger.info("Started stream '%s'", config.stream_id)
            return handle

    def stop_stream(self, stream_id: str, remove_config: bool = True) -> None:
        with self._lock:
            handle = self._workers.pop(stream_id, None)
            if remove_config:
                self._stream_configs.pop(stream_id, None)
        if not handle:
            raise StreamNotFoundError(f"Stream '{stream_id}' not found")

        if self._inference_thread:
            self._inference_thread.unregister_stream(stream_id)
        handle.terminate()
        logger.info("Stopped stream '%s'", stream_id)

    def get_stream(self, stream_id: str) -> StreamHandle:
        with self._lock:
            handle = self._workers.get(stream_id)
            if not handle:
                raise StreamNotFoundError(f"Stream '{stream_id}' not found")
            return handle

    def touch_stream(self, stream_id: str) -> None:
        with self._lock:
            handle = self._workers.get(stream_id)
            if handle:
                handle.last_heartbeat = time.monotonic()

    def acquire_stream_viewer(self, stream_id: str) -> StreamHandle:
        with self._lock:
            handle = self._workers.get(stream_id)
            if handle:
                handle.viewer_count += 1
                handle.no_viewer_since = 0.0
                handle.last_heartbeat = time.monotonic()
                inf = self._ensure_inference_thread()
                inf.set_active_stream(stream_id)
                return handle

            config = self._stream_configs.get(stream_id)
            if not config:
                raise StreamNotFoundError(f"Stream '{stream_id}' not found")
            if len(self._workers) >= self._max_workers:
                raise ResourceLimitExceededError("Max concurrent streams reached")

            handle = self._spawn_handle(config=config, viewer_count=1)
            self._workers[stream_id] = handle
            inf = self._ensure_inference_thread()
            inf.set_active_stream(stream_id)
            logger.info("Started stream '%s' for active viewer", stream_id)
            return handle

    def release_stream_viewer(self, stream_id: str) -> None:
        with self._lock:
            handle = self._workers.get(stream_id)
            if not handle:
                return
            if handle.viewer_count > 0:
                handle.viewer_count -= 1
            if handle.viewer_count == 0 and handle.no_viewer_since == 0.0:
                handle.no_viewer_since = time.monotonic()
            if handle.viewer_count == 0 and self._inference_thread:
                self._inference_thread.set_active_stream(None)

    def list_streams(self) -> list[dict]:
        with self._lock:
            return [h.to_dict() for h in self._workers.values()]

    def start_monitoring(self) -> None:
        if self._monitor_thread and self._monitor_thread.is_alive():
            return
        self._stop_event.clear()
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()
        logger.info("Worker monitor started")

    def stop_monitoring(self) -> None:
        self._stop_event.set()
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)
            self._monitor_thread = None
        logger.info("Worker monitor stopped")

    def shutdown(self) -> None:
        self.stop_monitoring()
        if self._inference_thread and self._owns_inference_thread:
            self._inference_thread.stop()
        with self._lock:
            handles = list(self._workers.values())
            self._workers.clear()
        for handle in handles:
            if self._inference_thread:
                self._inference_thread.unregister_stream(handle.config.stream_id)
            handle.terminate()
        logger.info("Worker orchestrator shutdown complete")

    def _monitor_loop(self) -> None:
        while not self._stop_event.is_set():
            time.sleep(self._monitor_interval_seconds)
            now = time.monotonic()

            with self._lock:
                snapshot = list(self._workers.items())

                # No-viewer timeout: mutations to no_viewer_since must happen
                # under the lock to avoid racing with release_stream_viewer().
                no_viewer_ids: list[str] = []
                if self._no_viewer_timeout_seconds > 0:
                    for sid, handle in snapshot:
                        if sid in self._protected_stream_ids:
                            continue
                        if handle.viewer_count > 0:
                            handle.no_viewer_since = 0.0
                            continue
                        if handle.no_viewer_since == 0.0:
                            handle.no_viewer_since = now
                            continue
                        if (now - handle.no_viewer_since) >= self._no_viewer_timeout_seconds:
                            no_viewer_ids.append(sid)

                # Idle timeout: computed under lock alongside no-viewer check
                # so both use the same consistent snapshot.
                idle_ids: list[str] = []
                if self._idle_timeout_seconds > 0:
                    idle_ids = [
                        sid for sid, h in snapshot
                        if sid not in self._protected_stream_ids
                        and (now - h.last_heartbeat) > self._idle_timeout_seconds
                    ]

            # Stop idle streams. Re-check under lock before each stop to
            # avoid racing with acquire_stream_viewer / touch_stream.
            for sid in idle_ids:
                with self._lock:
                    handle = self._workers.get(sid)
                    if not handle:
                        continue
                    if (now - handle.last_heartbeat) <= self._idle_timeout_seconds:
                        continue
                logger.info(
                    "Stopping idle stream '%s' (no heartbeat for %.0fs)",
                    sid, self._idle_timeout_seconds,
                )
                try:
                    self.stop_stream(sid)
                except StreamNotFoundError:
                    pass

            # Stop streams with no viewers. Re-check under lock before each
            # stop to avoid racing with acquire_stream_viewer.
            for sid in no_viewer_ids:
                with self._lock:
                    handle = self._workers.get(sid)
                    if not handle:
                        continue
                    if handle.viewer_count > 0:
                        continue
                logger.info(
                    "Stopping stream '%s' (no active viewers for %.0fs)",
                    sid,
                    self._no_viewer_timeout_seconds,
                )
                try:
                    # Keep stream config so a later viewer can auto-restart.
                    self.stop_stream(sid, remove_config=False)
                except StreamNotFoundError:
                    pass

            for stream_id, handle in snapshot:
                with self._lock:
                    current = self._workers.get(stream_id)
                    if current is not handle:
                        # Stream was intentionally removed (for example no-viewer stop).
                        continue

                # --- FFmpeg health check (independent of decode thread) ---
                if handle.ffmpeg_process is not None and handle.ffmpeg_process.poll() is not None:
                    exit_code = handle.ffmpeg_process.returncode
                    logger.warning(
                        "FFmpeg died for stream '%s' (exit=%s), restarting",
                        stream_id, exit_code,
                    )
                    handle.ffmpeg_process = self._start_ffmpeg(handle.config)

                # --- Decode thread health check ---
                if handle.is_alive:
                    handle.next_restart_at = 0.0
                    handle.backoff_seconds = self._initial_backoff_seconds
                    continue

                if handle.next_restart_at == 0.0:
                    handle.next_restart_at = now + handle.backoff_seconds
                    logger.warning(
                        "Decode thread dead for stream '%s'. Scheduling restart in %.1fs",
                        stream_id,
                        handle.backoff_seconds,
                    )
                    continue

                if now < handle.next_restart_at:
                    continue

                logger.warning("Restarting decode thread for stream '%s' now", stream_id)
                try:
                    new_decode = DecodeThread(
                        source_url=handle.config.source_url,
                        stream_id=stream_id,
                        loop=handle.config.loop,
                    )
                    if not new_decode.start():
                        raise RuntimeError("DecodeThread.start() returned False")
                except Exception:
                    handle.next_restart_at = now + handle.backoff_seconds
                    handle.backoff_seconds = min(
                        handle.backoff_seconds * 2,
                        self._max_backoff_seconds,
                    )
                    logger.exception("Restart failed for stream '%s'", stream_id)
                    continue

                with self._lock:
                    current = self._workers.get(stream_id)
                    if current is not handle:
                        new_decode.stop()
                        continue
                    handle.decode_thread = new_decode
                    handle.restart_count += 1
                    handle.started_at = time.monotonic()
                    handle.backoff_seconds = min(
                        handle.backoff_seconds * 2,
                        self._max_backoff_seconds,
                    )
                    handle.next_restart_at = 0.0

                # Re-register the new decode thread with the inference thread
                if self._inference_thread:
                    self._inference_thread.register_stream(stream_id, new_decode)

                logger.info("Restarted decode thread for stream '%s'", stream_id)
