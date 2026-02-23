"""Tests for stream switching — inference thread routes to active stream."""
from __future__ import annotations

from orchestrator import StreamConfig


def _cfg(stream_id: str) -> StreamConfig:
    return StreamConfig(stream_id=stream_id, source_url=f"rtsp://host/{stream_id}", loop=True)


class TestActiveStreamRouting:
    def test_acquire_sets_active_stream(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() == "s1"

    def test_release_clears_active_stream(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        orch.release_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() is None

    def test_switch_changes_active_stream(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.start_stream(_cfg("s2"))

        orch.acquire_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() == "s1"

        # Release s1, acquire s2 — simulates tab switch
        orch.release_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() is None

        orch.acquire_stream_viewer("s2")
        assert fake_inference_thread.get_active_stream() == "s2"

    def test_multiple_viewers_keeps_active(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        orch.acquire_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() == "s1"

        # Release one viewer — still has viewers, should stay active
        orch.release_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() == "s1"

        # Release last viewer — should clear
        orch.release_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() is None


class TestStreamRegistration:
    def test_start_registers_stream(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        assert "s1" in fake_inference_thread._streams

    def test_stop_unregisters_stream(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.stop_stream("s1")
        assert "s1" not in fake_inference_thread._streams

    def test_stop_active_clears_active(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        assert fake_inference_thread.get_active_stream() == "s1"

        orch.stop_stream("s1")
        assert fake_inference_thread.get_active_stream() is None

    def test_shutdown_unregisters_all(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.start_stream(_cfg("s2"))
        assert len(fake_inference_thread._streams) == 2

        orch.shutdown()
        assert len(fake_inference_thread._streams) == 0
