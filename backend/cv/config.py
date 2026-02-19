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

# Publish and runtime settings
DEFAULT_VIDEO_FPS = 25.0
PUBLISH_HZ_OVERRIDE: float | None = None  # None -> derive from source video FPS
MIN_PUBLISH_HZ = 1.0
FRAME_QUEUE_SECONDS = 2.0
FRAME_QUEUE_MIN_SIZE = 30
WORKER_WATCHDOG_INTERVAL_SEC = 1.0

# Correction pipeline settings
SHORT_PERSISTENCE_HOLD_SECONDS = 0.5

# Long-lived persistence settings (legacy but might bring back)
LONG_PERSIST_MIN_ALIVE_SECONDS = 5.0
LONG_PERSIST_SECONDS = 10.0
LONG_PERSIST_EDGE_MARGIN_PX = 80

# Prediction settings
PREDICTION_MAX_AGE_SEC = 12.0
PREDICTION_MAX_DT_SEC = 0.20
PREDICTION_MAX_SPEED_PX_PER_SEC = 700.0
PREDICTION_MIN_VEL_DT_SEC = 0.05
PREDICTION_POS_ALPHA = 0.35
PREDICTION_SIZE_ALPHA = 0.25
PREDICTION_VEL_ALPHA = 0.30
PREDICTION_VELOCITY_DECAY_PER_SEC = 0.85
PREDICTION_CONFIDENCE_DECAY = 0.9

# Smoothing / dedup settings
DEDUP_TRACK_MAX_AGE_SEC = 1.5
DEDUP_DUPLICATE_IOU = 0.60
DEDUP_DUPLICATE_CENTER_FACTOR = 0.45
DEDUP_DUPLICATE_MIN_CENTER_PX = 40.0
DEDUP_MATCH_GATE_MIN_PX = 20.0
DEDUP_MATCH_GATE_FACTOR = 0.8
