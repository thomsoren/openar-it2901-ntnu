from __future__ import annotations

from cv.performance import build_detection_performance_payload


def test_build_detection_performance_payload():
    payload = build_detection_performance_payload(
        source_fps=25.0,
        inference_fps=12.5,
        decoded_at_ms=1_000.0,
        inference_started_at_ms=1_030.0,
        inference_completed_at_ms=1_070.0,
        published_at_ms=1_080.0,
    )

    assert payload["source_fps"] == 25.0
    assert payload["detection_fps"] == 12.5
    assert payload["decode_to_inference_start_ms"] == 30.0
    assert payload["inference_duration_ms"] == 40.0
    assert payload["publish_duration_ms"] == 10.0
    assert payload["total_detection_latency_ms"] == 80.0
