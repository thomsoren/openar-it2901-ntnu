"""Tests for WorkerOrchestrator core lifecycle — start, stop, viewer, heartbeat."""
from __future__ import annotations

import time

import pytest

from orchestrator import StreamConfig, WorkerOrchestrator
from orchestrator.exceptions import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
    StreamNotFoundError,
)


def _cfg(stream_id: str = "test", source_url: str = "rtsp://host/live") -> StreamConfig:
    return StreamConfig(stream_id=stream_id, source_url=source_url, loop=True)


# ---------- Start / Stop ----------

class TestStartStop:
    def test_start_creates_handle(self, orchestrator_factory):
        orch = orchestrator_factory()
        handle = orch.start_stream(_cfg("s1"))
        assert handle.config.stream_id == "s1"
        assert handle.is_alive
        assert handle.viewer_count == 0

    def test_start_persists_config(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        assert "s1" in orch._stream_configs

    def test_stop_terminates_process(self, orchestrator_factory):
        orch = orchestrator_factory()
        handle = orch.start_stream(_cfg("s1"))
        process = handle.process
        orch.stop_stream("s1")
        assert not process.is_alive()

    def test_stop_nonexistent_raises(self, orchestrator_factory):
        orch = orchestrator_factory()
        with pytest.raises(StreamNotFoundError):
            orch.stop_stream("unknown")

    def test_stop_remove_config_true(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.stop_stream("s1", remove_config=True)
        assert "s1" not in orch._stream_configs

    def test_stop_remove_config_false(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.stop_stream("s1", remove_config=False)
        assert "s1" in orch._stream_configs

    def test_duplicate_start_raises(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        with pytest.raises(StreamAlreadyRunningError):
            orch.start_stream(_cfg("s1"))

    def test_max_workers_enforced(self, orchestrator_factory):
        orch = orchestrator_factory(max_workers=2)
        orch.start_stream(_cfg("s1"))
        orch.start_stream(_cfg("s2"))
        with pytest.raises(ResourceLimitExceededError):
            orch.start_stream(_cfg("s3"))


# ---------- Listing ----------

class TestListStreams:
    def test_empty(self, orchestrator_factory):
        orch = orchestrator_factory()
        assert orch.list_streams() == []

    def test_includes_all_running(self, orchestrator_factory):
        orch = orchestrator_factory()
        for i in range(3):
            orch.start_stream(_cfg(f"s{i}"))
        listed = orch.list_streams()
        assert len(listed) == 3
        ids = {item["stream_id"] for item in listed}
        assert ids == {"s0", "s1", "s2"}

    def test_dict_shape(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        item = orch.list_streams()[0]
        for key in ("stream_id", "status", "pid", "viewer_count", "restart_count", "source_url"):
            assert key in item, f"Missing key: {key}"


# ---------- Heartbeat ----------

class TestHeartbeat:
    def test_touch_updates_heartbeat(self, orchestrator_factory):
        orch = orchestrator_factory()
        handle = orch.start_stream(_cfg("s1"))
        old_hb = handle.last_heartbeat
        time.sleep(0.01)
        orch.touch_stream("s1")
        assert handle.last_heartbeat > old_hb

    def test_touch_nonexistent_is_noop(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.touch_stream("unknown")  # Should not raise


# ---------- Viewer Acquire / Release ----------

class TestViewerLifecycle:
    def test_acquire_increments_count(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        handle = orch.acquire_stream_viewer("s1")
        assert handle.viewer_count == 1

    def test_acquire_resets_no_viewer_since(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        handle = orch.acquire_stream_viewer("s1")
        assert handle.no_viewer_since == 0.0

    def test_acquire_updates_heartbeat(self, orchestrator_factory):
        orch = orchestrator_factory()
        handle = orch.start_stream(_cfg("s1"))
        old_hb = handle.last_heartbeat
        time.sleep(0.01)
        orch.acquire_stream_viewer("s1")
        assert handle.last_heartbeat > old_hb

    def test_acquire_multiple_viewers(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        orch.acquire_stream_viewer("s1")
        orch.acquire_stream_viewer("s1")
        handle = orch.get_stream("s1")
        assert handle.viewer_count == 3

    def test_release_decrements_count(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        orch.acquire_stream_viewer("s1")
        orch.release_stream_viewer("s1")
        handle = orch.get_stream("s1")
        assert handle.viewer_count == 1

    def test_release_to_zero_sets_no_viewer_since(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        orch.release_stream_viewer("s1")
        handle = orch.get_stream("s1")
        assert handle.viewer_count == 0
        assert handle.no_viewer_since > 0.0

    def test_release_never_goes_negative(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        # Release without prior acquire
        orch.release_stream_viewer("s1")
        orch.release_stream_viewer("s1")
        handle = orch.get_stream("s1")
        assert handle.viewer_count == 0

    def test_release_nonexistent_is_noop(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.release_stream_viewer("unknown")  # Should not raise

    def test_acquire_triggers_hot_restart(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.stop_stream("s1", remove_config=False)
        # Config retained → acquire should respawn
        handle = orch.acquire_stream_viewer("s1")
        assert handle.viewer_count == 1
        assert handle.is_alive

    def test_acquire_hot_restart_at_max_raises(self, orchestrator_factory):
        orch = orchestrator_factory(max_workers=1)
        orch.start_stream(_cfg("s1"))
        # Stop s1 but keep config, then start s2 to fill the slot
        orch.stop_stream("s1", remove_config=False)
        orch.start_stream(_cfg("s2"))
        # Now s2 is running (1/1), s1 has config but no worker
        with pytest.raises(ResourceLimitExceededError):
            orch.acquire_stream_viewer("s1")

    def test_acquire_no_config_raises(self, orchestrator_factory):
        orch = orchestrator_factory()
        with pytest.raises(StreamNotFoundError):
            orch.acquire_stream_viewer("never-started")


# ---------- Shutdown ----------

class TestShutdown:
    def test_terminates_all(self, orchestrator_factory):
        orch = orchestrator_factory()
        handles = [orch.start_stream(_cfg(f"s{i}")) for i in range(3)]
        processes = [h.process for h in handles]
        orch.shutdown()
        for p in processes:
            assert not p.is_alive()
        assert orch.list_streams() == []

    def test_stops_monitor(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_monitoring()
        assert orch._monitor_thread is not None
        orch.shutdown()
        assert orch._monitor_thread is None
