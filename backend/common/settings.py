"""
Shared configuration and path resolution.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(dotenv_path=BASE_DIR / ".env")

# File paths (local fallback)
DEFAULT_VIDEO_PATH = BASE_DIR / "data" / "raw" / "video" / "hurtigruta-demo.mp4"
DEFAULT_FUSION_VIDEO_PATH = (
    BASE_DIR
    / "data"
    / "raw"
    / "fvessel"
    / "video-01"
    / "segment-001"
    / "2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4"
)
DEFAULT_COMPONENTS_BG_PATH = BASE_DIR / "data" / "raw" / "oceanbackground.png"
DEFAULT_DETECTIONS_PATH = BASE_DIR / "output" / "detections.json"
SAMPLES_CONFIG_PATH = BASE_DIR / "fusion" / "samples.json"
MODELS_DIR = BASE_DIR / "cv" / "models"
DETECTIONS_WS_MODE = os.getenv("DETECTIONS_WS_MODE", "file").strip().lower()


class SampleConfig(BaseModel):
    id: str
    label: str
    video_path: Optional[str] = None
    ais_path: Optional[str] = None
    gt_fusion_path: Optional[str] = None
    start_sec: int = 0
    end_sec: int = 0
    description: Optional[str] = None


class S3Config(BaseModel):
    endpoint: str = "https://hel1.your-objectstorage.com"
    region: str = "hel1"
    bucket: str = "bridgable"
    prefix: str = "openar"
    allowed_prefixes: List[str] = ["fvessel", "detection", "image", "video"]
    access_key: str = Field(default_factory=lambda: os.getenv("S3_ACCESS_KEY", "").strip())
    secret_key: str = Field(default_factory=lambda: os.getenv("S3_SECRET_KEY", "").strip())
    public_base_url: str = Field(default_factory=lambda: os.getenv("S3_PUBLIC_BASE_URL", "").strip())
    presign_expires: int = Field(default_factory=lambda: int(os.getenv("S3_PRESIGN_EXPIRES", "900")))


# S3 configuration
s3_config = S3Config()

# Backwards compatibility constants
S3_ENDPOINT = s3_config.endpoint
S3_REGION = s3_config.region
S3_BUCKET = s3_config.bucket
S3_PREFIX = s3_config.prefix
S3_ALLOWED_PREFIXES = s3_config.allowed_prefixes
S3_ACCESS_KEY = s3_config.access_key
S3_SECRET_KEY = s3_config.secret_key
S3_PUBLIC_BASE_URL = s3_config.public_base_url
S3_PRESIGN_EXPIRES = s3_config.presign_expires

# S3 object keys (relative to s3_config.prefix)
VIDEO_S3_KEY = "video/hurtigruta-demo.mp4"
FUSION_VIDEO_S3_KEY = (
    "fvessel/segment-001/"
    "2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4"
)
COMPONENTS_BG_S3_KEY = "image/oceanbackground.png"
AIS_S3_KEY = "fvessel/segment-001/ais.csv"
GT_FUSION_S3_KEY = "fvessel/segment-001/Video-01_gt_fusion.txt"
DETECTIONS_S3_KEY = "detection/detections_yolo.json"


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
    
    samples_raw = data.get("samples", [])
    return [SampleConfig(**s) for s in samples_raw]


def _load_sample(sample_id: str | None) -> SampleConfig | None:
    samples = load_samples()
    if not samples:
        return None

    if sample_id:
        for sample in samples:
            if sample.id == sample_id:
                return sample

    return samples[0]


def resolve_local_path(
    sample_path: Path | None,
    default_path: Path | None,
) -> Path | None:
    if sample_path and sample_path.exists():
        return sample_path
    return default_path


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
SAMPLE_START_MONO = time.monotonic()


def reset_sample_timer() -> float:
    """Reset sample timing so detections sync with video playback start."""
    global SAMPLE_START_MONO
    SAMPLE_START_MONO = time.monotonic()
    return SAMPLE_START_MONO


VIDEO_PATH = resolve_local_path(SAMPLE_VIDEO_PATH, DEFAULT_VIDEO_PATH)
FUSION_VIDEO_PATH = resolve_local_path(SAMPLE_VIDEO_PATH, DEFAULT_FUSION_VIDEO_PATH)
COMPONENTS_BG_PATH = resolve_local_path(None, DEFAULT_COMPONENTS_BG_PATH)
AIS_SAMPLE_PATH = resolve_local_path(SAMPLE_AIS_PATH, None)
GT_FUSION_PATH = resolve_local_path(SAMPLE_GT_FUSION_PATH, None)
DETECTIONS_PATH = resolve_local_path(None, DEFAULT_DETECTIONS_PATH)
