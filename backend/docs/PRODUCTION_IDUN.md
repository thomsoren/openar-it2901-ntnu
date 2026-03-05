# Production deployment with IDUN remote inference

When running on a VM without a GPU (e.g. Hetzner), the CV model cannot run locally. Use **IDUN remote inference**: the backend sends frames to an IDUN worker (on a machine with the model) via WebSocket, and receives detections back.

## 1. Backend (Hetzner VM)

**FFmpeg is required** for transcoding video to MediaMTX. The `backend/nixpacks.toml` adds `ffmpeg`, `libstdc++6` (for NumPy/OpenCV), and OpenGL libs via `aptPkgs` at build time. No custom entrypoint needed.

If Nixpacks isn't used, add **Coolify Custom Docker Options**:
```
--entrypoint "sh -c 'apt-get update && apt-get install -y ffmpeg libstdc++6 && cd /app && exec /opt/venv/bin/python -m main'"
```

Set in your environment:

```env
IDUN_ENABLED=true
IDUN_API_KEY=<shared-secret-with-idun-worker>
```

Optional:

- `SKIP_DEFAULT_STREAM=true` — do not auto-start a stream on boot; streams are started via API when needed.
- `IDUN_FRAME_JPEG_QUALITY=80` — JPEG quality for frames sent to IDUN (default 80).
- `IDUN_TARGET_SEND_FPS=15` — max FPS for frames sent to IDUN (default 15).

The backend exposes a WebSocket at `/api/idun/ws`. The **IDUN worker connects to the backend** (not the other way around), so the backend must be reachable from the school network.

## 2. Tunnel (IDUN → Hetzner)

IDUN is on the school network; the backend is on Hetzner. You need a tunnel so IDUN can reach the backend.

### Option A: Cloudflare Tunnel (recommended)

On the Hetzner VM:

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared

# Quick tunnel (no account, temporary URL)
./cloudflared tunnel --url http://localhost:8000
# Prints: https://xxx-xxx-xxx.trycloudflare.com
```

IDUN connects to `wss://xxx-xxx-xxx.trycloudflare.com/api/idun/ws`.

For a persistent URL, use a [Cloudflare Tunnel with a named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/).

### Option B: ngrok

```bash
ngrok http 8000
# Use the HTTPS URL for WebSocket: wss://xxx.ngrok.io/api/idun/ws
```

### Option C: Tailscale

If both Hetzner and the IDUN machine can run Tailscale, they get private IPs. IDUN connects to `ws://<hetzner-tailscale-ip>:8000/api/idun/ws`. Requires Tailscale to be allowed on the school network.

## 3. IDUN worker (school network)

The IDUN worker runs the CV model and connects to the backend WebSocket. Configure it with:

- `IDUN_WS_URL=wss://<tunnel-url>/api/idun/ws`
- `IDUN_API_KEY=<same as backend>`

The worker initiates the connection, so outbound HTTPS/WSS from the school network to the tunnel URL must be allowed.

## 4. Flow

1. Backend starts with `IDUN_ENABLED=true` — no local model loaded.
2. Default stream starts (if `SKIP_DEFAULT_STREAM=false` and a video source exists).
3. IDUN worker connects to `/api/idun/ws` via the tunnel.
4. Backend sends frames to IDUN; IDUN runs inference and returns detections.
5. Detections are published to Redis and consumed by the frontend.
