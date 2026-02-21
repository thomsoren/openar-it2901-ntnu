# OpenAR Backend

Python backend for boat detection on video using Roboflow Inference, with FastAPI endpoints for serving detections and video to the frontend.

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

## S3 Storage (Hetzner)

The backend can fetch assets from S3-compatible storage and generate presigned
URLs for frontend upload/download. Only these values are configured via
`backend/.env`:

- `S3_ACCESS_KEY` / `S3_SECRET_KEY`
- `S3_PUBLIC_BASE_URL` (optional public base)
- `S3_PRESIGN_EXPIRES` (seconds)

Bucket/region/prefix and object keys are coded in `backend/common/settings.py`.

When S3 keys are provided, `/api/video`, `/api/video/fusion`, and
`/api/assets/oceanbackground` redirect to S3. To let the frontend upload or
download arbitrary objects, call:

```bash
curl -X POST http://localhost:8000/api/storage/presign \
  -H "Content-Type: application/json" \
  -d '{"key":"video/example.mp4","method":"PUT","content_type":"video/mp4"}'
```

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

**"error: externally-managed-environment" or missing `lap`**
- Install deps with `uv sync` from `backend/` (includes `lap`)
- Run scripts via `uv run ...` so they use the managed environment

## FastAPI Server

The backend includes a FastAPI server that serves detections and video to the frontend.






### Configure backend/frontend env

In `backend/.env`:

```bash
MEDIAMTX_ENABLED=true
MEDIAMTX_RTSP_BASE=rtsp://localhost:8554
MEDIAMTX_WHEP_BASE=http://localhost:8889
MEDIAMTX_HLS_BASE=http://localhost:8888
```

In `frontend/.env`:

```bash
VITE_MEDIAMTX_WHEP_BASE=http://localhost:8889
VITE_MEDIAMTX_HLS_BASE=http://localhost:8888
```

### Run app

From repo root:

```bash
pnpm dev
```

Then verify stream playback URLs from backend:

```bash
curl http://localhost:8000/api/streams/default/playback
```

You should see `whep_url` and `hls_url`.

### Quick troubleshooting

- `zsh: no such file or directory: <backend-compose-file>`:
  Use the real compose path, not placeholders.
- `docker compose ...` appears to hang:
  Usually Docker Desktop is not fully started yet.
- No containers in `docker compose ... ps`:
  Start with `up -d` first.
- Chrome latency much higher than Safari:
  Confirm UI status says `Video: WEBRTC`; if it says `HLS`, you are on fallback.

### Stop MediaMTX

```bash
docker compose -f backend/streaming/mediamtx/docker-compose.mediamtx.yml down
```

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
    "detections": {
      "path": "/path/to/detections.json",
      "exists": true,
      "size_mb": 1.32
    },
    "video": {
      "path": "/path/to/video.mp4",
      "exists": true,
      "size_mb": 59.0
    }
  }
}
```

#### Get Detections
```bash
GET /api/detections
```

Returns all boat detections from `data/raw/detections.json`.

**Example:**
```bash
curl http://localhost:8000/api/detections
```

**Response:** Array of detection frames
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

#### Stream Video
```bash
GET /api/video
GET /api/video/stream
GET /api/video/fusion
```

#### Assets
```bash
GET /api/assets/oceanbackground
```

Streams the video file from `data/processed/video/` with support for seeking.

**Example:**
```html
<video src="http://localhost:8000/api/video" controls />
```

### CORS Configuration

The API is configured to accept requests from:
- `http://localhost:5173` (Vite dev server)
- `http://localhost:3000` (Alternative React dev server)
- `http://127.0.0.1:5173`
- `http://127.0.0.1:3000`

## Samples (FVessel)

Samples are defined in `fusion/samples.json` and are used for AIS + Datavision
streaming. Available samples can be listed via:

```
GET /api/samples
```

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
