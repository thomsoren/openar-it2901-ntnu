# Detection Stream Triage

Use this checklist when detections are missing in Fusion or Datavision.

## 1) Backend + Infra Health

1. Start stack: `pnpm dev`
2. Verify health endpoint: `curl http://localhost:8000/health`
3. Confirm backend logs show startup without fatal auth/db errors.

## 2) Video Source Availability

1. Fusion video: open `http://localhost:8000/api/video/fusion`
2. Main video stream: open `http://localhost:8000/api/video/stream`
3. If 404/500 appears, check S3 credentials and configured object keys.

## 3) Detection WebSocket Handshake

1. Open page status overlay.
2. Confirm:
   - `Connected`
   - non-empty `WS:` URL
   - `Last msg` updates
3. If disconnected, inspect browser network tab for:
   - `ws://.../api/fusion/ws` (Fusion)
   - `ws://.../api/detections/ws/{stream}` (Datavision)

## 4) Reset + Auth Path

1. Fusion must call `POST /api/fusion/reset` successfully.
2. For Datavision, confirm auth session/token exchange completes.
3. If auth fails, verify:
   - `backend/.env`
   - `frontend/.env`
   - `auth-service/.env`

## 5) Overlay Rendering

1. In status overlay, ensure `Vessels: N` is greater than zero.
2. Confirm AR controls do not hide detections (`detectionVisible` enabled).
3. If vessels exist but markers do not render, inspect `PoiOverlay` sizing and fit mode.
