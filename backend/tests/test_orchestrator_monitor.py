"""Tests for the orchestrator monitor loop — timeouts, FFmpeg restart, crash detection."""
from __future__ import annotations

import time

from orchestrator import StreamConfig, WorkerOrchestrator


def _cfg(stream_id: str = "mon") -> StreamConfig:
    return StreamConfig(stream_id=stream_id, source_url="rtsp://host/live", loop=True)


# ---------- Idle timeout ----------

class TestIdleTimeout:
    def test_stops_stream(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            idle_timeout_seconds=0.05,
            no_viewer_timeout_seconds=0,  # disable
        )
        orch.start_stream(_cfg("idle"))
        orch.start_monitoring()
        time.sleep(0.3)
        assert orch.list_streams() == []

    def test_respects_heartbeat(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            idle_timeout_seconds=0.1,
            no_viewer_timeout_seconds=0,  # disable
        )
        orch.start_stream(_cfg("alive"))
        orch.start_monitoring()

        # Keep heartbeating
        for _ in range(5):
            time.sleep(0.03)
            orch.touch_stream("alive")

        assert len(orch.list_streams()) == 1


# ---------- No-viewer timeout ----------

class TestNoViewerTimeout:
    def test_stops_stream(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            no_viewer_timeout_seconds=0.05,
            idle_timeout_seconds=999,  # disable effectively
        )
        orch.start_stream(_cfg("nv"))
        orch.start_monitoring()
        time.sleep(0.3)
        assert orch.list_streams() == []

    def test_cancelled_by_acquire(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            no_viewer_timeout_seconds=0.1,
            idle_timeout_seconds=999,
        )
        orch.start_stream(_cfg("nv2"))
        orch.start_monitoring()

        # Acquire before timeout hits
        time.sleep(0.03)
        orch.acquire_stream_viewer("nv2")
        time.sleep(0.2)
        assert len(orch.list_streams()) == 1

    def test_preserves_config(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            no_viewer_timeout_seconds=0.05,
            idle_timeout_seconds=999,
        )
        orch.start_stream(_cfg("nv3"))
        orch.start_monitoring()
        time.sleep(0.3)
        # Worker stopped but config retained for hot restart
        assert orch.list_streams() == []
        assert "nv3" in orch._stream_configs

    def test_idle_stop_removes_config(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            idle_timeout_seconds=0.05,
            no_viewer_timeout_seconds=0,
        )
        orch.start_stream(_cfg("gone"))
        orch.start_monitoring()
        time.sleep(0.3)
        assert "gone" not in orch._stream_configs


# ---------- FFmpeg health ----------

class TestFFmpegHealth:
    def test_crash_triggers_restart(self, orchestrator_factory, fake_ffmpeg):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            idle_timeout_seconds=999,
            no_viewer_timeout_seconds=0,
        )
        handle = orch.start_stream(_cfg("ff"))
        orch.start_monitoring()

        # Simulate FFmpeg crash
        original_ffmpeg = handle.ffmpeg_process
        original_ffmpeg.die(returncode=1)

        time.sleep(0.15)

        current = orch.get_stream("ff")
        # FFmpeg should have been replaced
        assert current.ffmpeg_process is not original_ffmpeg

    def test_independent_of_worker(self, orchestrator_factory, fake_ffmpeg):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            idle_timeout_seconds=999,
            no_viewer_timeout_seconds=0,
        )
        handle = orch.start_stream(_cfg("ff2"))
        worker_pid = handle.process.pid
        orch.start_monitoring()

        # Kill FFmpeg only
        handle.ffmpeg_process.die(returncode=1)
        time.sleep(0.15)

        current = orch.get_stream("ff2")
        # Worker should be untouched
        assert current.process.pid == worker_pid
        assert current.process.is_alive()


# ---------- Worker crash detection ----------

class TestWorkerCrashDetection:
    def test_crash_detected(self, orchestrator_factory):
        orch = orchestrator_factory(
            monitor_interval_seconds=0.02,
            initial_backoff_seconds=0.02,
            idle_timeout_seconds=999,
            no_viewer_timeout_seconds=0,
        )
        handle = orch.start_stream(_cfg("wc"))
        orch.start_monitoring()

        handle.process.die(exitcode=1)
        time.sleep(0.2)

        current = orch.get_stream("wc")
        # Should have been restarted (new process)
        assert current.restart_count >= 1


# ---------- Monitor thread management ----------

class TestMonitorThread:
    def test_start_idempotent(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_monitoring()
        thread1 = orch._monitor_thread
        orch.start_monitoring()
        thread2 = orch._monitor_thread
        assert thread1 is thread2

    def test_stop_joins_thread(self, orchestrator_factory):
        orch = orchestrator_factory()
        orch.start_monitoring()
        assert orch._monitor_thread is not None
        orch.stop_monitoring()
        assert orch._monitor_thread is None
