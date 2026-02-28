"""S3 configuration."""
from settings._env import get_int, get_str

# S3 connection settings
S3_ENDPOINT = get_str("S3_ENDPOINT", "https://hel1.your-objectstorage.com")
S3_REGION = get_str("S3_REGION", "hel1")
S3_BUCKET = get_str("S3_BUCKET", "bridgable")
S3_PREFIX = get_str("S3_PREFIX", "openar")
S3_ALLOWED_PREFIXES = ["fvessel", "detection", "image", "video"]
S3_ACCESS_KEY = get_str("S3_ACCESS_KEY", "")
S3_SECRET_KEY = get_str("S3_SECRET_KEY", "")
S3_PUBLIC_BASE_URL = get_str("S3_PUBLIC_BASE_URL", "")
S3_PRESIGN_EXPIRES = get_int("S3_PRESIGN_EXPIRES", 900)

# S3 object keys (relative to S3_PREFIX)
VIDEO_S3_KEY = "video/hurtigruta-demo.mp4"
FUSION_VIDEO_S3_KEY = "fvessel/segment-001/2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4"
COMPONENTS_BG_S3_KEY = "image/oceanbackground.png"
AIS_S3_KEY = "fvessel/segment-001/ais.csv"
GT_FUSION_S3_KEY = "fvessel/segment-001/Video-01_gt_fusion.txt"
DETECTIONS_S3_KEY = "detection/detections_yolo.json"
