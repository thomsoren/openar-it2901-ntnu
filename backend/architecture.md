# Backend Architecture

This document explains how the backend works — what each part does and how they talk to each other. It is written for developers joining the project who want to understand the system before reading any code.

## The Big Picture

The backend does three things:

1. **Reads video** from a file or camera stream and decodes it into individual frames.
2. **Finds boats** in those frames using a machine learning model (RT-DETR) and sends the results to the browser in real time.
3. **Delivers the video** to the browser so users can watch the stream alongside the detection overlays.

These two paths — detection and video delivery — run in parallel and are completely independent of each other. The detection path goes through Redis, the video path goes through MediaMTX. The browser receives both and combines them into one view.

```
                          ┌─────────────────────────────┐
                          │        Video Source          │
                          │  (local file, RTSP camera)   │
                          └──────────────┬──────────────┘
                                         │
                              ┌──────────┴──────────┐
                              │    Decode Thread     │
                              │  (reads raw frames)  │
                              └──────────┬──────────┘
                                         │
                        ┌────────────────┼────────────────┐
                        │                                 │
              ┌─────────┴─────────┐             ┌────────┴────────┐
              │  Inference Thread  │             │      FFmpeg     │
              │  (detect boats)    │             │  (encode video) │
              └─────────┬─────────┘             └────────┬────────┘
                        │                                 │
              ┌─────────┴─────────┐             ┌────────┴────────┐
              │   Redis pub/sub   │             │    MediaMTX     │
              └─────────┬─────────┘             └────────┬────────┘
                        │                                 │
              ┌─────────┴─────────┐             ┌────────┴────────┐
              │  WebSocket (API)  │             │  WebRTC (WHEP)  │
              └─────────┬─────────┘             └────────┬────────┘
                        │                                 │
                        └────────────────┬────────────────┘
                                         │
                              ┌──────────┴──────────┐
                              │      Browser        │
                              │ (video + overlays)  │
                              └─────────────────────┘
```

## What Happens When a User Connects

Here is the full journey from "user opens the app" to "detections appear on screen":

1. The user opens a stream in the browser. The frontend sends a request to start the stream.
2. The **orchestrator** creates a new worker for that stream. The worker consists of a decode thread and an FFmpeg process.
3. The **decode thread** opens the video source and starts reading frames as fast as the source allows.
4. The **inference thread** (shared across all streams) picks up frames from the active stream, runs the boat detection model, and publishes results to Redis.
5. The frontend opens a **WebSocket** connection. The API subscribes to the Redis channel for that stream and forwards every detection message to the browser.
6. At the same time, **FFmpeg** reads the same video source independently, encodes it, and pushes it to **MediaMTX**. The browser connects to MediaMTX via WebRTC to watch the actual video.
7. The browser combines the video feed with the detection overlay — boats get bounding boxes drawn on top.

When the user closes the tab, the WebSocket disconnects, the viewer count drops to zero, and after a short timeout the orchestrator shuts down the worker to free resources.

## The Orchestrator

The orchestrator is the manager of the whole system. It decides when to start and stop streams, monitors their health, and handles failures.

### Starting a stream

When a stream is requested, the orchestrator:
- Checks that the system has capacity (there is a configurable limit on concurrent streams).
- Creates a decode thread for reading frames from the source.
- Registers the stream with the shared inference thread.
- Spawns an FFmpeg process to deliver video to MediaMTX.
- Stores a handle that tracks the stream's state: viewer count, last heartbeat, health status.

### Monitoring

A background monitor thread runs every two seconds and checks each stream:

- **Is the decode thread still alive?** If it crashed, the orchestrator schedules a restart with increasing delay between attempts. If the failure is permanent (file not found, permission denied), it gives up instead of retrying forever.
- **Is FFmpeg still running?** If it exited, restart it.
- **Are there any viewers?** If nobody has been watching for 15 seconds, shut down the stream to save resources. The stream's configuration is kept so it can restart instantly if someone reconnects.
- **Is the stream idle?** If no heartbeat has arrived for 5 minutes, shut it down.

### Viewer tracking

Every WebSocket connection to a stream counts as a viewer. When a viewer connects, the orchestrator increments the count. When they disconnect, it decrements. If the count reaches zero, a countdown starts — if no new viewer connects within the timeout, the stream stops.

If a viewer connects to a stream that was previously stopped (but still has a saved configuration), the orchestrator automatically restarts it. This means users experience seamless reconnection.

## The Detection Pipeline

Detection is a three-stage pipeline: decode, detect, publish.

### Stage 1 — Decode Thread

Each stream gets its own decode thread. Its only job is to read frames from the video source (a local file, a URL, or an RTSP camera) and keep the latest frame available for the inference thread.

For local files, it paces itself to match the video's original frame rate so playback looks natural. For live streams, it reads as fast as the source provides. If the source disconnects, it retries with increasing delay and a bit of randomness to avoid all streams reconnecting at the same instant.

The decode thread does not run the detection model — it only provides frames.

### Stage 2 — Inference Thread

There is a single inference thread shared across all streams. It runs the RT-DETR object detection model on the GPU. At any given time, it processes frames from one "active" stream — whichever stream currently has viewers.

When a new frame is available, the inference thread:
1. Runs the detection model to find boats in the frame.
2. Uses ByteTrack to assign consistent track IDs across frames (so the same boat keeps the same ID over time).
3. Packages the results into a detection payload with bounding boxes, confidence scores, and track IDs.
4. Hands the payload to the publisher.

The inference thread also sends a one-time "ready" message when it first processes a stream, telling the browser the video dimensions and frame rate.

### Stage 3 — Detection Publisher

The publisher takes detection payloads and sends them to Redis using pub/sub. Each stream has its own Redis channel (`detections:{stream_id}`). The publisher does not know or care who is listening — it just broadcasts.

