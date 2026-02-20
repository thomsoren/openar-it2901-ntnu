from __future__ import annotations

import time
from multiprocessing import Queue

from orchestrator import StreamConfig, WorkerOrchestrator


class FakeProcess:
    _next_pid = 30000

    def __init__(self):
        type(self)._next_pid += 1
        self.pid = type(self)._next_pid
        self._alive = True
        self.exitcode = None

    def is_alive(self):
        return self._alive

    def terminate(self):
        self._alive = False
        self.exitcode = 0

    def join(self, timeout=None):
        del timeout
        return None

    def kill(self):
        self._alive = False
        self.exitcode = -9


def test_worker_stops_without_viewers_and_restarts_on_next_viewer(monkeypatch):
    def _fake_start(source_url: str, stream_id: str, loop: bool = True):
        del source_url, stream_id, loop
        return FakeProcess(), Queue(maxsize=10)

    monkeypatch.setattr("orchestrator.orchestrator.worker.start", _fake_start)

    orchestrator = WorkerOrchestrator(
        max_workers=4,
        monitor_interval_seconds=0.02,
        no_viewer_timeout_seconds=0.05,
    )
    config = StreamConfig(stream_id="viewer-test", source_url="rtsp://example.com/live", loop=True)
    orchestrator.start_stream(config)
    orchestrator.start_monitoring()

    handle = orchestrator.acquire_stream_viewer("viewer-test")
    assert handle.viewer_count == 1

    orchestrator.release_stream_viewer("viewer-test")
    time.sleep(0.2)
    assert orchestrator.list_streams() == []

    restarted = orchestrator.acquire_stream_viewer("viewer-test")
    assert restarted.viewer_count == 1
    assert restarted.process.is_alive()

    orchestrator.shutdown()
