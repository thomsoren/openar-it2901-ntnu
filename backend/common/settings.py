"""
Shared configuration and path resolution.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv

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

# S3 configuration (coded in, only secrets in env)
S3_ENDPOINT = "https://hel1.your-objectstorage.com"
S3_REGION = "hel1"
S3_BUCKET = "bridgable"
S3_PREFIX = "openar"
S3_ALLOWED_PREFIXES = ["fvessel", "detection", "image", "video"]

S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "").strip()
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "").strip()
S3_PUBLIC_BASE_URL = os.getenv("S3_PUBLIC_BASE_URL", "").strip()
S3_PRESIGN_EXPIRES = int(os.getenv("S3_PRESIGN_EXPIRES", "900"))
DETECTIONS_WS_MODE = os.getenv("DETECTIONS_WS_MODE", "live").strip().lower()

# S3 object keys (relative to S3_PREFIX)
VIDEO_S3_KEY = "video/hurtigruta-demo.mp4"
FUSION_VIDEO_S3_KEY = (
    "fvessel/segment-001/"
    "2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4"
)
COMPONENTS_BG_S3_KEY = "image/oceanbackground.png"
AIS_S3_KEY = "fvessel/video-01/segment-001/ais.csv"
GT_FUSION_S3_KEY = "fvessel/video-01/segment-001/Video-01_gt_fusion.txt"
DETECTIONS_S3_KEY = "detection/detections_yolo.json"


def _resolve_sample_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value)
    return path if path.is_absolute() else (BASE_DIR / path)


def _load_sample(sample_id: str | None) -> dict | None:
    if not SAMPLES_CONFIG_PATH.exists():
        return None
    try:
        data = json.loads(SAMPLES_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    samples = data.get("samples", [])
    if not samples:
        return None

    if sample_id:
        for sample in samples:
            if sample.get("id") == sample_id:
                return sample

    return samples[0]


def load_samples() -> list[dict]:
    if not SAMPLES_CONFIG_PATH.exists():
        return []
    try:
        data = json.loads(SAMPLES_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data.get("samples", [])


def resolve_local_path(
    sample_path: Path | None,
    default_path: Path | None,
) -> Path | None:
    if sample_path and sample_path.exists():
        return sample_path
    return default_path


SAMPLE = _load_sample(None)
SAMPLE_VIDEO_PATH = _resolve_sample_path(SAMPLE.get("video_path") if SAMPLE else None)
SAMPLE_AIS_PATH = _resolve_sample_path(SAMPLE.get("ais_path") if SAMPLE else None)
SAMPLE_GT_FUSION_PATH = _resolve_sample_path(SAMPLE.get("gt_fusion_path") if SAMPLE else None)
SAMPLE_START_SEC = int(SAMPLE["start_sec"]) if SAMPLE else None
SAMPLE_END_SEC = int(SAMPLE["end_sec"]) if SAMPLE else None
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
