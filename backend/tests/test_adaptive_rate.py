from __future__ import annotations

from unittest.mock import patch

from cv.adaptive_rate import AdaptiveRateController


def _make_controller(
    enabled: bool = True,
    max_skip: int = 4,
    high_threshold: float = 0.85,
    low_threshold: float = 0.6,
) -> AdaptiveRateController:
    with patch("cv.adaptive_rate.cv_runtime_settings") as mock_settings:
        mock_settings.adaptive_rate_enabled = enabled
        mock_settings.adaptive_rate_max_skip = max_skip
        mock_settings.adaptive_rate_high_load_threshold = high_threshold
        mock_settings.adaptive_rate_low_load_threshold = low_threshold
        return AdaptiveRateController()


class TestShouldProcess:
    def test_always_true_when_disabled(self):
        ctrl = _make_controller(enabled=False)
        for _ in range(10):
            assert ctrl.should_process() is True

    def test_processes_every_frame_at_skip_1(self):
        ctrl = _make_controller()
        assert ctrl.skip_interval == 1
        for _ in range(5):
            assert ctrl.should_process() is True

    def test_skips_frames_at_skip_2(self):
        ctrl = _make_controller()
        ctrl._skip_interval = 2
        results = [ctrl.should_process() for _ in range(6)]
        assert results == [False, True, False, True, False, True]


class TestReportInference:
    def test_no_change_when_disabled(self):
        ctrl = _make_controller(enabled=False)
        for _ in range(20):
            ctrl.report_inference(100.0, 25.0)
        assert ctrl.skip_interval == 1

    def test_increases_skip_under_high_load(self):
        ctrl = _make_controller(high_threshold=0.85)
        source_fps = 25.0
        # At skip_interval=1, time_budget=40ms. Inference=38ms → load=0.95 > 0.85
        for _ in range(10):
            ctrl.report_inference(38.0, source_fps)
        assert ctrl.skip_interval > 1

    def test_respects_max_skip(self):
        ctrl = _make_controller(max_skip=2, high_threshold=0.5)
        source_fps = 25.0
        for _ in range(100):
            ctrl.report_inference(38.0, source_fps)
        assert ctrl.skip_interval <= 2

    def test_decreases_skip_under_low_load(self):
        ctrl = _make_controller(low_threshold=0.6)
        ctrl._skip_interval = 3
        ctrl._cooldown_remaining = 0
        source_fps = 25.0
        # At skip_interval=3, time_budget=120ms. Inference=20ms → load=0.17 < 0.6
        for _ in range(10):
            ctrl.report_inference(20.0, source_fps)
        assert ctrl.skip_interval < 3

    def test_ignores_zero_fps(self):
        ctrl = _make_controller()
        ctrl.report_inference(50.0, 0.0)
        assert ctrl.skip_interval == 1


class TestReset:
    def test_resets_to_defaults(self):
        ctrl = _make_controller()
        ctrl._skip_interval = 3
        ctrl._cooldown_remaining = 5
        ctrl.report_inference(50.0, 25.0)
        ctrl.reset()
        assert ctrl.skip_interval == 1
        assert ctrl._cooldown_remaining == 0
        assert len(ctrl._load_history) == 0


class TestPerformancePayloadIntegration:
    def test_skip_interval_in_payload(self):
        from cv.performance import build_detection_performance_payload

        payload = build_detection_performance_payload(
            source_fps=25.0,
            inference_fps=12.5,
            decoded_at_ms=1_000.0,
            inference_started_at_ms=1_030.0,
            inference_completed_at_ms=1_070.0,
            published_at_ms=1_080.0,
            skip_interval=2,
        )
        assert payload["skip_interval"] == 2
        assert payload["effective_detection_fps"] == 6.25

    def test_default_skip_interval(self):
        from cv.performance import build_detection_performance_payload

        payload = build_detection_performance_payload(
            source_fps=25.0,
            inference_fps=12.5,
            decoded_at_ms=1_000.0,
            inference_started_at_ms=1_030.0,
            inference_completed_at_ms=1_070.0,
            published_at_ms=1_080.0,
        )
        assert payload["skip_interval"] == 1
        assert payload["effective_detection_fps"] == 12.5
