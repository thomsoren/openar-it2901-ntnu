"""No-op inference thread for IDUN mode.

When IDUN remote inference is enabled, the local backend has no GPU and
should not attempt to load a model or run detection. This class satisfies
the InferenceThread interface so the orchestrator's viewer tracking,
stream lifecycle, and timeout logic all work unchanged.

The IdunBridge reads ``get_active_streams()`` to know which streams'
frames to send to the remote IDUN worker.
"""
from __future__ import annotations

import logging
import threading

from cv.decode_thread import DecodeThread

logger = logging.getLogger(__name__)


class NoopInferenceThread:
    """Inference thread that tracks active stream state but runs no detection."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._streams: dict[str, DecodeThread] = {}
        self._active_stream_ids: set[str] = set()

    def add_active_stream(self, stream_id: str) -> None:
        with self._lock:
            self._active_stream_ids.add(stream_id)

    def remove_active_stream(self, stream_id: str) -> None:
        with self._lock:
            self._active_stream_ids.discard(stream_id)

    def set_active_stream(self, stream_id: str | None) -> None:
        with self._lock:
            self._active_stream_ids.clear()
            if stream_id is not None:
                self._active_stream_ids.add(stream_id)

    def get_active_stream(self) -> str | None:
        with self._lock:
            return next(iter(self._active_stream_ids), None)

    def get_active_streams(self) -> set[str]:
        with self._lock:
            return set(self._active_stream_ids)

    def register_stream(self, stream_id: str, decode_thread: DecodeThread) -> None:
        with self._lock:
            self._streams[stream_id] = decode_thread

    def unregister_stream(self, stream_id: str) -> None:
        with self._lock:
            self._streams.pop(stream_id, None)
            self._active_stream_ids.discard(stream_id)

    def get_decode_thread(self, stream_id: str) -> DecodeThread | None:
        """Return the decode thread for a stream (used by IdunBridge)."""
        with self._lock:
            return self._streams.get(stream_id)

    def start(self) -> None:
        logger.info("NoopInferenceThread started (IDUN mode, no local inference)")

    def stop(self) -> None:
        logger.info("NoopInferenceThread stopped")
