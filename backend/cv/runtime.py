"""Runtime tuning for CV threads."""
from __future__ import annotations

from settings import cv_runtime_settings

STREAM_MAX_CATCHUP_SKIP = cv_runtime_settings.stream_max_catchup_skip
STREAM_MAX_RECONNECT_ATTEMPTS = cv_runtime_settings.stream_max_reconnect_attempts

INFERENCE_WAIT_NO_STREAM_SEC = cv_runtime_settings.inference_wait_no_stream_sec
INFERENCE_WAIT_NO_FRAME_SEC = cv_runtime_settings.inference_wait_no_frame_sec
