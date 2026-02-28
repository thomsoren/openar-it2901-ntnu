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

Requires PostgreSQL running on `:5532` — see `infra/docker-compose.postgres.yml`.

## Key Commands

```bash
uv sync              # Install/update dependencies
uv run main.py       # Start FastAPI server on :8000
uv run pytest        # Run test suite
```

## Environment Variables

Copy `.env.example` to `.env`. Required:

```bash
DATABASE_URL=postgresql+psycopg://openar:openar_dev@localhost:5532/openar
JWT_SECRET_KEY=<strong-random-secret>
BETTER_AUTH_BASE_URL=http://localhost:3001
```

Optional:

```bash
AIS_CLIENT_ID=...          # Barentswatch AIS API
AIS_CLIENT_SECRET=...
S3_ACCESS_KEY=...           # Required in S3-only deployments
S3_SECRET_KEY=...
BETTER_AUTH_BASE_PATH=/api/auth
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
MEDIAMTX_WHEP_BASE=http://localhost:8889
MEDIAMTX_HLS_BASE=http://localhost:8888
```

## S3 Storage

Video and detection assets are served from Hetzner S3 (S3-only). The frontend uploads directly via presigned URLs.

Runtime object-key routing and visibility/ownership metadata are stored in the PostgreSQL `media_assets` table.

For the complete endpoint mapping, see `../docs/s3-asset-manifest.md`.

```bash
curl -X POST http://localhost:8000/api/storage/presign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{
    "method":"PUT",
    "filename":"example.mp4",
    "group_id":"team-a",
    "stream_id":"demo-stream",
    "visibility":"private",
    "content_type":"video/mp4"
  }'
```

Upload policy defaults to owner-scoped paths:

- `videos/private/{groupId}/{userId}/{streamId}/{filename}` (default)
- `videos/group/{groupId}/{userId}/{streamId}/{filename}`
- `videos/public/{groupId}/{userId}/{streamId}/{filename}` (admin publish flow)

## Troubleshooting

- **"error: externally-managed-environment"**: Use `uv sync` and `uv run ...` instead of pip
- **Database connection fails**: Ensure PostgreSQL is running (`docker compose -f infra/docker-compose.postgres.yml up -d`)
- **No detections arriving**: Check that the worker process started (look for `Worker started for stream` in logs)
- **MediaMTX not reachable**: Verify Docker container is running (`docker ps | grep mediamtx`)
