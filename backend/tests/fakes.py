"""Shared test doubles for streaming tests.

Provides FakeProcess (mimics multiprocessing.Process) and FakePopen
(mimics subprocess.Popen) so tests can run without spawning real
worker processes or FFmpeg subprocesses.
"""
from __future__ import annotations


class FakeProcess:
    """Mimics multiprocessing.Process without spawning a real process."""

    _next_pid = 50000

    def __init__(self, alive: bool = True, exitcode: int | None = None):
        type(self)._next_pid += 1
        self.pid = type(self)._next_pid
        self._alive = alive
        self.exitcode = exitcode

    def is_alive(self) -> bool:
        return self._alive

    def terminate(self):
        self._alive = False
        if self.exitcode is None:
            self.exitcode = 0

    def join(self, timeout=None):
        return None

    def kill(self):
        self._alive = False
        self.exitcode = -9

    def start(self):
        pass

    def die(self, exitcode: int = 1):
        """Simulate unexpected death (for crash-recovery tests)."""
        self._alive = False
        self.exitcode = exitcode


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
