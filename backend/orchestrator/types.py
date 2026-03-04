"""Types for stream worker orchestration."""
from __future__ import annotations

import logging
import subprocess
import time
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from cv.decode_thread import DecodeThread
from settings.app import app_settings

logger = logging.getLogger(__name__)


class StreamConfig(BaseModel):
    """Runtime configuration for one stream worker."""

    stream_id: str = Field(..., min_length=1, pattern=app_settings.stream_id_pattern.pattern)
    source_url: str = Field(..., min_length=1)
    loop: bool = True


@dataclass
class StreamHandle:
    """Handle for a managed stream — decode thread + FFmpeg subprocess."""

    decode_thread: DecodeThread
    config: StreamConfig
    ffmpeg_process: subprocess.Popen | None = None
    started_at: float = field(default_factory=time.monotonic)
    last_heartbeat: float = field(default_factory=time.monotonic)
    restart_count: int = 0
    backoff_seconds: float = 1.0
    next_restart_at: float = 0.0
    last_exitcode: int | None = None
    viewer_count: int = 0
    no_viewer_since: float = 0.0
    warm_until: float = 0.0

    @property
    def is_alive(self) -> bool:
        return self.decode_thread.is_alive

    def terminate(self) -> None:
        if self.ffmpeg_process:
            try:
                self.ffmpeg_process.terminate()
                self.ffmpeg_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                try:
                    self.ffmpeg_process.kill()
                except OSError as exc:
                    logger.debug("Failed to kill FFmpeg for stream '%s': %s", self.config.stream_id, exc)
            self.ffmpeg_process = None

        self.decode_thread.stop()

    def to_dict(self) -> dict:
        ffmpeg_alive = self.ffmpeg_process is not None and self.ffmpeg_process.poll() is None
        return {
            "stream_id": self.config.stream_id,
            "source_url": self.config.source_url,
            "loop": self.config.loop,
            "status": "running" if self.is_alive else "stopped",
            "ffmpeg_pid": self.ffmpeg_process.pid if self.ffmpeg_process else None,
            "ffmpeg_alive": ffmpeg_alive,
            "started_at_monotonic": self.started_at,
            "restart_count": self.restart_count,
            "backoff_seconds": self.backoff_seconds,
            "next_restart_at_monotonic": self.next_restart_at,
            "last_exitcode": self.last_exitcode,
            "viewer_count": self.viewer_count,
            "warm_until_monotonic": self.warm_until,
        }