### How detections reach the browser

The WebSocket route in the API subscribes to the Redis channel for the requested stream. Whenever a detection message arrives on that channel, the API forwards it to the browser over the WebSocket. Multiple browsers can watch the same stream — they all subscribe to the same Redis channel and each gets the same data.

## Video Delivery

Video delivery is completely separate from detection. It exists so users can actually see the video in the browser.

**FFmpeg** reads the video source and encodes it into H.264 (using hardware acceleration if available). It then pushes the encoded stream to **MediaMTX** via RTSP.

**MediaMTX** is a media proxy. It receives the RTSP stream from FFmpeg and makes it available to browsers as WebRTC (very low latency) or HLS (wider compatibility). The browser connects directly to MediaMTX for video — the backend API is not involved in video delivery at all.

FFmpeg only exists because MediaMTX runs in Docker and cannot access local files on the host machine. In production with real RTSP cameras, FFmpeg can be removed entirely — MediaMTX can pull directly from the camera.

## Package Map

Here is what each package in the backend is responsible for:

| Package | What it does |
|---------|--------------|
| `webapi/` | The API layer. Defines all HTTP and WebSocket endpoints, wires up middleware, and manages the application lifecycle (startup/shutdown). |
| `webapi/routes/` | Individual route modules grouped by domain: streams, detections, media, AIS, and system utilities. |
| `orchestrator/` | Manages stream workers. Starts and stops streams, tracks viewers and heartbeats, monitors health, and handles restarts. |
| `cv/` | The computer vision pipeline. Contains the decode thread, inference thread, detection model wrapper, detection publisher, and FFmpeg integration. |
| `services/` | High-level helpers that combine logic from multiple packages. Resolves video sources (local, S3, URL) and builds playback URL payloads. |
| `settings/` | Centralized configuration. Reads environment variables once at startup and exposes them as typed, validated settings objects. |
| `common/` | Shared types and configuration constants used across the entire backend. Pydantic models for detections and vessels, Redis channel names, file paths, S3 keys. |
| `storage/` | S3 integration. Uploads, downloads, generates presigned URLs, and serves media files. |
| `auth/` | Authentication. Exchanges Better Auth cookies for JWT tokens, validates tokens on protected endpoints, manages user records. |
| `db/` | Database layer. SQLAlchemy models, session management, and schema initialization for PostgreSQL. |
| `fusion/` | Ground truth data for evaluation. Loads pre-labeled vessel positions and streams them via WebSocket for comparison with live detections. |
| `ais/` | AIS vessel data. Fetches real-time vessel positions from external AIS APIs and serves them to the frontend. |

## How the Packages Depend on Each Other

The dependency flow is top-down. Higher-level packages import from lower-level ones, never the other way around.

```
webapi/routes/  ──→  orchestrator/  ──→  cv/
      │                    │               │
      │                    │               ▼
      ├──→  services/      │          common/config/
      │         │          │               ▲
      │         ▼          │               │
      ├──→  storage/       └───────────────┘
      │
      ├──→  auth/  ──→  db/
      │
      ├──→  fusion/
      │
      └──→  common/types
```

- **Routes** call into the orchestrator, services, and auth — they are the entry point for all external requests.
- **Orchestrator** creates and manages CV components (decode threads, inference thread, FFmpeg).
- **CV** reads configuration from `common/config/` and `settings/` but does not know about the API or orchestrator.
- **Services** bridge the gap between routes and lower-level modules like storage and config.
- **Common** is at the bottom — it provides types and constants that everyone uses but imports nothing from the application.

There are no circular dependencies.

## External Services

The backend connects to four external services:

| Service | Purpose | Connection |
|---------|---------|------------|
| **PostgreSQL** | Stores user accounts and auth data | SQLAlchemy ORM, port 5433 |
| **Redis** | Real-time detection message delivery between workers and the API | Pub/sub, port 6379 |
| **MediaMTX** | Video proxy — converts RTSP to WebRTC/HLS for browsers | RTSP ingest on port 8854, WebRTC on port 8889 |
| **S3 (Hetzner)** | Stores video files, detection results, AIS data, and other assets | Boto3 client with presigned URLs |

The **auth service** (Node.js, port 3001) is also external to the backend but part of the same project. It handles user registration and sessions using Better Auth. The backend exchanges Better Auth cookies for JWT tokens and validates those tokens on every protected endpoint.

## Threading Model

The backend runs multiple threads to handle different workloads without blocking each other:

- **Main thread** — Runs the async FastAPI server. Handles all HTTP requests and WebSocket connections.
- **Decode threads** (one per stream) — Each continuously reads frames from a video source. These are CPU-bound and run as daemon threads.
- **Inference thread** (one, shared) — Runs the detection model on the GPU. Processes frames from whichever stream is currently active.
- **Monitor thread** (one) — Checks stream health every two seconds. Restarts failed components and enforces timeouts.
- **FFmpeg subprocesses** (one per stream) — Not threads, but separate processes. Encode and push video to MediaMTX.

All shared state is protected by locks. The orchestrator uses a snapshot pattern for its monitor loop: it copies the list of active streams under the lock, then releases the lock before doing any expensive work. This keeps the lock held for as short a time as possible.

## Configuration

Configuration flows from environment variables through two systems:

1. **`settings/`** — Application-level settings like maximum workers, timeouts, and stream ID validation. These are loaded once at startup into frozen dataclass singletons.
2. **`common/config/`** — Infrastructure constants like Redis URLs, S3 endpoints, file paths, and MediaMTX settings. These are also loaded from environment variables with sensible defaults.

No code outside these two packages reads environment variables directly. This means there is exactly one place to look for any configuration value.
