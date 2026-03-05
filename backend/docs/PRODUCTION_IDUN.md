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

## 4. Coolify / Traefik WebSocket

If WebSocket returns 404 over HTTPS, try these in order:

**1. Disable gzip** — Coolify → Backend → Advanced → uncheck **Enable gzip compression**. Redeploy. (Gzip can break WebSocket upgrades.)

**2. One label** — If gzip can't be disabled via UI, add this label (Backend → Docker Labels). Replace the suffix with your resource ID:
```
traefik.http.routers.https-0-iwcgkgc40s8s0cosoggkk088.middlewares=
```
Empty value removes gzip from that router. API responses will be slightly larger; WebSocket will work.

**3. Cloudflare Tunnel** — If neither works, use Section 2: run `cloudflared tunnel` and point IDUN at the tunnel URL.

## 5. Auth — "No Better Auth session cookie found"

When the frontend (`app.demo.bridgable.ai`) calls the backend (`api.demo.bridgable.ai`), the browser only sends cookies that match the request domain. Better Auth cookies are set by the auth service; if they're scoped to the auth subdomain only, they won't be sent to the API.

**Fix:** Enable cross-subdomain cookies in the auth-service. Set:

```env
BETTER_AUTH_COOKIE_DOMAIN=demo.bridgable.ai
```

Use your root domain (e.g. `demo.bridgable.ai` or `bridgable.ai`). Cookies will then be shared across `app.demo.bridgable.ai`, `api.demo.bridgable.ai`, and the auth subdomain.

Also ensure:
- `CORS_ORIGIN` (auth-service) includes your frontend URL, e.g. `https://app.demo.bridgable.ai`
- `CORS_ORIGINS` (backend) includes your frontend URL
- Frontend uses `credentials: "include"` (already set in `api-client.ts`)

**After deploying:** Users must log out and log back in so cookies are re-set with the shared domain.

## 6. Redis — "Temporary failure in name resolution"

The backend uses Redis for detection pub/sub. If you see `Error -3 connecting to redis:6379. Temporary failure in name resolution`, the backend cannot reach Redis.

**Fix:** Set `REDIS_URL` to a host the backend can resolve:

- **Coolify with linked Redis:** If Redis is a separate Coolify service, use its internal URL (e.g. `redis://<redis-service-name>:6379/0`). Check Coolify's service networking.
- **Same compose stack:** `redis://redis:6379/0` (works when backend and Redis share a network).
- **Managed Redis (Upstash, etc.):** Use the provider's connection URL.
- **Host Redis:** `redis://host.docker.internal:6379/0` (macOS/Windows) or host IP on Linux.

## 7. MediaMTX (Coolify)

When MediaMTX is deployed as a separate Coolify service with a domain (e.g. `https://mediamtx.bridgable.ai`):

**Backend env:**
```env
MEDIAMTX_URL=https://mediamtx.bridgable.ai
MEDIAMTX_RTSP_BASE=rtsp://media-mtx:8554
```

`MEDIAMTX_RTSP_BASE` uses the internal service name so FFmpeg can push RTSP (backend and MediaMTX must share a network).

## 8. Fusion stream — API URL stored as S3 key

If the fusion video fails because `media_assets` has an API URL (e.g. `https://api.demo.bridgable.ai/api/video/fusion?profile=pirbadet`) instead of a real S3 path:

**Fix:** Run migration `010_fix_fusion_video_s3_keys.sql`:

```bash
psql $DATABASE_URL -f backend/migrations/010_fix_fusion_video_s3_keys.sql
```

Or apply via your migration runner. Edit the migration to use your actual Pirbadet video S3 path if it differs from the default.

## 9. Flow

1. Backend starts with `IDUN_ENABLED=true` — no local model loaded.
2. Default stream starts (if `SKIP_DEFAULT_STREAM=false` and a video source exists).
3. IDUN worker connects to `/api/idun/ws` via the tunnel.
4. Backend sends frames to IDUN; IDUN runs inference and returns detections.
5. Detections are published to Redis and consumed by the frontend.
