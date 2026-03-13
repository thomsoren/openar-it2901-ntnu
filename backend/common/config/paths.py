"""Path configuration for the backend."""
from pathlib import Path

from dotenv import load_dotenv
from settings._env import get_str

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(dotenv_path=BASE_DIR / ".env")

# Directories
MODELS_DIR = BASE_DIR / "models"
SAMPLES_CONFIG_PATH = BASE_DIR / "mock_stream" / "samples.json"

# Default video paths (local fallback)
_default_video_filename = get_str("DEFAULT_VIDEO_FILENAME", "recording.mp4")
DEFAULT_VIDEO_PATH = BASE_DIR / "data" / "raw" / "video" / _default_video_filename
DEFAULT_FUSION_VIDEO_PATH = (
    BASE_DIR / "data" / "raw" / "fvessel" / "video-01" / "segment-001"
    / "2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4"
)
DEFAULT_COMPONENTS_BG_PATH = BASE_DIR / "data" / "raw" / "oceanbackground.png"
DEFAULT_DETECTIONS_PATH = BASE_DIR / "output" / "detections.json"
