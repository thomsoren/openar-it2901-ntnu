"""Shared test doubles for streaming tests.

Provides FakeDecodeThread (mimics cv.decode_thread.DecodeThread) and FakePopen
(mimics subprocess.Popen) so tests can run without spawning real
decode threads or FFmpeg subprocesses.
"""
from __future__ import annotations

import numpy as np


class FakeDecodeThread:
    """Mimics DecodeThread without opening a real video source."""

    def __init__(self, alive: bool = True):
        self._alive = alive
        self._fps = 25.0
        self._width = 640
        self._height = 480

    def start(self) -> bool:
        return True

    def get_latest(self) -> tuple[np.ndarray | None, int, float]:
        return np.zeros((480, 640, 3), dtype=np.uint8), 0, 0.0

    def stop(self) -> None:
        self._alive = False

    @property
    def is_alive(self) -> bool:
        return self._alive

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    def die(self) -> None:
        """Simulate unexpected death (for crash-recovery tests)."""
        self._alive = False


class FakePopen:
    """Mimics subprocess.Popen for FFmpeg processes."""

    _next_pid = 60000

    def __init__(self, alive: bool = True, returncode: int | None = None):
        type(self)._next_pid += 1
        self.pid = type(self)._next_pid
        self._alive = alive
        self.returncode = returncode

    def poll(self) -> int | None:
        if self._alive:
            return None
        return self.returncode

    def terminate(self):
        self._alive = False
        if self.returncode is None:
            self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self._alive = False
        self.returncode = -9

    def die(self, returncode: int = 1):
        """Simulate FFmpeg crash."""
        self._alive = False
        self.returncode = returncode


class FakeInferenceThread:
    """No-op inference thread for tests that don't need real inference."""

    def __init__(self, *_args, **_kwargs):
        self._active_stream_id: str | None = None
        self._streams: dict[str, object] = {}

    def set_active_stream(self, stream_id: str | None) -> None:
        self._active_stream_id = stream_id

    def get_active_stream(self) -> str | None:
        return self._active_stream_id

    def register_stream(self, stream_id: str, decode_thread: object) -> None:
        self._streams[stream_id] = decode_thread

    def unregister_stream(self, stream_id: str) -> None:
        self._streams.pop(stream_id, None)
        if self._active_stream_id == stream_id:
            self._active_stream_id = None

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass
