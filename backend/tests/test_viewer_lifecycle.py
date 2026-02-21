from __future__ import annotations

import time

from orchestrator import StreamConfig, WorkerOrchestrator


def test_worker_stops_without_viewers_and_restarts_on_next_viewer(fake_worker_start, fake_ffmpeg):

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
