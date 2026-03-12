from __future__ import annotations

from dataclasses import dataclass, field

from settings._env import get_bool, get_float, get_int


@dataclass(frozen=True)
class CVRuntimeSettings:
    stream_max_catchup_skip: int = field(
        default_factory=lambda: get_int("STREAM_MAX_CATCHUP_SKIP", 8, minimum=1)
    )
    stream_max_reconnect_attempts: int = field(
        default_factory=lambda: get_int("STREAM_MAX_RECONNECT_ATTEMPTS", 30, minimum=1)
    )
    inference_wait_no_stream_sec: float = field(
        default_factory=lambda: get_float("CV_INFERENCE_WAIT_NO_STREAM_SEC", 0.01, minimum=0.001)
    )
    inference_wait_no_frame_sec: float = field(
        default_factory=lambda: get_float("CV_INFERENCE_WAIT_NO_FRAME_SEC", 0.005, minimum=0.001)
    )
    inference_batch_fill_timeout_sec: float = field(
        default_factory=lambda: get_float("CV_INFERENCE_BATCH_FILL_TIMEOUT_SEC", 0.02, minimum=0.0)
    )
    adaptive_rate_enabled: bool = field(
        default_factory=lambda: get_bool("ADAPTIVE_RATE_ENABLED", True)
    )
    adaptive_rate_max_skip: int = field(
        default_factory=lambda: get_int("ADAPTIVE_RATE_MAX_SKIP", 4, minimum=1)
    )
    adaptive_rate_high_load_threshold: float = field(
        default_factory=lambda: get_float("ADAPTIVE_RATE_HIGH_LOAD_THRESHOLD", 0.85, minimum=0.1)
    )
    adaptive_rate_low_load_threshold: float = field(
        default_factory=lambda: get_float("ADAPTIVE_RATE_LOW_LOAD_THRESHOLD", 0.6, minimum=0.05)
    )


cv_runtime_settings = CVRuntimeSettings()
