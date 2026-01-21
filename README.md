# openar-it2901-ntnu

OpenAR - Augmented Reality demo for maritime vessel detection using OpenBridge components.

## Getting started

### Prerequisites
- **Node.js:** LTS recommended
- **pnpm:** Install globally with `npm install -g pnpm`
- **Python:** 3.9+
- **uv:** Python package manager ([install guide](https://docs.astral.sh/uv/getting-started/installation/))
- Access to GitHub Packages for `@ocean-industries-concept-lab`

### Quick Start

From the project root:

```bash
# Install root dependencies (concurrently for dev script)
pnpm install

# Install all project dependencies (backend + frontend)
pnpm run install

# Run both backend and frontend
pnpm dev
```

- Backend API: `http://localhost:8000`
- Frontend: `http://localhost:5173`

### Individual Commands

#### Backend only

```bash
pnpm dev:backend
# or manually:
cd backend && uv run uvicorn api:app --reload
```

#### Frontend only

```bash
pnpm dev:frontend
# or manually:
cd react-demo && pnpm dev
```

#### GitHub Packages Authentication (first time only)

```bash
pnpm login --registry https://npm.pkg.github.com/ --scope=ocean-industries-concept-lab
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run backend and frontend concurrently |
| `pnpm dev:frontend` | Run frontend only |
| `pnpm dev:backend` | Run backend only |
| `pnpm run install` | Install all dependencies |
| `pnpm install:frontend` | Install frontend dependencies |
| `pnpm install:backend` | Install backend dependencies |

## Project Structure

### backend
Python FastAPI backend for serving detections and video streams.

**Key features:**
- FastAPI REST API for detections and video streaming
- CORS-enabled for frontend integration
- Roboflow Inference integration for boat detection
- Video processing and detection extraction

**API Endpoints:**
- `GET /api/detections` - Get all detection data
- `GET /api/video` - Stream video file
- `GET /health` - Health check

See [backend/README.md](./backend/README.md) for detailed setup and API documentation.

### react-demo
React application demonstrating video-based object detection with AR POI overlays.

**Key directories:**
- `src/types/` - Shared TypeScript type definitions
- `src/utils/` - Utility functions and algorithms (detection tracking, filtering)
- `src/config/` - Application configuration constants
- `src/hooks/` - React custom hooks for detection and video sync
- `src/components/` - React components (POI overlay)

See [react-demo/docs/architecture.md](./react-demo/docs/architecture.md) for detailed architecture documentation.
