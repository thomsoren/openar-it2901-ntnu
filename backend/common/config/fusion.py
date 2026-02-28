"""Sensor fusion configuration — all relevant env vars centralised here.

Import these constants instead of calling os.getenv() directly in domain modules.
"""
from __future__ import annotations

from settings._env import get_bool, get_float, get_str

# Path to a pre-recorded AIS NDJSON session log.
# Relative paths are resolved against BASE_DIR at call time.
AUTO_FUSION_AIS_LOG: str | None = get_str("AUTO_FUSION_AIS_LOG", "") or None

# ISO-8601 UTC datetime for frame 0 of the video; defaults to now() if unset.
AUTO_FUSION_VIDEO_EPOCH_UTC: str | None = get_str("AUTO_FUSION_VIDEO_EPOCH_UTC", "") or None

# How many seconds either side of query time to consider an AIS record.
AUTO_FUSION_TIME_WINDOW_S: float = get_float("AUTO_FUSION_TIME_WINDOW_S", 10.0)

# Whether to include AIS records with no matching detection.
AUTO_FUSION_INCLUDE_UNMATCHED: bool = get_bool("AUTO_FUSION_INCLUDE_UNMATCHED", default=False)

# Maximum pixel distance to accept a detection-to-AIS match.
FUSION_MAX_MATCH_PX: float = get_float("FUSION_MAX_MATCH_PX", 500.0)
