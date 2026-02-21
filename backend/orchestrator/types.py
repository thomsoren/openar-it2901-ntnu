"""Types for stream worker orchestration."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from multiprocessing import Process, Queue
from queue import Empty, Full

from pydantic import BaseModel, Field


class StreamConfig(BaseModel):
    """Runtime configuration for one stream worker."""

    stream_id: str = Field(..., min_length=1, pattern=r"^[a-zA-Z0-9_-]+$")
    source_url: str = Field(..., min_length=1)
    loop: bool = True


@dataclass
class WorkerHandle:
    """Handle for a managed worker process."""

    process: Process
    inference_queue: Queue
    config: StreamConfig
    started_at: float = field(default_factory=time.monotonic)
    last_heartbeat: float = field(default_factory=time.monotonic)
    restart_count: int = 0
    backoff_seconds: float = 1.0
    next_restart_at: float = 0.0
    last_exitcode: int | None = None
    viewer_count: int = 0
    no_viewer_since: float = 0.0

    @property
    def is_alive(self) -> bool:
        return self.process.is_alive()

    def terminate(self):
        # Unblock API consumers waiting on queue.get() before terminating process.
        try:
            self.inference_queue.put_nowait(None)
        except Full:
            try:
                self.inference_queue.get_nowait()
                self.inference_queue.put_nowait(None)
            except (Empty, Full):
                pass
        except Exception:
            pass

        if self.process.is_alive():
            self.process.terminate()
            self.process.join(timeout=5)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=1)

    def to_dict(self) -> dict:
        return {
            "stream_id": self.config.stream_id,
            "source_url": self.config.source_url,
            "loop": self.config.loop,
            "status": "running" if self.is_alive else "stopped",
            "pid": self.process.pid,
            "started_at_monotonic": self.started_at,
            "restart_count": self.restart_count,
            "backoff_seconds": self.backoff_seconds,
            "next_restart_at_monotonic": self.next_restart_at,
            "last_exitcode": self.last_exitcode,
            "viewer_count": self.viewer_count,
        }
