from __future__ import annotations

from orchestrator import WorkerOrchestrator
from settings import app_settings

MAX_WORKERS = app_settings.max_workers
STREAM_IDLE_TIMEOUT_SECONDS = app_settings.stream_idle_timeout_seconds
STREAM_NO_VIEWER_TIMEOUT_SECONDS = app_settings.stream_no_viewer_timeout_seconds
DEFAULT_STREAM_ID = app_settings.default_stream_id
PROTECT_DEFAULT_STREAM = app_settings.protect_default_stream
STREAM_ID_PATTERN = app_settings.stream_id_pattern

orchestrator: WorkerOrchestrator | None = None
