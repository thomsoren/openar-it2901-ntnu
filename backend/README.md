# OpenAR Backend - Boat Detection

Python backend for testing boat detection on video using Roboflow Inference locally.

## Quick Start

### 1. Start Inference Server
```bash
cd backend
uv run inference server start
```

Wait for the Docker image to download (first time only, ~5 minutes).

### 2. Set API Key
```bash
export ROBOFLOW_API_KEY=your_roboflow_api_key
```

Get your API key from: https://app.roboflow.com/settings/api

### 3. Run Detection
```bash
uv run detect_boats.py
```

## Detailed Setup

### Install Dependencies
```bash
uv sync
```

This installs:
- `inference` - Roboflow Inference SDK
- `supervision` - Computer vision utilities
- `opencv-python` - Video processing
- And other dependencies

## What It Does

1. Connects to the local Inference server at `http://localhost:9001`
2. Opens the video: `../data/processed/video/Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4`
3. Processes every 5th frame (configurable) to detect boats using `boat-detection-model/1`
4. Draws bounding boxes on detected boats
5. Saves:
   - **`output/detected_boats.mp4`** - Video with bounding boxes
   - **`output/detections.json`** - All detection data (coordinates, confidence, timestamps)

## Output Format

### detections.json
```json
[
  {
    "frame": 5,
    "timestamp": 0.2,
    "detections": [
      {
        "x": 540,
        "y": 360,
        "width": 120,
        "height": 80,
        "confidence": 0.87,
        "class": "boat"
      }
    ]
  }
]
```

## Configuration

Edit `detect_boats.py` to adjust:

- `VIDEO_PATH` - Path to input video
- `MODEL_ID` - Roboflow model ID (default: `boat-detection-model/1`)
- `process_every_n_frames` - Process every Nth frame (default: 5 for speed)

## Troubleshooting

**"Could not connect to inference server"**
- Make sure Docker is running
- Start the inference server: `inference server start`
- Check server is running: `curl http://localhost:9001/`

**"Could not open video"**
- Check the video path is correct
- Video should be at: `../data/processed/video/Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4`

**No boats detected**
- Check your API key is set correctly
- Try processing more frames (reduce `process_every_n_frames`)
- Model may not detect boats in all frames/angles

## Next Steps

Once detection is working:
1. Use `detections.json` to understand detection patterns
2. Integrate detection coordinates into React frontend
3. Position POI targets based on detection data
