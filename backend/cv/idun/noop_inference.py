"""No-op inference thread for IDUN mode.

When IDUN remote inference is enabled, the local backend has no GPU and
should not attempt to load a model or run detection. This class satisfies
the InferenceThread interface so the orchestrator's viewer tracking,
stream lifecycle, and timeout logic all work unchanged.

The IdunBridge reads ``get_active_stream()`` to know which stream's
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
        self._active_stream_id: str | None = None

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
            if self._active_stream_id == stream_id:
                self._active_stream_id = None

    def get_decode_thread(self, stream_id: str) -> DecodeThread | None:
        """Return the decode thread for a stream (used by IdunBridge)."""
        with self._lock:
            return self._streams.get(stream_id)

    def start(self) -> None:
        logger.info("NoopInferenceThread started (IDUN mode, no local inference)")

    def stop(self) -> None:
        logger.info("NoopInferenceThread stopped")
