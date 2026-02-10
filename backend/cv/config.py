"""CV detector and tracker configuration."""
from pathlib import Path

# Detector settings
CONFIDENCE = 0.15  # Lower to catch marginal detections, ByteTrack filters false positives
IOU_THRESHOLD = 0.3
AGNOSTIC_NMS = True

# ByteTrack settings
TRACK_HIGH_THRESH = 0.5
TRACK_LOW_THRESH = 0.1
NEW_TRACK_THRESH = 0.6
TRACK_BUFFER = 60  # Frames to keep lost tracks
MATCH_THRESH = 0.8

# Path to ByteTrack YAML config (required by Ultralytics)
BYTETRACK_YAML = Path(__file__).parent / "bytetrack.yaml"
