"""Worker orchestrator for multi-stream lifecycle management."""
from __future__ import annotations

import logging
import threading
import time

from cv import worker
from orchestrator.exceptions import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
    StreamNotFoundError,
)
from orchestrator.types import StreamConfig, WorkerHandle

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
    ):
        self._workers: dict[str, WorkerHandle] = {}
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

    def _spawn_handle(self, config: StreamConfig, viewer_count: int = 0) -> WorkerHandle:
        process, inference_queue = worker.start(
            source_url=config.source_url,
            stream_id=config.stream_id,
            loop=config.loop,
        )
        return WorkerHandle(
            process=process,
            inference_queue=inference_queue,
            config=config,
            backoff_seconds=self._initial_backoff_seconds,
            viewer_count=max(0, viewer_count),
            no_viewer_since=0.0 if viewer_count > 0 else time.monotonic(),
        )

    def start_stream(self, config: StreamConfig) -> WorkerHandle:
        with self._lock:
            if config.stream_id in self._workers:
                raise StreamAlreadyRunningError(f"Stream '{config.stream_id}' is already running")
            if len(self._workers) >= self._max_workers:
                raise ResourceLimitExceededError("Max concurrent streams reached")
            self._stream_configs[config.stream_id] = config
            handle = self._spawn_handle(config=config, viewer_count=0)
            self._workers[config.stream_id] = handle
            logger.info("Started stream '%s' with pid=%s", config.stream_id, handle.process.pid)
            return handle

    def stop_stream(self, stream_id: str, remove_config: bool = True):
        with self._lock:
            handle = self._workers.pop(stream_id, None)
            if remove_config:
                self._stream_configs.pop(stream_id, None)
        if not handle:
            raise StreamNotFoundError(f"Stream '{stream_id}' not found")

        handle.terminate()
        logger.info("Stopped stream '%s'", stream_id)

    def get_stream(self, stream_id: str) -> WorkerHandle:
        with self._lock:
            handle = self._workers.get(stream_id)
            if not handle:
                raise StreamNotFoundError(f"Stream '{stream_id}' not found")
            return handle

    def touch_stream(self, stream_id: str):
        with self._lock:
            handle = self._workers.get(stream_id)
            if handle:
                handle.last_heartbeat = time.monotonic()

    def acquire_stream_viewer(self, stream_id: str) -> WorkerHandle:
        with self._lock:
            handle = self._workers.get(stream_id)
            if handle:
                handle.viewer_count += 1
                handle.no_viewer_since = 0.0
                handle.last_heartbeat = time.monotonic()
                return handle

            config = self._stream_configs.get(stream_id)
            if not config:
                raise StreamNotFoundError(f"Stream '{stream_id}' not found")
            if len(self._workers) >= self._max_workers:
                raise ResourceLimitExceededError("Max concurrent streams reached")

            handle = self._spawn_handle(config=config, viewer_count=1)
            self._workers[stream_id] = handle
            logger.info(
                "Started stream '%s' with pid=%s for active viewer",
                stream_id,
                handle.process.pid,
            )
            return handle

    def release_stream_viewer(self, stream_id: str):
        with self._lock:
            handle = self._workers.get(stream_id)
            if not handle:
                return
            if handle.viewer_count > 0:
                handle.viewer_count -= 1
            if handle.viewer_count == 0 and handle.no_viewer_since == 0.0:
                handle.no_viewer_since = time.monotonic()

    def list_streams(self) -> list[dict]:
        with self._lock:
            return [h.to_dict() for h in self._workers.values()]

    def start_monitoring(self):
        if self._monitor_thread and self._monitor_thread.is_alive():
            return
        self._stop_event.clear()
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()
        logger.info("Worker monitor started")

    def stop_monitoring(self):
        self._stop_event.set()
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)
            self._monitor_thread = None
        logger.info("Worker monitor stopped")

    def shutdown(self):
        self.stop_monitoring()
        with self._lock:
            handles = list(self._workers.values())
            self._workers.clear()
        for handle in handles:
            handle.terminate()
        logger.info("Worker orchestrator shutdown complete")

    def _monitor_loop(self):
        while not self._stop_event.is_set():
            time.sleep(self._monitor_interval_seconds)
            now = time.monotonic()

            with self._lock:
                snapshot = list(self._workers.items())

            if self._idle_timeout_seconds > 0:
                idle_ids = [
                    sid for sid, h in snapshot
                    if sid not in self._protected_stream_ids
                    and (now - h.last_heartbeat) > self._idle_timeout_seconds
                ]
                for sid in idle_ids:
                    logger.info(
                        "Stopping idle stream '%s' (no heartbeat for %.0fs)",
                        sid, self._idle_timeout_seconds,
                    )
                    try:
                        self.stop_stream(sid)
                    except StreamNotFoundError:
                        pass

            if self._no_viewer_timeout_seconds > 0:
                no_viewer_ids: list[str] = []
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

                for sid in no_viewer_ids:
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

                if handle.is_alive:
                    handle.next_restart_at = 0.0
                    # Reset backoff so a future crash starts from the initial delay,
                    # not an exponentially grown one from a long-ago crash cycle.
                    handle.backoff_seconds = self._initial_backoff_seconds
                    continue

                if handle.next_restart_at == 0.0:
                    handle.next_restart_at = now + handle.backoff_seconds
                    logger.warning(
                        "Worker dead for stream '%s' (exit=%s). Scheduling restart in %.1fs",
                        stream_id,
                        handle.process.exitcode,
                        handle.backoff_seconds,
                    )
                    continue

                if now < handle.next_restart_at:
                    continue

                logger.warning("Restarting worker for stream '%s' now", stream_id)
                try:
                    process, inference_queue = worker.start(
                        source_url=handle.config.source_url,
                        stream_id=stream_id,
                        loop=handle.config.loop,
                    )
                except Exception:
                    handle.last_exitcode = handle.process.exitcode
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
                        process.terminate()
                        process.join(timeout=1)
                        if process.is_alive():
                            process.kill()
                        continue
                    handle.last_exitcode = handle.process.exitcode
                    handle.process = process
                    handle.inference_queue = inference_queue
                    handle.restart_count += 1
                    handle.started_at = time.monotonic()
                    handle.backoff_seconds = min(
                        handle.backoff_seconds * 2,
                        self._max_backoff_seconds,
                    )
                    handle.next_restart_at = 0.0

                logger.info("Restarted stream '%s' with pid=%s", stream_id, process.pid)
