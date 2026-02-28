# PR Overlap Matrix

This document tracks overlap and ownership across active branches so we avoid duplicate fixes and merge churn.

## Active Branches

| Branch / PR | Scope | Status | Source of Truth | Notes |
|---|---|---|---|---|
| `feat/poi-controller-in-fvessel-view` / `#88` | Fusion POI controller + overlay integration | Active | Frontend fusion overlay work | Keep this branch focused on stabilization + docs + storage policy boundary |
| `85-refactor-frontend-and-backend-for-cleaner-code` / `#102` | Backend modularization + cleanup | Open review | Reference for backend structure/config fixes | Port minimal bugfixes only, no full merge in stabilization phase |
| `59-frontend-overlay-interpolation-25-hz-60-fps` / `#90` | Frontend interpolation + detector device tweaks | Open review | Reference for detection UX ideas | Branch still needs review fixes before becoming base |
| `48-detection-correction-pipeline-for-stable-vessel-tags` / `#53` | Detection correction pipeline | Deferred | Not prioritized | Only pull if needed for blockers |

## Overlap Hotspots

| Area | Main Files | Branches Touching | Decision |
|---|---|---|---|
| Fusion overlay behavior | `frontend/src/pages/Fusion.tsx`, `frontend/src/components/poi-overlay/PoiOverlay.tsx` | `#88`, partially `#90` ideas | Keep `#88` as owner |
| Detection transport / diagnostics | `frontend/src/hooks/useDetectionsWebSocket.ts`, `frontend/src/pages/Datavision.tsx` | `#88`, `#90` | Add diagnostics in this branch; avoid interpolation port for now |
| Backend API modularization | `backend/api.py`, `backend/webapi/**` | `#102` | Keep current backend stable; borrow only targeted fixes |
| CV runtime internals | `backend/cv/detectors.py`, `backend/cv/publisher.py` | `#90`, `#53`, `#102` | Do not reconcile now; defer to owners/reviewers |
| Storage policy + key layout | `backend/storage/s3.py`, `backend/api.py` | `#88`, partially `#102` infra cleanup | Implement minimal policy boundary in this branch |

## Stabilization Rules

1. If an issue is already fixed in `#102` or `#90`, port only the smallest safe patch.
2. Do not import `#53` correction pipeline unless a production blocker requires it.
3. Keep `#88` changes limited to:
   - detection reliability diagnostics,
   - env/setup docs consistency,
   - bucket-first asset source mapping,
   - presign storage policy enforcement.
4. Re-check this matrix before each PR update.
