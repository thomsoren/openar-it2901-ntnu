"""CV detector and tracker configuration."""
import os
from pathlib import Path

# Detector device: "cuda", "mps" (Mac Metal), "cpu", or "" for auto (CUDA > MPS > CPU)
DETECTOR_DEVICE = (os.getenv("DETECTOR_DEVICE") or "").strip().lower() or None

# Detector settings
CONFIDENCE = 0.35  # Minimum confidence for raw detections
IOU_THRESHOLD = 0.3
AGNOSTIC_NMS = True
MODEL_INPUT_SIZE = 640  # pixels, must match RT-DETR training resolution

# ByteTrack settings (SSOT — bytetrack.yaml is generated from these at startup)
TRACK_HIGH_THRESH = 0.5  # High-confidence detection matching threshold
TRACK_LOW_THRESH = 0.2  # Low-confidence detection matching threshold
NEW_TRACK_THRESH = 0.6  # Confidence required to create a new track
TRACK_BUFFER = 30  # Frames to keep lost/unmatched tracks before discarding
MATCH_THRESH = 0.8  # IoU similarity threshold for track-to-detection matching
FUSE_SCORE = True  # Fuse detection confidence into IoU distance

# Path to ByteTrack YAML config (generated from constants above)
BYTETRACK_YAML = Path(__file__).parent / "bytetrack.yaml"


def write_bytetrack_yaml() -> None:
    """Write bytetrack.yaml from the constants above so the YAML never drifts."""
    content = (
        f"tracker_type: bytetrack\n"
        f"track_high_thresh: {TRACK_HIGH_THRESH}\n"
        f"track_low_thresh: {TRACK_LOW_THRESH}\n"
        f"new_track_thresh: {NEW_TRACK_THRESH}\n"
        f"track_buffer: {TRACK_BUFFER}\n"
        f"match_thresh: {MATCH_THRESH}\n"
        f"fuse_score: {'true' if FUSE_SCORE else 'false'}\n"
    )
    BYTETRACK_YAML.write_text(content)

# Decode thread defaults
DEFAULT_FPS = 25.0  # Fallback when source FPS is unavailable or invalid
INITIAL_RECONNECT_BACKOFF_SEC = 0.5
MAX_RECONNECT_BACKOFF_SEC = 8.0
