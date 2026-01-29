# Backend Architecture

## Overview

The OpenAR backend is a Python FastAPI application that provides:
- Real-time boat detection streaming via WebSocket
- Precomputed detection data serving
- AIS (Automatic Identification System) data integration
- S3-compatible storage integration
- Video streaming with range request support

## Technology Stack

- **Framework**: FastAPI (async Python web framework)
- **Package Manager**: uv (fast Python package manager)
- **Computer Vision**: OpenCV, YOLO, Roboflow
- **Object Tracking**: ByteTrack, Kalman Filter
- **Storage**: S3-compatible (Hetzner)
- **AIS Integration**: Barentswatch API

## Project Structure

```
backend/
├── ais/                    # AIS data fetching and services
│   ├── __init__.py
│   ├── fetch_ais.py       # AIS API client
│   └── service.py         # AIS service layer
├── common/                 # Shared utilities and types
│   ├── __init__.py
│   ├── settings.py        # Configuration (Pydantic models)
│   └── types.py           # Shared type definitions
├── cv/                     # Computer vision modules
│   ├── __init__.py
│   ├── detectors.py       # YOLO & Roboflow detectors
│   ├── trackers.py        # ByteTrack & Kalman tracking
│   ├── pipeline.py        # Detection streaming pipeline
│   ├── utils.py           # CV utility functions
│   ├── models/            # Trained model files (.pt)
│   └── eval.py            # Model evaluation scripts
├── storage/                # S3 storage integration
│   ├── __init__.py
│   └── s3.py              # S3 client and helpers
├── fusion/                 # FVessel fusion data
│   └── samples.json       # Sample configurations
├── api.py                  # FastAPI application
├── main.py                 # Entry point
├── pyproject.toml          # Dependencies
└── .env.example            # Environment variables template
```

## Core Components

### 1. API Layer (`api.py`)

FastAPI application with RESTful endpoints and WebSocket support.

**Key Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with file availability |
| `/api/samples` | GET | List available sample configurations |
| `/api/detections` | GET | Get fusion detections (time-synced) |
| `/api/detections/file` | GET | Get precomputed detection file |
| `/api/detections/ws` | WebSocket | Stream detections (file mode) |
| `/api/fusion/ws` | WebSocket | Stream fusion ground truth data |
| `/api/fusion/reset` | POST | Reset fusion sample timer |
| `/api/video` | GET | Stream main video (range requests) |
| `/api/video/fusion` | GET | Stream fusion video |
| `/api/storage/presign` | POST | Generate presigned S3 URLs |

**CORS Configuration:**
- Allows requests from `localhost:5173`, `localhost:5175` (Vite dev servers)
- Configured for development with credentials support

### 2. Computer Vision Pipeline (`cv/pipeline.py`)

Handles detection processing and streaming.

**Key Functions:**

- `handle_detections_ws()`: WebSocket handler for Datavision page
  - Streams precomputed detections from S3
  - Applies temporal smoothing to reduce flickering
  - Assigns stable track IDs for consistent UI
  
- `handle_fusion_ws()`: WebSocket handler for Fusion page
  - Streams ground truth data synced with video timer
  - Matches detections with AIS vessel data
  
- `get_detections()`: REST endpoint for fusion data
  - Returns detections for current sample second
  - Includes AIS matching

**Temporal Smoothing:**

The pipeline includes sophisticated smoothing to reduce detection flickering:

```python
def _apply_temporal_smoothing(
    frames: list[dict], 
    hold_duration: float = 0.5,  # Hold detections for 0.5s
    min_confidence: float = 0.45  # Filter low-confidence detections
) -> list[dict]:
```

Features:
- **Centroid-based tracking**: Matches detections across frames by proximity
- **Stable IDs**: Each boat gets a unique, persistent track_id
- **Temporal persistence**: Detections held for 0.5s even if briefly lost
- **Confidence filtering**: Removes flickering low-confidence detections

### 3. Detectors (`cv/detectors.py`)

Two detector implementations:

**YOLODetector:**
- Uses local YOLO models (.pt files)
- Fast inference on GPU/CPU
- Loads from `backend/cv/models/`

**RoboflowDetector:**
- Cloud-based detection via Roboflow API
- Requires `ROBOFLOW_API_KEY`
- No local model needed

Both detectors output standardized `Detection` objects.

### 4. Object Tracking (`cv/trackers.py`)

**ByteTrack:**
- Multi-object tracking algorithm
- Associates detections across frames
- Handles occlusions and temporary disappearances

**KalmanBoxTracker:**
- Predicts object positions using Kalman filtering
- Smooths bounding box trajectories

### 5. AIS Integration (`ais/`)

**fetch_ais.py:**
- Fetches vessel data from Barentswatch API
- OAuth2 client credentials flow
- Automatic token refresh

**service.py:**
- Matches detections with AIS vessel data by MMSI
- Enriches detections with vessel metadata (name, course, speed)

### 6. Storage Layer (`storage/s3.py`)

S3-compatible storage integration:

**Features:**
- Presigned URL generation for secure uploads/downloads
- Public URL support for direct access
- Range request handling for video streaming
- Health status checking

**Configuration:**
```python
S3_ENDPOINT = "https://s3.storage.com"
S3_BUCKET = "openar-bucket"
S3_PREFIX = "optional/prefix"
S3_REGION = "eu-central-1"
```

### 7. Configuration (`common/settings.py`)

Centralized configuration using Pydantic models:

**SampleConfig:**
```python
class SampleConfig(BaseModel):
    id: str
    label: str
    video_path: Optional[str]
    fusion_video_s3_key: Optional[str]
    fusion_csv_s3_key: Optional[str]
    duration_seconds: Optional[int]
```

