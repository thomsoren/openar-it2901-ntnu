# OpenAR Backend

Python backend for boat detection using Roboflow Inference, with FastAPI endpoints for streaming MJPEG video and live detections to the frontend.

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

### 3. Run Detection (Offline Script)
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
2. Runs the detector on the source video using `boat-detection-model/1`
3. Draws bounding boxes on detected boats
4. Saves:
   - **`output/detected_boats.mp4`** - Video with bounding boxes

## Output Format

### detections.json (offline script)
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

## FastAPI Server

The backend includes a FastAPI server that serves detections and video to the frontend.

### Starting the API Server

```bash
cd backend

# Install dependencies (including FastAPI)
uv sync

# Run the API server
uv run python api.py
```

The server will start at `http://localhost:8000`

### API Endpoints

#### Health Check
```bash
GET /
GET /health
```

Returns server status and file availability.

**Example:**
```bash
curl http://localhost:8000/health
```

**Response:**
```json
{
  "status": "healthy",
  "files": {
    "video": {
      "path": "/path/to/video.mp4",
      "exists": true,
      "size_mb": 59.0
    }
  }
}
```

#### Stream Detections (SSE)
```bash
GET /api/detections/stream
```

**Example:**
```bash
curl -N http://localhost:8000/api/detections/stream
```

**Response:** SSE stream of detection frames

#### Stream Video (MJPEG)
```bash
GET /api/video/mjpeg
```

Streams MJPEG frames from the shared frame source.

### CORS Configuration

The API is configured to accept requests from:
- `http://localhost:5173` (Vite dev server)
- `http://localhost:3000` (Alternative React dev server)
- `http://127.0.0.1:5173`
- `http://127.0.0.1:3000`

### API Documentation

Once the server is running, visit:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Running with Uvicorn Directly

For production or custom configuration:

```bash
# Basic
uvicorn api:app --reload

# Custom host and port
uvicorn api:app --host 0.0.0.0 --port 8000 --reload

# Production (no reload)
uvicorn api:app --host 0.0.0.0 --port 8000 --workers 4
```

### Using the API with Frontend

The React frontend is configured to use these endpoints. Update the frontend `.env` file:

```bash
# In react-demo/.env
VITE_API_URL=http://localhost:8000
```

## Next Steps

Once detection is working:
1. Start the FastAPI server: `uv run python api.py`
2. Start the React frontend (see react-demo/README.md)
3. The frontend will automatically fetch detections and video from the API
