from __future__ import annotations

import re
from dataclasses import dataclass, field
from re import Pattern

from settings._env import get_bool, get_float, get_int, get_str


@dataclass(frozen=True)
class AppSettings:
    max_workers: int = field(default_factory=lambda: get_int("MAX_WORKERS", 8, minimum=1))
    stream_idle_timeout_seconds: float = field(
        default_factory=lambda: get_float("STREAM_IDLE_TIMEOUT_SECONDS", 300.0, minimum=0.0)
    )
    stream_no_viewer_timeout_seconds: float = field(
        default_factory=lambda: get_float("STREAM_NO_VIEWER_TIMEOUT_SECONDS", 15.0, minimum=0.0)
    )
    stream_warm_lease_seconds: float = field(
        default_factory=lambda: get_float("STREAM_WARM_LEASE_SECONDS", 30.0, minimum=0.0)
    )
    default_stream_id: str = field(default_factory=lambda: get_str("DEFAULT_STREAM_ID", "default"))
    protect_default_stream: bool = field(default_factory=lambda: get_bool("PROTECT_DEFAULT_STREAM", False))
    skip_default_stream: bool = field(default_factory=lambda: get_bool("SKIP_DEFAULT_STREAM", False))
    stream_id_pattern: Pattern[str] = field(
        default_factory=lambda: re.compile(r"^[A-Za-z0-9_-]{1,64}$")
    )


app_settings = AppSettings()
