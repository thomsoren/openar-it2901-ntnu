# openar-it2901-ntnu

OpenAR - Augmented Reality demonstration for maritime vessel detection using OpenBridge web components and AI-powered computer vision.

## Features

- **Real-time Boat Detection** - RT-DETR detection with WebSocket streaming
- **ByteTrack Tracking** - Multi-object tracking for stable detection IDs
- **AIS Integration** - Automatic vessel identification with Barentswatch API
- **AR Overlay** - OpenBridge POI markers with vessel information
- **Video Streaming** - MP4 with range requests + MJPEG live stream
- **S3 Storage** - Cloud storage integration for assets and data
- **Data Fusion** - Ground truth detection matching with AIS data

## Getting Started

### Prerequisites

- **Node.js:** v18 LTS or higher
- **pnpm:** Install with `npm install -g pnpm`
- **Python:** 3.11+
- **uv:** Fast Python package manager ([install guide](https://docs.astral.sh/uv/getting-started/installation/))
- **CUDA:** For GPU-accelerated inference (optional but recommended)
- Access to GitHub Packages for `@ocean-industries-concept-lab` components

### Quick Start

From the project root:

```bash
# Install root dependencies
pnpm install

# Install all project dependencies (backend + frontend)
pnpm run install

# Set up environment variables (see Configuration section)
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

# Run both backend and frontend concurrently
pnpm dev
```

**Access:**
- Backend API: `http://localhost:8000`
- Frontend: `http://localhost:5173` (or `5174`, `5175` if port taken)
- API Docs: `http://localhost:8000/docs`

### Configuration

Create a `.env` file in the `backend/` directory:

```bash
# Required for AIS vessel data
AIS_CLIENT_ID=your_client_id
AIS_CLIENT_SECRET=your_client_secret

# Optional: S3 Storage (Hetzner or compatible)
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_PUBLIC_BASE_URL=https://your-cdn.com
S3_PRESIGN_EXPIRES=900
```

**Getting API Keys:**
- AIS API: https://www.barentswatch.no/minside/devaccess/ais

### Video Setup

Place a video file for inference at the default path, or configure via environment:

```bash
# Default path (relative to backend/)
data/raw/video/Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4

# Or set VIDEO_S3_KEY to stream from S3
```

### Model Setup

Place trained RT-DETR model weights in `backend/models/`:

```bash
backend/models/
├── best.pt      # Best validation checkpoint (recommended)
├── last.pt      # Latest checkpoint
└── epoch50.pt   # Specific epoch checkpoint
```

The detector defaults to `best.pt`. Train your own model or use pretrained weights.

### Individual Commands

#### Backend Only

```bash
pnpm dev:backend
# or manually:
cd backend && uv run main.py
```

#### Frontend Only

```bash
pnpm dev:frontend
# or manually:
cd frontend && pnpm dev
```

#### GitHub Packages Authentication (First Time)

```bash
# Login to GitHub Packages for OpenBridge components
pnpm login --registry https://npm.pkg.github.com/ --scope=ocean-industries-concept-lab

# Or use a .npmrc file in the frontend directory:
# //npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run backend and frontend concurrently |
| `pnpm dev:frontend` | Run frontend only (Vite dev server) |
| `pnpm dev:backend` | Run backend only (FastAPI with uvicorn) |
| `pnpm run install` | Install all dependencies (root + backend + frontend) |
| `pnpm install:frontend` | Install frontend dependencies |
| `pnpm install:backend` | Install backend dependencies |

## Project Structure

```
openar/
├── backend/              # Python FastAPI backend
│   ├── ais/             # AIS data integration
│   ├── common/
│   │   ├── config/      # Modular configuration
│   │   │   ├── paths.py    # File paths
│   │   │   ├── s3.py       # S3 settings
│   │   │   └── samples.py  # Sample configs
│   │   └── types.py     # Shared types
│   ├── cv/              # Computer vision pipeline
│   │   ├── detectors.py    # RT-DETR detector
│   │   ├── worker.py       # Inference worker process
│   │   ├── config.py       # Detection/tracking params
│   │   ├── bytetrack.yaml  # Tracker configuration
│   │   └── training/       # Model training scripts
│   ├── fusion/          # Ground truth data handling
│   ├── storage/         # S3 integration
│   ├── models/          # Trained model weights
│   ├── api.py           # FastAPI routes
│   └── main.py          # Entry point
├── frontend/            # React + TypeScript frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   │   └── poi-overlay/ # AR marker overlay
│   │   ├── hooks/       # Custom React hooks
│   │   │   ├── useDetections.ts          # REST polling
│   │   │   └── useDetectionsWebSocket.ts # WebSocket streaming
│   │   ├── pages/       # Page components
│   │   │   ├── Datavision.tsx  # Live detection demo
│   │   │   ├── Fusion.tsx      # Ground truth + AIS
│   │   │   ├── Ais.tsx         # AIS data display
│   │   │   └── Components.tsx  # UI components demo
│   │   ├── types/       # TypeScript types
│   │   └── config/      # Configuration
│   └── public/          # Static assets
├── docs/                # Documentation
└── landingpage/         # Next.js landing page
```

### Backend

Python FastAPI backend with real-time detection streaming and AIS integration.

**Key Features:**
- WebSocket streaming for real-time detections
- RT-DETR object detection with ByteTrack tracking
- Multiprocess inference worker (GPU-accelerated)
- MJPEG video streaming synced with detections
- AIS vessel data integration
- S3-compatible storage with local fallback
- RESTful API with automatic documentation

**Tech Stack:**
- FastAPI (async web framework)
- Ultralytics (RT-DETR + ByteTrack)
- OpenCV (video processing)
- PyTorch (deep learning)
- Pydantic (data validation)

See [docs/backend-architecture.md](./docs/backend-architecture.md) for detailed documentation.

### Frontend

React application with TypeScript, demonstrating AR overlays for maritime vessel detection.

**Key Features:**
- OpenBridge web components for maritime UI
- WebSocket streaming for live detections
- Video playback with detection overlay
- AIS vessel information display

**Tech Stack:**
- React 18 + TypeScript
- Vite (build tool)
- OpenBridge web components
- TailwindCSS (landing page)

See [docs/architecture.md](./docs/architecture.md) for detailed frontend documentation.

### Landing Page

Next.js landing page showcasing the project.

**Location:** `landingpage/`

**Tech Stack:**
- Next.js 15
- TypeScript
- TailwindCSS

## API Endpoints

### Health & Status
- `GET /health` - Server health check with file availability

### Detection Streaming
- `GET /api/detections` - Get fusion detections (REST)
- `GET /api/detections/file` - Get precomputed detection file
- `WebSocket /api/detections/ws` - Stream detections (Datavision)
- `WebSocket /api/fusion/ws` - Stream fusion data with AIS

### Video Streaming
- `GET /api/video` - Main video file (MP4)
- `GET /api/video/mjpeg` - MJPEG stream synced with detections
- `GET /api/video/fusion` - Fusion video stream
- `GET /api/video/stream` - Video with range request support

### Configuration
- `GET /api/samples` - List available sample configurations
- `POST /api/fusion/reset` - Reset fusion timer

### Storage
- `POST /api/storage/presign` - Generate presigned S3 URLs

**Interactive Docs:**
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Development Workflow

### Running Tests

```bash
# Backend
cd backend
uv run pytest

# Frontend
cd frontend
pnpm test
```

### Linting & Formatting

```bash
# Frontend (ESLint + Prettier)
cd frontend
pnpm lint
pnpm format

# Pre-commit hooks automatically run linters
```

### Code Quality

The project uses:
- **Husky** - Git hooks for pre-commit checks
- **ESLint** - JavaScript/TypeScript linting
- **Prettier** - Code formatting
- **React Compiler** - Automatic React optimizations

## Architecture Highlights

### Backend

**Inference Pipeline:**
- Multiprocess worker runs detection in separate process
- Reader thread reads video at native FPS
- Inference runs on latest frame (natural frame skipping)
- WebSocket broadcasts detections to all connected clients

**Detection & Tracking:**
- RT-DETR transformer-based detector
- ByteTrack multi-object tracking
- Configurable confidence threshold (default: 0.15)
- Track buffer maintains IDs across detection gaps

**Configuration:**
- Modular config in `backend/common/config/`
- CV settings in `backend/cv/config.py`
- ByteTrack params in `backend/cv/bytetrack.yaml`

**S3 Integration:**
- Presigned URLs for secure access
- Local file fallback when S3 unavailable
- Health checking at `/health`

### Frontend

**Detection Display:**
- WebSocket streaming for real-time updates
- OpenBridge POI components for maritime UI
- Video transform calculation for overlay positioning

**Pages:**
- **Datavision** - Live inference with MJPEG stream
- **Fusion** - Ground truth data with AIS overlay
- **AIS** - Live AIS vessel data display

## Troubleshooting

### Backend Issues

**"Could not connect to database" or S3 errors:**
- Check `.env` file exists in `backend/`
- Verify S3 credentials are correct
- Test S3 connection: `curl http://localhost:8000/health`

**"No detections streaming":**
- Verify detection files exist in S3 or locally
- Check WebSocket connection in browser DevTools
- Review backend logs for errors

**AIS data not showing:**
- Confirm `AIS_CLIENT_ID` and `AIS_CLIENT_SECRET` in `.env`
- Check API quota/rate limits
- Test: `curl http://localhost:8000/api/samples`

### Frontend Issues

**"Failed to fetch detections":**
- Ensure backend is running on port 8000
- Check CORS errors in browser console
- Verify API_URL in frontend config

**POI markers not appearing:**
- Check browser console for WebSocket errors
- Verify video dimensions match overlay dimensions
- Ensure detections have valid x, y coordinates

**"Access denied" for OpenBridge components:**
- Verify GitHub Packages authentication
- Check `.npmrc` has correct token
- Re-login: `pnpm login --registry https://npm.pkg.github.com/`

### General

**Port conflicts:**
- Frontend will try 5173, 5174, 5175 automatically
- Backend uses 8000 (change in `main.py` if needed)
- Check what's using ports: `lsof -i :8000`

**Performance issues:**
- Ensure CUDA is available: check `[Detector] PyTorch device: cuda` in logs
- Adjust confidence in `backend/cv/config.py`
- Tune ByteTrack params in `backend/cv/bytetrack.yaml`

**Detection quality:**
- Lower `CONFIDENCE` in `cv/config.py` for more detections
- Increase `track_buffer` in `bytetrack.yaml` to maintain tracks longer
- Try different model checkpoints (`best.pt` vs `last.pt`)

## Contributing

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Run linters: `pnpm lint`
4. Commit with conventional commits: `git commit -m "feat: add feature"`
5. Push and create a pull request

## Documentation

- [Backend Architecture](./docs/backend-architecture.md) - Detailed backend documentation
- [Frontend Architecture](./docs/architecture.md) - Frontend architecture and components
- [Backend README](./backend/README.md) - Backend setup and API guide

## License

This project is part of the IT2901 course at NTNU.

## Acknowledgments

- [OpenBridge Design System](https://openbridge.no/) - Maritime UI components
- [Barentswatch](https://www.barentswatch.no/) - AIS data API
- [Ultralytics](https://ultralytics.com/) - RT-DETR & ByteTrack
