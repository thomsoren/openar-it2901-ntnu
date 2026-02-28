# S3 Asset Manifest

The `media_assets` table is the single source of truth for bucket-backed assets.

All keys are relative to `S3_PREFIX` (default: `openar`). Seed system assets via `backend/migrations/` or direct INSERT.

## Required Runtime Assets

| Feature / Page | Endpoint | Manifest field | Default object key |
|---|---|---|---|
| Datavision demo video | `/api/video/stream` | `video` | `video/hurtigruta-demo.mp4` |
| Fusion video | `/api/video/fusion` | `fusion_video` | `fvessel/segment-001/2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4` |
| Fusion ground truth | `/api/fusion/ws` (data load) | `gt_fusion` | `fvessel/segment-001/Video-01_gt_fusion.txt` |
| Static detections file | `/api/detections/file` | `detections` | `detection/detections_yolo.json` |
| Components background | `/api/assets/oceanbackground` | `components_background` | `image/oceanbackground.png` |
| AIS sample fallback | internal | `ais` | `fvessel/segment-001/ais.csv` |

## Validation Checklist

1. Set backend S3 credentials (`S3_ACCESS_KEY`, `S3_SECRET_KEY`) or public base URL (`S3_PUBLIC_BASE_URL`).
2. Ensure all required keys above exist in the bucket.
3. Verify endpoints from the table return `200/206`.
4. Keep local files as development fallback only.

## Upload Key Policy

Uploads generated through `POST /api/storage/presign` use owner-aware keys:

- `videos/private/{groupId}/{userId}/{streamId}/{filename}` (default)
- `videos/group/{groupId}/{userId}/{streamId}/{filename}`
- `videos/public/{groupId}/{userId}/{streamId}/{filename}` (admin publish flow)
