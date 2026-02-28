"""IDUN remote inference configuration."""
from __future__ import annotations

import os

IDUN_ENABLED = os.getenv("IDUN_ENABLED", "false").lower() in {"1", "true", "yes"}
IDUN_API_KEY = os.getenv("IDUN_API_KEY", "")

# JPEG quality for encoding frames sent to IDUN (0-100, higher = better quality, larger size)
IDUN_FRAME_JPEG_QUALITY = int(os.getenv("IDUN_FRAME_JPEG_QUALITY", "80"))

# Target FPS for sending frames to IDUN (limits bandwidth usage)
IDUN_TARGET_SEND_FPS = float(os.getenv("IDUN_TARGET_SEND_FPS", "15.0"))

# Seconds without a heartbeat before considering the IDUN worker dead
IDUN_HEARTBEAT_TIMEOUT_S = float(os.getenv("IDUN_HEARTBEAT_TIMEOUT_S", "90.0"))
