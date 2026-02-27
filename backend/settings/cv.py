from __future__ import annotations

from dataclasses import dataclass, field

from settings._env import get_float, get_int


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


cv_runtime_settings = CVRuntimeSettings()
