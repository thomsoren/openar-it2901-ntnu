"""Tests for WorkerOrchestrator robustness — concurrency, backoff, crash recovery."""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from orchestrator import StreamConfig, WorkerOrchestrator
from orchestrator.exceptions import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
)


def _cfg(stream_id: str) -> StreamConfig:
    return StreamConfig(stream_id=stream_id, source_url=f"rtsp://host/{stream_id}", loop=True)


# ---------- Concurrency ----------

class TestConcurrentAccess:
    def test_concurrent_starts_all_succeed(self, orchestrator_factory):
        orch = orchestrator_factory(max_workers=8)
        ids = [f"c-{i}" for i in range(6)]

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda sid: orch.start_stream(_cfg(sid)), ids))

        assert len(results) == 6
        listed_ids = {s["stream_id"] for s in orch.list_streams()}
        assert set(ids) == listed_ids

    def test_concurrent_starts_exceed_max(self, orchestrator_factory):
        orch = orchestrator_factory(max_workers=3)
        ids = [f"c-{i}" for i in range(8)]
        results = {"ok": 0, "limit": 0}

        def _try_start(sid):
            try:
                orch.start_stream(_cfg(sid))
                results["ok"] += 1
            except ResourceLimitExceededError:
                results["limit"] += 1

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(_try_start, ids))

        assert results["ok"] == 3
        assert results["limit"] == 5

    def test_duplicate_start_raises(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("dup"))
        with pytest.raises(StreamAlreadyRunningError):
            orch.start_stream(_cfg("dup"))

    def test_interleaved_start_stop_no_corruption(self, orchestrator_factory):
        orch = orchestrator_factory(max_workers=20)

        def _start_stop(idx):
            sid = f"is-{idx}"
            orch.start_stream(_cfg(sid))
            time.sleep(0.001)
            orch.stop_stream(sid)

        with ThreadPoolExecutor(max_workers=10) as pool:
            list(pool.map(_start_stop, range(10)))

        assert orch.list_streams() == []

    def test_concurrent_acquire_release_consistent(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("v"))
        n_acquire = 50
        n_release = 50

        def _acquire(_):
            orch.acquire_stream_viewer("v")

        def _release(_):
            orch.release_stream_viewer("v")

        with ThreadPoolExecutor(max_workers=20) as pool:
            list(pool.map(_acquire, range(n_acquire)))
            list(pool.map(_release, range(n_release)))

        handle = orch.get_stream("v")
        assert handle.viewer_count == 0

    def test_rapid_viewer_flapping(self, orchestrator_factory):
        """100 rapid acquire/release cycles should not corrupt state."""
        orch = orchestrator_factory()
        orch.start_stream(_cfg("flap"))

        for _ in range(100):
            orch.acquire_stream_viewer("flap")
            orch.release_stream_viewer("flap")

        handle = orch.get_stream("flap")
        assert handle.viewer_count == 0


# ---------- Crash recovery / backoff ----------

class TestCrashRecovery:
    def test_backoff_doubles_across_consecutive_crashes(self, orchestrator_factory):
        """Two rapid crashes should result in restart_count >= 2, proving
        the monitor successfully detected both crashes and restarted."""
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            initial_backoff_seconds=0.05,
            max_backoff_seconds=10.0,
        )
        handle = orch.start_stream(_cfg("crash"))
        orch.start_monitoring()

        # First crash → wait for restart
        handle.process.die(exitcode=1)
        time.sleep(0.2)
        current = orch.get_stream("crash")
        assert current.restart_count >= 1

        # Second crash → wait for restart
        current.process.die(exitcode=1)
        time.sleep(0.4)
        final = orch.get_stream("crash")
        assert final.restart_count >= 2

    def test_backoff_caps_at_max(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            initial_backoff_seconds=0.05,
            max_backoff_seconds=0.2,
        )
        handle = orch.start_stream(_cfg("cap"))
        orch.start_monitoring()

        # Simulate multiple crashes
        for _ in range(5):
            handle = orch.get_stream("cap")
            handle.process.die(exitcode=1)
            time.sleep(0.3)

        handle = orch.get_stream("cap")
        assert handle.backoff_seconds <= 0.2

    def test_backoff_resets_when_healthy(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            initial_backoff_seconds=0.05,
        )
        handle = orch.start_stream(_cfg("healthy"))
        # Manually inflate backoff
        handle.backoff_seconds = 5.0
        orch.start_monitoring()

        # Let monitor see it alive
        time.sleep(0.1)
        assert handle.backoff_seconds == orch._initial_backoff_seconds

    def test_restart_count_increments(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            initial_backoff_seconds=0.02,
        )
        handle = orch.start_stream(_cfg("rc"))
        assert handle.restart_count == 0
        orch.start_monitoring()

        handle.process.die(exitcode=1)
        time.sleep(0.2)

        current = orch.get_stream("rc")
        assert current.restart_count >= 1

    def test_restart_replaces_process(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            initial_backoff_seconds=0.02,
        )
        handle = orch.start_stream(_cfg("rp"))
        old_pid = handle.process.pid
        orch.start_monitoring()

        handle.process.die(exitcode=1)
        time.sleep(0.2)

        current = orch.get_stream("rp")
        assert current.process.pid != old_pid


# ---------- Protected streams ----------

class TestProtectedStreams:
    def test_survives_idle_timeout(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            idle_timeout_seconds=0.05,
            protected_stream_ids={"protected"},
        )
        orch.start_stream(_cfg("protected"))
        orch.start_monitoring()
        time.sleep(0.2)
        # Protected stream should still be running
        assert len(orch.list_streams()) == 1
        assert orch.list_streams()[0]["stream_id"] == "protected"

    def test_survives_no_viewer_timeout(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            no_viewer_timeout_seconds=0.05,
            protected_stream_ids={"protected"},
        )
        orch.start_stream(_cfg("protected"))
        orch.start_monitoring()
        time.sleep(0.2)
        assert len(orch.list_streams()) == 1
