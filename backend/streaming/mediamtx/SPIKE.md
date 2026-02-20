# MediaMTX Spike (Issue: Backend video delivery)

Date: 2026-02-20

## Scope
Validate stdin -> FFmpeg -> RTSP(MediaMTX) -> WebRTC/HLS viability and auth hook behavior before replacing MJPEG.

## Environment
- Host: macOS 14.2.1 (Apple Silicon)
- Runtime: Docker Desktop
- Media server: `bluenviron/mediamtx:latest` (v1.16.1)
- FFmpeg: `jrottenberg/ffmpeg:6.1-alpine`

## Configs added
- `backend/streaming/mediamtx/mediamtx.yml`
- `backend/streaming/mediamtx/mediamtx.auth.yml`
- `backend/streaming/mediamtx/mediamtx.auth.docker.yml`
- `backend/streaming/mediamtx/auth_mock.py`
- `backend/streaming/mediamtx/docker-compose.spike.yml`

## Validation results

### 1) MediaMTX accepts RTSP publish
Status: PASS

Evidence (logs):
- `is publishing to path 'test'`
- `stream is available and online, 1 track (H264)`

### 2) FFmpeg CLI publish from MP4 works
Status: PASS

Command used:
```bash
ffmpeg -re -i spike_sample.mp4 -c:v libx264 -preset ultrafast -tune zerolatency \
  -rtsp_transport tcp -f rtsp rtsp://localhost:8554/test
```

Note: `-rtsp_transport tcp` prevented transport negotiation issues.

### 3) FFmpeg stdin pipe (raw BGR24) publish works
Status: PASS

Validated by piping generated raw BGR24 frames into FFmpeg stdin and publishing to RTSP path `pipe-cpu`.

CPU command validated:
```bash
ffmpeg -f rawvideo -pix_fmt bgr24 -s 640x360 -r 30 -i pipe:0 \
  -c:v libx264 -preset ultrafast -tune zerolatency -g 30 -keyint_min 30 \
  -rtsp_transport tcp -f rtsp rtsp://localhost:8554/pipe-cpu
```

### 4) WebRTC WHEP endpoint
Status: PARTIAL (endpoint verified, headless playback not fully measured)

- `OPTIONS /<path>/whep` returned `204` (with auth when enabled)
- `POST /<path>/whep` with invalid SDP returned protocol-level validation error (`400`), confirming WHEP handler is active.

Limitation: glass-to-glass display timing requires a real browser rendering loop; this spike environment is CLI/headless.

### 5) HLS fallback
Status: PASS

- HLS master and media playlists returned successfully.
- Low-latency HLS parts observed (`#EXT-X-PART:DURATION=0.20000`).

### 6) h264_nvenc vs libx264
Status: PARTIAL

- `libx264`: PASS
- `h264_nvenc`: FAIL in this environment (expected, no NVIDIA stack/encoder in container)

Observed error:
- `Unknown encoder 'h264_nvenc'`

### 7) MediaMTX auth hook
Status: PASS

Validated with `authMethod: http` and mock callback service.

Observed callback payload fields include:
- `action` (`publish`, `read`)
- `path`
- `protocol` (`rtsp`, `hls`)
- `user`, `password`, `token`, `ip`, `query`

Behavior validated:
- publish without creds -> `401`
- publish with `student:secret` -> `200` and stream accepted
- HLS read without creds -> `401`
- HLS read with creds -> `200`

## Latency findings

Measured proxy metric: publish start -> first HLS manifest availability.

- Default x264 GOP (`keyint=250`): ~8546 ms (too high)
- Tuned x264 GOP (`-g 30 -keyint_min 30`): ~1685 ms
- stdin pipe + tuned x264: ~2779 ms

Interpretation:
- GOP/keyframe cadence dominates startup latency.
- For low latency, force short GOP and zerolatency tune.

Glass-to-glass `<300ms` WebRTC target:
- Not proven in this headless spike.
- Requires browser-based measurement harness (canvas timestamp overlay + receive timestamp capture).

## Open questions answered

### Should MediaMTX run sidecar or independently?
Recommendation:
- Production: independent service (Docker/systemd/K8s deployment), shared by backend replicas.
- Local dev: sidecar is acceptable for convenience.

Reason:
- Independent deployment avoids coupling app lifecycle to media process and supports horizontal fan-out.

### Latency delta: `h264_nvenc` vs `libx264`
- Could not benchmark NVENC on this host.
- Expected in NVIDIA environments: NVENC lower CPU and typically lower encode latency under load.
- Action: run same stdin pipeline benchmark on an NVIDIA host and capture p50/p95 encode + glass-to-glass.

### Does auth hook support per-path JWT validation?
Yes.
- Hook receives `path` and `token` fields; an external auth service can validate JWT and enforce per-path policy.

## Architectural implications for this repo

Previous backend path used MJPEG queue (`/api/video/mjpeg/{stream_id}`); this spike migrates to MediaMTX delivery.

Target architecture:
- Worker emits raw frames -> FFmpeg subprocess encodes H.264 -> RTSP publish to MediaMTX path per stream.
- Browser consumes via WHEP (`http://<mediamtx>:8889/<stream_id>/whep`) or HLS fallback.
- Existing Redis pub/sub for detections remains unchanged.

## Next implementation step (post-spike)
1. Add FFmpeg publisher lifecycle to `backend/cv/worker.py`.
2. Replace MJPEG endpoint usage in frontend with WHEP player path + HLS fallback.
3. Add browser latency harness and set acceptance gate for `<300ms` p95 on local LAN.