**S3Config:**
```python
class S3Config(BaseModel):
    endpoint: str
    region: str
    bucket: str
    access_key: str
    secret_key: str
```

## Data Flow

### Datavision Page (Live Detections)

```
S3 Bucket (detections.json)
    ↓
Backend (_load_detection_frames)
    ↓
Temporal Smoothing (_apply_temporal_smoothing)
    ↓
WebSocket Stream (handle_detections_ws)
    ↓
Frontend (useDetectionsWebSocket)
    ↓
PoiOverlay Component
```

### Fusion Page (Ground Truth + AIS)

```
S3 Bucket (fusion CSV)
    ↓
Backend (_load_fusion_data → FUSION_BY_SECOND)
    ↓
Sample Timer (_get_sample_second)
    ↓
AIS Service (build_vessel_from_ais)
    ↓
WebSocket Stream (handle_fusion_ws)
    ↓
Frontend (useDetections polling)
    ↓
PoiOverlay Component
```

## WebSocket Protocol

### Connection Flow

1. **Client connects** to `/api/detections/ws` or `/api/fusion/ws`
2. **Client sends config**:
   ```json
   {
     "source": "/path/to/video.mp4",
     "track": true,
     "loop": true
   }
   ```
3. **Server sends ready signal**:
   ```json
   {
     "type": "ready",
     "width": 1920,
     "height": 1080,
     "fps": 25.0
   }
   ```
4. **Server streams detections**:
   ```json
   {
     "type": "detections",
     "frame_index": 125,
     "timestamp_ms": 5000,
     "fps": 25.0,
     "vessels": [
       {
         "detection": {
           "x": 1234.5,
           "y": 678.9,
           "width": 120,
           "height": 80,
           "confidence": 0.85,
           "track_id": 42,
           "class_name": "boat"
         },
         "vessel": {
           "mmsi": "257111020",
           "name": "HURTIGRUTEN",
           "course": 180.5,
           "speed": 12.3
         }
       }
     ]
   }
   ```

## Environment Variables

### Required

```bash
# Roboflow API (for cloud detection)
ROBOFLOW_API_KEY=your_api_key_here

# AIS API Credentials
AIS_CLIENT_ID=your_client_id_here
AIS_CLIENT_SECRET=your_client_secret_here
```
To create AIS variables, check out: [AIS API key creation](../backend/ais_api_key_creation.md)

### Optional (S3 Storage)

```bash
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_PUBLIC_BASE_URL=https://public-cdn.example.com
S3_PRESIGN_EXPIRES=900  # seconds
```

## Running the Backend

### Development

```bash
cd backend
uv sync                 # Install dependencies
uv run main.py          # Start server
```

Server runs on `http://0.0.0.0:8000`

### Production

```bash
uv run uvicorn api:app --host 0.0.0.0 --port 8000 --workers 4
```

## API Documentation

Once running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Performance Considerations

### Detection Streaming

- **Frame Rate**: Configurable (default 25 FPS)
- **Processing**: Frame skipping for real-time performance
- **Buffering**: Async queue-based producer-consumer pattern

### Temporal Smoothing

- **Hold Duration**: 0.5s (12-13 frames at 25 FPS)
- **Tracking Distance**: 100px maximum distance for ID matching
- **Confidence Threshold**: 45% minimum to reduce flickering

### Video Streaming

- **Range Requests**: Supported for seeking
- **Buffering**: 1MB chunks
- **Caching**: Browser-friendly headers

## Error Handling

The backend uses FastAPI's `HTTPException` for consistent error responses:

```python
try:
    result = perform_operation()
except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
except Exception as e:
    raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")
```

WebSocket errors are sent as:
```json
{
  "type": "error",
  "message": "Error description"
}
```

## Testing

### Manual Testing

```bash
# Health check
curl http://localhost:8000/health

# Get detections
curl http://localhost:8000/api/detections

# Get samples
curl http://localhost:8000/api/samples
```

### WebSocket Testing

Use a WebSocket client or browser console:

```javascript
const ws = new WebSocket('ws://localhost:8000/api/detections/ws');
ws.onopen = () => ws.send(JSON.stringify({ track: true, loop: true }));
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

## Future Improvements

1. **Model Management**
   - Hot-swapping models without restart
   - A/B testing different models
   - Model versioning

2. **Caching**
   - Redis for detection results
   - CDN integration for video

3. **Monitoring**
   - Prometheus metrics
   - Detection accuracy tracking
   - Performance profiling

4. **Scaling**
   - Horizontal scaling with load balancer
   - Separate workers for CV processing
   - Message queue for async processing

## Troubleshooting

### Common Issues

**"WebSocket connection refused"**
- Check backend is running on correct port
- Verify CORS configuration
- Check firewall rules

**"No detections streamed"**
- Verify `detections.json` exists in S3 or locally
- Check S3 credentials
- Review backend logs for errors

**"AIS data not showing"**
- Verify `AIS_CLIENT_ID` and `AIS_CLIENT_SECRET` in `.env`
- Check AIS API quota/rate limits
- Ensure MMSI values match in fusion data

**"High CPU usage"**
- Reduce frame processing rate
- Use GPU for YOLO inference
- Increase frame skip interval

## References

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [OpenCV Python](https://docs.opencv.org/4.x/d6/d00/tutorial_py_root.html)
- [YOLO Documentation](https://docs.ultralytics.com/)
- [ByteTrack Paper](https://arxiv.org/abs/2110.06864)
- [Barentswatch AIS API](https://developer.barentswatch.no/docs/appreg)
