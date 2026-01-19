# openar-it2901-ntnu

OpenAR - Augmented Reality demo for maritime vessel detection using OpenBridge components.

## Getting started

### Prerequisites
- **Frontend:** Node.js (LTS recommended), npm
- **Backend:** Python 3.9+, uv (Python package manager)
- Access to GitHub Packages for `@ocean-industries-concept-lab`

### Quick Start

#### 1. Start the Backend API Server

```bash
cd backend

# Install dependencies
uv sync

# Start the API server
uv run python api.py
```

The API will be available at `http://localhost:8000`

#### 2. Start the Frontend

```bash
cd react-demo

# Login to GitHub Packages (first time only)
npm login --registry https://npm.pkg.github.com/ --scope=ocean-industries-concept-lab

# Install dependencies
npm install

# Start dev server
npm run dev
```

The frontend will be available at `http://localhost:5173`

**Note:** The frontend is configured to fetch detections and video from the backend API. Make sure the backend is running first.

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
