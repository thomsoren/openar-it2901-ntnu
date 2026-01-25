"""Computer vision pipeline package."""

import os

# Reduce FFmpeg warnings emitted by OpenCV video decoding.
os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "error")
