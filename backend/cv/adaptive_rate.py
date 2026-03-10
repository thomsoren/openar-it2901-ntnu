"""Adaptive detection rate controller.

Monitors inference load and dynamically adjusts frame skip interval
to prevent the detection pipeline from falling behind under resource pressure.
"""
from __future__ import annotations

import collections
import logging

from settings.cv import cv_runtime_settings

logger = logging.getLogger(__name__)

_WINDOW_SIZE = 30


class AdaptiveRateController:
    """Decides how many frames to skip based on recent inference load.

    Load ratio = inference_duration / time_budget_per_frame.
    When load exceeds ``high_load_threshold``, skip_interval increases.
    When load drops below ``low_load_threshold``, skip_interval decreases.
    Ramp-up is immediate (react fast to overload), ramp-down requires
    ``cooldown_ticks`` consecutive low-load samples (avoid oscillation).
    """

    def __init__(self) -> None:
        settings = cv_runtime_settings
        self._enabled = settings.adaptive_rate_enabled
        self._max_skip = settings.adaptive_rate_max_skip
        self._high_threshold = settings.adaptive_rate_high_load_threshold
        self._low_threshold = settings.adaptive_rate_low_load_threshold

        self._load_history: collections.deque[float] = collections.deque(maxlen=_WINDOW_SIZE)
        self._skip_interval = 1
        self._frames_since_last_inference = 0
        self._cooldown_remaining = 0
        self._cooldown_ticks = 10

    @property
    def skip_interval(self) -> int:
        return self._skip_interval

    def should_process(self) -> bool:
        """Return True if the current frame should be processed."""
        if not self._enabled:
            return True
        self._frames_since_last_inference += 1
        if self._frames_since_last_inference >= self._skip_interval:
            self._frames_since_last_inference = 0
            return True
        return False

    def report_inference(self, inference_duration_ms: float, source_fps: float) -> None:
        """Feed inference timing to update the skip interval."""
        if not self._enabled or source_fps <= 0:
            return

        time_budget_ms = (1000.0 / source_fps) * self._skip_interval
        load_ratio = inference_duration_ms / time_budget_ms if time_budget_ms > 0 else 1.0
        self._load_history.append(load_ratio)

        if len(self._load_history) < 5:
            return

        avg_load = sum(self._load_history) / len(self._load_history)
        prev_skip = self._skip_interval

        if avg_load > self._high_threshold and self._skip_interval < self._max_skip:
            self._skip_interval += 1
            self._cooldown_remaining = self._cooldown_ticks
            self._load_history.clear()
            logger.info(
                "Adaptive rate: load %.2f > %.2f, skip_interval %d -> %d",
                avg_load, self._high_threshold, prev_skip, self._skip_interval,
            )
        elif avg_load < self._low_threshold and self._skip_interval > 1:
            if self._cooldown_remaining > 0:
                self._cooldown_remaining -= 1
            else:
                self._skip_interval -= 1
                self._cooldown_remaining = self._cooldown_ticks
                self._load_history.clear()
                logger.info(
                    "Adaptive rate: load %.2f < %.2f, skip_interval %d -> %d",
                    avg_load, self._low_threshold, prev_skip, self._skip_interval,
                )

    def reset(self) -> None:
        """Reset state (e.g. on stream switch)."""
        self._load_history.clear()
        self._skip_interval = 1
        self._frames_since_last_inference = 0
        self._cooldown_remaining = 0
