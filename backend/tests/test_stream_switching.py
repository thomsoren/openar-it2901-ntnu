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
        assert "s1" in fake_inference_thread.get_active_streams()

    def test_release_clears_active_stream(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        orch.release_stream_viewer("s1")
        assert "s1" not in fake_inference_thread.get_active_streams()

    def test_switch_changes_active_stream(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.start_stream(_cfg("s2"))

        orch.acquire_stream_viewer("s1")
        assert "s1" in fake_inference_thread.get_active_streams()

        # Release s1, acquire s2 — simulates tab switch
        orch.release_stream_viewer("s1")
        assert "s1" not in fake_inference_thread.get_active_streams()

        orch.acquire_stream_viewer("s2")
        assert "s2" in fake_inference_thread.get_active_streams()

    def test_multiple_streams_active_simultaneously(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.start_stream(_cfg("s2"))

        orch.acquire_stream_viewer("s1")
        orch.acquire_stream_viewer("s2")

        active = fake_inference_thread.get_active_streams()
        assert "s1" in active
        assert "s2" in active

        orch.release_stream_viewer("s1")
        active = fake_inference_thread.get_active_streams()
        assert "s1" not in active
        assert "s2" in active

    def test_multiple_viewers_keeps_active(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.acquire_stream_viewer("s1")
        orch.acquire_stream_viewer("s1")
        assert "s1" in fake_inference_thread.get_active_streams()

        # Release one viewer — still has viewers, should stay active
        orch.release_stream_viewer("s1")
        assert "s1" in fake_inference_thread.get_active_streams()

        # Release last viewer — should clear
        orch.release_stream_viewer("s1")
        assert "s1" not in fake_inference_thread.get_active_streams()


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
        assert "s1" in fake_inference_thread.get_active_streams()

        orch.stop_stream("s1")
        assert "s1" not in fake_inference_thread.get_active_streams()

    def test_shutdown_unregisters_all(self, orchestrator_factory, fake_inference_thread):
        orch = orchestrator_factory()
        orch.start_stream(_cfg("s1"))
        orch.start_stream(_cfg("s2"))
        assert len(fake_inference_thread._streams) == 2

        orch.shutdown()
        assert len(fake_inference_thread._streams) == 0
