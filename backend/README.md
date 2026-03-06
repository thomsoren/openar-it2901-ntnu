# OpenAR Backend

FastAPI backend for the OpenAR maritime AR platform. Handles computer vision inference (RT-DETR), video streaming (FFmpeg → MediaMTX), AIS data integration, and detection delivery via WebSocket.

For detailed architecture, API reference, and style guide, see [CLAUDE.md](CLAUDE.md).

## Quick Start

```bash
# 1. Install dependencies
uv sync

# 2. Copy environment config
cp .env.example .env   # then fill in required values

# 3. Start the server
uv run main.py         # runs on :8000
```

Requires PostgreSQL running on `:5433` — see `infra/docker-compose.postgres.yml`.

## Key Commands

```bash
uv sync              # Install/update dependencies
uv run main.py       # Start FastAPI server on :8000
uv run pytest        # Run test suite
```

## Environment Variables

Copy `.env.example` to `.env`. Required:

```bash
DATABASE_URL=postgresql+psycopg://openar:openar_dev@localhost:5433/openar
JWT_SECRET_KEY=<strong-random-secret>
BETTER_AUTH_BASE_URL=http://localhost:3001
```

Optional (features degrade gracefully without these):

```bash
AIS_CLIENT_ID=...          # Barentswatch AIS API
AIS_CLIENT_SECRET=...
S3_ACCESS_KEY=...           # Hetzner S3 storage
S3_SECRET_KEY=...
```

## API Endpoints

All endpoints except `/health` require `Authorization: Bearer <JWT>`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/detections/ws` | WebSocket | Live detection stream |
| `/api/fusion/ws` | WebSocket | Fusion ground truth + AIS |
| `/api/detections` | GET | Fusion detections (time-synced) |
| `/api/video` | GET | Video stream (range requests) |
| `/api/storage/presign` | POST | Generate presigned S3 upload URL |
| `/api/samples` | GET | List available sample configs |
| `/api/streams/*` | Various | Stream lifecycle management |

Interactive docs available at `http://localhost:8000/docs` (Swagger) and `http://localhost:8000/redoc`.

## MediaMTX Streaming

Workers publish video via FFmpeg → RTSP → MediaMTX → WebRTC (WHEP) to browsers.

```bash
# Start MediaMTX
docker compose -f streaming/mediamtx/docker-compose.mediamtx.yml up -d

# Stop MediaMTX
docker compose -f streaming/mediamtx/docker-compose.mediamtx.yml down
```

Configure in `.env`:

```bash
MEDIAMTX_ENABLED=true
MEDIAMTX_RTSP_BASE=rtsp://localhost:8854
# Production only: MEDIAMTX_URL=https://mediamtx.example.com
# Local dev: leave unset (defaults: 8889 WHEP, 8888 HLS)
```

## S3 Storage

When S3 keys are configured, video and detection assets are served from Hetzner S3. The frontend uploads directly via presigned URLs.

```bash
curl -X POST http://localhost:8000/api/storage/presign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"key":"video/example.mp4","method":"PUT","content_type":"video/mp4"}'
```

## Troubleshooting

- **"error: externally-managed-environment"**: Use `uv sync` and `uv run ...` instead of pip
- **Database connection fails**: Ensure PostgreSQL is running (`docker compose -f infra/docker-compose.postgres.yml up -d`)
- **No detections arriving**: Check that the worker process started (look for `Worker started for stream` in logs)
- **MediaMTX not reachable**: Verify Docker container is running (`docker ps | grep mediamtx`)

## Stream Lifecycle At A Glance

The backend has one orchestrator that manages stream workers. Each running stream has:

- one decode thread (reads frames from source)
- one FFmpeg subprocess (publishes video to MediaMTX)
- one shared inference thread that consumes decoded frames and publishes detections to Redis

The detections WebSocket does not run inference directly. It subscribes to Redis and forwards detection messages to clients.

### Architecture Diagram

```mermaid
flowchart LR
    Client["Browser Client"]
    API["FastAPI (webapi)"]
    Orch["WorkerOrchestrator"]
    Decode["DecodeThread (per stream)"]
    Infer["InferenceThread (shared)"]
    Pub["DetectionPublisher / FusionPublisher"]
    Redis["Redis Pub/Sub"]
    WS["Detections WebSocket"]
    FF["FFmpeg subprocess (per stream)"]
    MTX["MediaMTX"]
    Playback["WHEP/HLS/RTSP playback"]

    Client -->|"REST /api/streams/*"| API
    Client -->|"ws /api/detections/ws/{stream_id}"| WS
    WS --> API
    API --> Orch
    Orch --> Decode
    Orch --> FF
    Decode --> Infer
    Infer --> Pub
    Pub --> Redis
    Redis --> WS
    FF --> MTX
    MTX --> Playback
    Playback --> Client
```

### Main Responsibilities

- `webapi/app.py`, `webapi/routes/*`: API surface and app startup/shutdown wiring
- `orchestrator/orchestrator.py`: stream lifecycle, viewer/heartbeat tracking, health checks, restarts
- `cv/decode_thread.py`: source decoding and latest-frame buffer
- `cv/inference_thread.py`: active-stream inference loop and detection publishing
- `cv/publisher.py`: Redis publish adapter for detections/fusion payloads
- `cv/ffmpeg.py`: FFmpeg subprocess control for MediaMTX publishing
- `common/config/*`: environment-driven settings and channel/URL builders

### Request Flow (Detect WebSocket)

1. Stream starts via `/api/streams/{stream_id}/start` or upload endpoint.
2. Client connects to `/api/detections/ws/{stream_id}`.
3. API acquires a stream viewer in orchestrator.
4. Decode thread updates latest frame; inference thread runs detector on new frames.
5. Inference publishes JSON to Redis `detections:{stream_id}`.
6. WebSocket handler forwards Redis messages to client.
7. On disconnect, API unsubscribes and releases viewer.

### Monitor Behavior

- No-viewer timeout: stops inactive streams but keeps config for later auto-restart.
- Idle timeout: stops streams with stale heartbeat.
- Decode failures: exponential backoff restart attempts.
- FFmpeg failures: restart attempts while stream remains active.

## CV Module Map

- `cv/config.py`: shared detector and tracking tuning values
- `cv/decode_thread.py`: decode loop, reconnection, pacing, latest-frame store
- `cv/detectors.py`: RT-DETR model integration and detection output mapping
- `cv/inference_thread.py`: active stream selection and detection publish loop
- `cv/publisher.py`: Redis publish logic and optional fusion enrichment path
- `cv/ffmpeg.py`: FFmpeg command building/process lifecycle for MediaMTX publishing
- `cv/utils.py`: video metadata helpers
