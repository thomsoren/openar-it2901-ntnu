# Backend Stream Flow (Quick Architecture Guide)

This guide explains what happens from the moment a user connects to a stream, and which part of the backend does what.

It is written for developers who can code, but are new to this backend.

## Mental model in 30 seconds

The backend has one orchestrator that manages stream workers.
Each stream worker has:

- one decode thread (reads frames from source),
- one FFmpeg subprocess (publishes video to MediaMTX),
- and a shared inference thread consumes decoded frames and publishes detections through Redis.

The WebSocket endpoint does not run detection itself.
It subscribes to Redis and forwards detection messages to the browser.

## Main components and responsibilities

- `api.py`
  - Compatibility entrypoint that exports the FastAPI app.
- `webapi/app.py` + `webapi/routes/*`
  - Exposes REST + WebSocket APIs.
  - On startup, creates `WorkerOrchestrator` and starts monitoring.
  - On WebSocket connect/disconnect, attaches/releases a viewer.
- `orchestrator/orchestrator.py` (`WorkerOrchestrator`)
  - Starts/stops streams.
  - Tracks viewer counts, heartbeats, idle timeouts.
  - Restarts failed decode threads and FFmpeg subprocesses.
- `cv/decode_thread.py` (`DecodeThread`)
  - Continuously decodes frames from source (file/RTSP/etc).
  - Keeps only the latest frame in a thread-safe slot.
- `cv/inference_thread.py` (`InferenceThread`)
  - Reads latest frame from the active stream.
  - Runs RT-DETR + ByteTrack.
  - Publishes detection payloads.
- `cv/publisher.py` (`DetectionPublisher`)
  - Publishes JSON payloads to Redis pub/sub channel `detections:{stream_id}`.
- `cv/ffmpeg.py` (`FFmpegDirectPublisher`)
  - Starts FFmpeg to publish the video stream to MediaMTX for playback.
- `common/config/redis.py`
  - Defines Redis channel naming and Redis clients.
- `common/config/mediamtx.py`
  - Defines MediaMTX and FFmpeg settings + playback URL builders.

## Process and thread model

There are multiple concurrent execution units:

1. Main backend process (`uvicorn` / FastAPI)
2. One orchestrator monitor thread (health checks + lifecycle decisions)
3. One decode thread per running stream
4. One shared inference thread
5. One FFmpeg subprocess per running stream
6. External services: Redis and MediaMTX

Important distinction:

- Detection messages flow through Redis pub/sub.
- Video playback flow is separate and goes through FFmpeg -> MediaMTX -> client playback URL (HLS/WHEP/RTSP).

## End-to-end: user connects to a stream

### Step 0: Stream is registered/started

A stream is typically started via:

- `POST /api/streams/{stream_id}/start` (URL source), or
- `POST /api/streams/{stream_id}/upload` (uploaded file source),
- and a default stream may start during app lifespan startup.

When started, orchestrator:

- creates `DecodeThread`,
- registers it in `InferenceThread`,
- starts FFmpeg publisher subprocess,
- stores a `StreamHandle` for lifecycle management.

### Step 1: Client opens detections websocket

Client connects to:

- `GET ws /api/detections/ws/{stream_id}`

API does:

- validates `stream_id`,
- calls `orchestrator.acquire_stream_viewer(stream_id)`,
- subscribes to Redis channel `detections:{stream_id}`.

If stream is missing or worker limit is reached, API returns a websocket error/close.

### Step 2: Viewer attachment updates orchestrator state

`acquire_stream_viewer`:

- increments `viewer_count`,
- refreshes heartbeat timestamps,
- marks this stream as active in inference (`set_active_stream(stream_id)`).

If stream was previously stopped for no-viewer timeout but config still exists, orchestrator can spawn it again.

### Step 3: Decode thread keeps latest frame ready

Decode thread continuously:

- reads frames from source,
- handles pacing and reconnection logic,
- updates `(frame, frame_idx, timestamp_ms)` in shared slot.

Inference always consumes the most recent available frame, not a full frame queue.

### Step 4: Inference thread runs model

Inference thread loop:

- checks active stream,
- fetches latest frame from its decode thread,
- skips if frame index is unchanged,
- runs detector (`RT-DETR`) with tracking,
- publishes payload to Redis.

Published payload contains fields like:

- `type = "detections"`,
- `frame_index`, `timestamp_ms`,
- `fps`, `inference_fps`,
- `vessels` (detections with optional tracking IDs).

### Step 5: API forwards Redis messages to websocket client

API websocket handler listens on Redis pub/sub and forwards each message to client as text.

So the browser receives near real-time detection JSON without directly touching model code.

### Step 6: Client disconnects

On disconnect:

- API unsubscribes/cleans pubsub,
- calls `orchestrator.release_stream_viewer(stream_id)`.

If no viewers remain, orchestrator starts no-viewer timeout logic.

## Monitoring, timeouts, and restart behavior

The monitor thread periodically checks stream health:

- **No-viewer timeout**
  - Stops streams with zero viewers for too long.
  - Keeps stream config, so later viewers can auto-restart stream.
- **Idle timeout**
  - Stops streams with no heartbeat updates for too long.
- **Decode thread crash**
  - Schedules restart with exponential backoff.
- **FFmpeg subprocess crash**
  - Attempts immediate FFmpeg restart.

This is why stream lifecycle is resilient without manual intervention.

## Why Redis is in the middle

Redis decouples inference from websocket delivery:

- inference thread can publish once,
- many clients can subscribe,
- API websocket handlers stay lightweight and stateless per message.

## Typical request paths you will touch first

- Stream start: `POST /api/streams/{stream_id}/start`
- Detections socket: `ws /api/detections/ws/{stream_id}`
- Heartbeat: `POST /api/streams/{stream_id}/heartbeat`
- Stream status: `GET /api/streams`
- Stop stream: `DELETE /api/streams/{stream_id}`

## Quick debugging checklist

- No detections in client:
  - Check websocket connected to correct `stream_id`.
  - Check Redis channel traffic (`detections:{stream_id}`).
  - Check inference thread logs for first processed frame.
- Stream shows but no video playback:
  - Check FFmpeg process health and MediaMTX URLs.
  - Verify `MEDIAMTX_*` config and credentials.
- Stream dies unexpectedly:
  - Check monitor logs for idle/no-viewer timeout.
  - Check decode reconnect/restart logs and source URL availability.
