## CV Module Overview

This folder contains the computer vision pipeline for stream decoding, detection/tracking, and publishing.

## What Each File Does


- `config.py`: Stores shared detector and ByteTrack tuning values.
- `decode_thread.py`: Continuously reads and decodes video frames, keeping the newest frame ready for inference.
- `detectors.py`: Loads RT-DETR and converts frames into boat detections (optionally with tracking IDs).
- `inference_thread.py`: Pulls latest frames from running streams, runs batched detection, applies per-stream tracking, and publishes results.
- `publisher.py`: Publishes detection payloads to Redis pub/sub channels.
- `ffmpeg.py`: Runs FFmpeg as a subprocess to publish source video to MediaMTX (copy when possible, transcode otherwise).
- `utils.py`: Helper for reading video metadata (width, height, fps, total frames).
- `bytetrack.yaml`: ByteTrack parameter file used by Ultralytics tracking mode.



