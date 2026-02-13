"""Sample configuration for FVessel dataset."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from .paths import BASE_DIR, SAMPLES_CONFIG_PATH, DEFAULT_VIDEO_PATH, DEFAULT_FUSION_VIDEO_PATH, DEFAULT_COMPONENTS_BG_PATH, DEFAULT_DETECTIONS_PATH


class SampleConfig(BaseModel):
    id: str
    label: str
    video_path: Optional[str] = None
    ais_path: Optional[str] = None
    gt_fusion_path: Optional[str] = None
    start_sec: int = 0
    end_sec: int = 0
    description: Optional[str] = None


def _resolve_sample_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value)
    return path if path.is_absolute() else (BASE_DIR / path)


def load_samples() -> list[SampleConfig]:
    if not SAMPLES_CONFIG_PATH.exists():
        return []
    try:
        data = json.loads(SAMPLES_CONFIG_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return [SampleConfig(**s) for s in data.get("samples", [])]


def _load_sample(sample_id: str | None) -> SampleConfig | None:
    samples = load_samples()
    if not samples:
        return None
    if sample_id:
        for sample in samples:
            if sample.id == sample_id:
                return sample
    return samples[0]


def _resolve_local_path(sample_path: Path | None, default_path: Path | None) -> Path | None:
    if sample_path and sample_path.exists():
        return sample_path
    return default_path


# Load default sample on import
SAMPLE = _load_sample(None)
SAMPLE_VIDEO_PATH = _resolve_sample_path(SAMPLE.video_path if SAMPLE else None)
SAMPLE_AIS_PATH = _resolve_sample_path(SAMPLE.ais_path if SAMPLE else None)
SAMPLE_GT_FUSION_PATH = _resolve_sample_path(SAMPLE.gt_fusion_path if SAMPLE else None)
SAMPLE_START_SEC = SAMPLE.start_sec if SAMPLE else None
SAMPLE_END_SEC = SAMPLE.end_sec if SAMPLE else None
SAMPLE_DURATION = (
    (SAMPLE_END_SEC - SAMPLE_START_SEC + 1)
    if SAMPLE_START_SEC is not None and SAMPLE_END_SEC is not None
    else None
)

# Resolved paths (sample or default)
VIDEO_PATH = _resolve_local_path(SAMPLE_VIDEO_PATH, DEFAULT_VIDEO_PATH)
FUSION_VIDEO_PATH = _resolve_local_path(SAMPLE_VIDEO_PATH, DEFAULT_FUSION_VIDEO_PATH)
COMPONENTS_BG_PATH = _resolve_local_path(None, DEFAULT_COMPONENTS_BG_PATH)
AIS_SAMPLE_PATH = _resolve_local_path(SAMPLE_AIS_PATH, None)
GT_FUSION_PATH = _resolve_local_path(SAMPLE_GT_FUSION_PATH, None)
DETECTIONS_PATH = _resolve_local_path(None, DEFAULT_DETECTIONS_PATH)
