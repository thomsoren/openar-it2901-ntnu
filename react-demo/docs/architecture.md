# React Demo Architecture

## Overview

The react-demo application demonstrates real-time visualization of precomputed object detections overlaid on video content using augmented reality Point of Interest (POI) markers. The application uses OpenBridge web components for maritime-standard UI elements.

## Architecture Principles

1. **Separation of Concerns** - Logic, data, and presentation are clearly separated
2. **Single Source of Truth** - Shared types and constants prevent duplication
3. **Reusability** - Utility functions and hooks are modular and composable
4. **Type Safety** - Strong TypeScript typing throughout the application

## Project Structure

```
src/
├── types/           # Shared TypeScript type definitions
├── utils/           # Pure utility functions and algorithms
├── config/          # Application configuration constants
├── hooks/           # React custom hooks
├── components/      # React UI components
├── App.tsx          # Main application component
└── main.tsx         # Application entry point
```

## Directory Details

### `/src/types/`

**Purpose:** Centralized type definitions used across the application.

**Files:**
- `detection.ts` - Core detection and tracking types
  - `Detection` - Bounding box object detection data
  - `FrameDetection` - Detection data tied to video frame/timestamp
  - `TrackedDetection` - Detection with tracking metadata (streak, missed frames)

**Benefits:**
- Single source of truth for types
- Prevents duplicate type definitions
- Easy to maintain and evolve

---

### `/src/utils/`

**Purpose:** Pure utility functions containing business logic.

**Files:**
- `detection-tracking.ts` - Detection tracking and filtering algorithms
  - **Constants:** MIN_STABLE_FRAMES, MAX_MATCH_DISTANCE_PX, MAX_MISSED_FRAMES
  - **Functions:**
    - `getCenter()` - Calculate center point of detection bounding box
    - `updateTrackedDetections()` - Main tracking algorithm that matches detections across frames
    - `filterVisibleDetections()` - Filter out uncategorized/invalid detections

**Tracking Algorithm:**

The tracking system maintains stable detection across video frames:

1. **Matching:** New detections are matched to previous ones based on:
   - Same object class
   - Proximity (within MAX_MATCH_DISTANCE_PX = 60 pixels)
   - Closest Euclidean distance

2. **Streaks:** Each matched detection increments its "streak" counter

3. **Missed Frames:** Unmatched previous detections increment "missed" counter and are retained for up to MAX_MISSED_FRAMES = 6

4. **Stability Filtering:** Only detections with streak ≥ MIN_STABLE_FRAMES (3) are shown, reducing jitter

**Return Value:**

The `updateTrackedDetections()` function returns an object with two properties:

```typescript
{
  trackingState: TrackedDetection[];    // Full tracking state (preserves streak/missed)
  visibleDetections: Detection[];       // Filtered detections ready to display
}
```

**Critical: State Management**

The tracking state **must be preserved** between frames. The hook correctly maintains this:

```typescript
const { trackingState, visibleDetections } = updateTrackedDetections(
  trackedDetectionsRef.current,  // Previous state
  closestFrame.detections         // New raw detections
);
trackedDetectionsRef.current = trackingState;  // ✅ Preserve full state
setCurrentDetections(visibleDetections);        // ✅ Display filtered results
```

**Why This Matters:**

If tracking state is lost (streak reset to 1), detections will **never** reach the MIN_STABLE_FRAMES threshold and won't be visible. The state must accumulate across frames.

**Debug Logging:**

The hook logs detection processing to the console:
```
[usePrecomputedDetections] Frame 5 @ 0.20s: 1 raw -> 1 tracked -> 0 visible
```
- **raw:** Detections from JSON/API
- **tracked:** Total in tracking state
- **visible:** Passed stability filter (streak ≥ 3)

**Benefits:**
- Testable pure functions
- No React dependencies
- Reusable in other contexts
- Clear state management contract

---

### `/src/config/`

**Purpose:** Centralized configuration constants.

**Files:**
- `video.ts` - Video, API, and POI configuration
  - `API_CONFIG` - Backend API base URL (configurable via VITE_API_URL env var)
  - `VIDEO_CONFIG` - Video dimensions, API endpoints for video/detections
  - `POI_CONFIG` - POI marker settings (height, etc.)

**API Integration:**

The application connects to a FastAPI backend server to fetch detections and video:

```typescript
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || "http://localhost:8000",
} as const;

export const VIDEO_CONFIG = {
  WIDTH: 1920,
  HEIGHT: 1080,
  SOURCE: `${API_CONFIG.BASE_URL}/api/video`,
  DETECTIONS_URL: `${API_CONFIG.BASE_URL}/api/detections`,
  // Fallback to local files if needed
  LOCAL_SOURCE: "/Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4",
  LOCAL_DETECTIONS_URL: "/detections.json",
} as const;
```

**Environment Configuration:**

Set the backend URL in `.env`:
```bash
VITE_API_URL=http://localhost:8000
```

**Benefits:**
- Environment-specific configuration
- Easy to switch between API and local files
- Prevents magic numbers in code
- Single location for all configuration

---

### `/src/hooks/`

**Purpose:** Custom React hooks encapsulating stateful logic.

**Files:**
- `usePrecomputedDetections.ts` - Loads and syncs precomputed detections with video playback

**Hook Responsibilities:**
1. **Data Loading**
   - Fetches detection JSON from URL
   - Handles loading and error states

2. **Video Synchronization**
   - Uses requestAnimationFrame for smooth updates
   - Matches detections to current video time
   - Handles video play/pause/seek

3. **Tracking Integration**
   - Applies tracking algorithm to raw detections
   - Maintains tracking state across frames

**Returns:**
```typescript
{
  detections: Detection[],  // Current filtered & tracked detections
  isLoading: boolean,        // Data loading state
  error: string | null,      // Error message if any
  totalFrames: number        // Total detection frames loaded
}
```

**Benefits:**
- Encapsulates complex state management
- Reusable across components
- Testable in isolation
- Clear API contract

---

### `/src/components/`

**Purpose:** React UI components (presentation layer).

**Structure:**
```
components/
└── poi-overlay/
    ├── PoiOverlay.tsx
    └── PoiOverlay.css
```

#### `PoiOverlay` Component

**Responsibilities:**
- Render POI markers at detection coordinates
- Convert absolute pixel coordinates to responsive percentages
- Apply visibility filtering
- Optimize with React.memo

**Props:**
```typescript
interface PoiOverlayProps {
  detections?: Detection[];
}
```

**Implementation Details:**
- Uses `filterVisibleDetections()` to exclude uncategorized items
- Converts coordinates from absolute (1920x1080) to percentage-based positioning
- Renders `ObcPoiTarget` components from OpenBridge library
- CSS handles pointer events (non-interactive overlay, interactive markers)

**Benefits:**
- Pure presentation logic
- Responsive design
- Performance optimized
- Clean separation from business logic

---

## Data Flow

### Full System Data Flow (with Backend API)

```
Backend FastAPI Server (http://localhost:8000)
├── GET /api/detections → detections.json
└── GET /api/video → video.mp4
    ↓
Frontend React App (http://localhost:5173)
    ↓
Video Element (ref)
    ↓
[usePrecomputedDetections Hook]
    ↓
1. Fetch detections from API (http://localhost:8000/api/detections)
2. Sync with video.currentTime (requestAnimationFrame loop)
3. Find matching frame (by timestamp)
4. Apply tracking algorithm (utils/detection-tracking.ts)
   - Match detections to previous frame
   - Update streak/missed counters
   - Filter: streak ≥ 3, missed ≤ 6
    ↓
Tracked Detections (Detection[])
    ↓
[PoiOverlay Component]
    ↓
1. Filter visible detections (exclude "uncategorized")
2. Convert coordinates to percentages (1920x1080 → %)
3. Render ObcPoiTarget markers
    ↓
Visual Output (POI markers overlaid on video)
```

### Detection Processing Pipeline

```
Raw Detection from API
{
  "x": 1800,
  "y": 583,
  "width": 118,
  "height": 32,
  "confidence": 0.38,
  "class": "boat"
}
    ↓
Frame 1: streak=1, missed=0 → ❌ Not visible (streak < 3)
    ↓
Frame 2: streak=2, missed=0 → ❌ Not visible (streak < 3)
    ↓
Frame 3: streak=3, missed=0 → ✅ VISIBLE (streak ≥ 3)
    ↓
Frame 4-9: streak=4-9, missed=0 → ✅ VISIBLE
    ↓
Frame 10: Detection lost, missed=1 → ✅ Still visible (missed ≤ 6)
    ↓
Frame 11-16: missed=2-7 → Frame 16: ❌ Removed (missed > 6)
```

## Component Hierarchy

```
App
├── ObcTopBar (OpenBridge)
│   ├── ObcClock
│   └── ObcBrillianceMenu
├── Video Element (ref passed to hook)
└── PoiOverlay
    └── ObcPoiTarget (for each detection)
```

## Key Design Decisions

### 1. Backend API Integration

**Architecture:** Frontend fetches data from FastAPI backend server

**Endpoints:**
- `GET /api/detections` - Detection data (JSON)
- `GET /api/video` - Video stream (MP4 with range request support)
- `GET /health` - Health check and file availability

**Benefits:**
- **Separation:** Backend handles data storage/processing, frontend handles visualization
- **Scalability:** Easy to add authentication, caching, or real-time updates
- **Flexibility:** Can switch data sources without changing frontend code
- **Production-ready:** Simulates real-world deployment architecture

**Configuration:**

Environment variable in `.env`:
```bash
VITE_API_URL=http://localhost:8000
```

Used in config:
```typescript
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || "http://localhost:8000",
} as const;
```

**CORS:** Backend configured to accept requests from dev servers (localhost:5173, localhost:3000)

---

### 2. Precomputed vs. Real-time Detection

**Current:** Loads precomputed detections from backend API
**Reason:** Predictable performance, no inference overhead, demo-friendly

**Future:** The architecture supports adding real-time inference via a new hook (e.g., `useRealtimeInference`) without changing the component layer.

---

### 3. Tracking Algorithm

**Why needed:** Raw detections can be noisy and unstable across frames

**Approach:**
- Match detections frame-to-frame by proximity and class
- Require minimum stable streak before showing
- Tolerate missed detections for smoother experience

**Tunable parameters:**
```typescript
MIN_STABLE_FRAMES = 3    // Show after 3 consecutive frames
MAX_MATCH_DISTANCE_PX = 60  // Match threshold
MAX_MISSED_FRAMES = 6    // Keep for 6 frames after disappearing
```

---

### 4. Coordinate System

**Detection Space:** 1920x1080 (video resolution)
**Display Space:** Percentage-based (responsive)

**Conversion:** `(x / VIDEO_WIDTH) * 100 + '%'`

**Benefits:**
- Works across different display sizes
- Maintains correct positioning when video scales
- CSS transform centers POI on detection point

---

### 5. Type Safety

All detection data is strongly typed:
```typescript
Detection → FrameDetection → TrackedDetection
```

This catches errors at compile time and provides IDE autocomplete.

---

## Performance Considerations

1. **requestAnimationFrame:** Efficient video sync without blocking main thread

2. **React.memo:** PoiOverlay only re-renders when detections change

3. **Tracking State:** Uses refs for tracking state to avoid unnecessary re-renders

4. **Early Termination:** Binary-search-like optimization in detection matching

5. **Filtering:** Visibility filtering happens before rendering

---

## Testing Strategy

### Unit Tests (utils/)
- Test tracking algorithm with various frame sequences
- Test coordinate conversion functions
- Test filtering logic

### Hook Tests (hooks/)
- Mock video ref and fetch
- Test sync with video playback
- Test loading/error states

### Component Tests (components/)
- Test rendering with various detection arrays
- Test coordinate conversion
- Test visibility filtering integration

---

## Future Enhancements

### Potential Additions

1. **Real-time Inference Hook**
   ```typescript
   useRealtimeInference(videoRef, modelConfig)
   ```
   - Would return same interface as usePrecomputedDetections
   - PoiOverlay remains unchanged

2. **Detection Details Panel**
   - Click POI to show detection metadata
   - Confidence score, class label, etc.

3. **Detection History/Trails**
   - Show motion trails for tracked objects
   - Requires extending TrackedDetection with position history

4. **Configurable Tracking Parameters**
   - UI controls for MIN_STABLE_FRAMES, etc.
   - A/B testing different tracking strategies

5. **Multiple Detection Sources**
   - Combine precomputed + real-time
   - Merge detections from multiple models

---

## Dependencies

### Core
- React 18+ (hooks, memo)
- TypeScript (type safety)

### UI Components
- OpenBridge Web Components (maritime-standard UI)
  - `ObcTopBar`, `ObcClock`, `ObcBrillianceMenu`
  - `ObcPoiTarget` (AR marker)

### Build Tools
- Vite (fast development and bundling)

---

## Conventions

### File Naming
- Components: PascalCase (PoiOverlay.tsx)
- Hooks: camelCase with "use" prefix (usePrecomputedDetections.ts)
- Utils: camelCase (detection-tracking.ts)
- Types: camelCase (detection.ts)
- Config: camelCase (video.ts)

### Folder Structure
- Components get their own folder with co-located CSS
- One component per file
- Index files NOT used (explicit imports preferred)

### Code Style
- Functional components (no classes)
- Hooks for state management
- Pure functions where possible
- JSDoc comments for complex logic

---

## Troubleshooting

### Detections not appearing

**Backend API Issues:**
1. **Check backend is running:**
   ```bash
   curl http://localhost:8000/health
   ```
   Should return `"status": "healthy"` with file information.

2. **Check CORS errors in browser console:**
   - If you see CORS errors, verify backend is running on port 8000
   - Check frontend .env has `VITE_API_URL=http://localhost:8000`

3. **Verify API endpoints:**
   ```bash
   # Test detections endpoint
   curl http://localhost:8000/api/detections | jq '. | length'

   # Test video endpoint
   curl -I http://localhost:8000/api/video
   ```

**Frontend Issues:**
1. **Check browser console for logs:**
   - Should see: `[usePrecomputedDetections] Loaded XXXX detection frames from API`
   - Should see detection processing logs when video plays

2. **Check video is playing:**
   - Detections only sync when video is playing (not paused)
   - Click play on the video element

3. **Understanding the 3-frame delay:**
   - Detections require **3 consecutive frames** (MIN_STABLE_FRAMES) before appearing
   - This is intentional to reduce false positives
   - Check console for: `X raw -> Y tracked -> 0 visible` (means streak < 3)
   - Wait for: `X raw -> Y tracked -> Z visible` (means streak ≥ 3)

**Debug Steps:**

1. Open browser console (F12)
2. Look for detection logs:
   ```
   [usePrecomputedDetections] Loaded 4500 detection frames from API
   [usePrecomputedDetections] Frame 3 @ 0.12s: 1 raw -> 1 tracked -> 0 visible
   [usePrecomputedDetections] Frame 8 @ 0.32s: 1 raw -> 1 tracked -> 1 visible
   ```
3. If you see "0 visible" persistently:
   - Reduce MIN_STABLE_FRAMES in `utils/detection-tracking.ts` (try 1 or 2)
   - Check if detections have `class: "boat"` (not "uncategorized")

**Tracking State Lost:**

If tracking state is improperly reset, detections will never accumulate streak:

```typescript
// ❌ WRONG - This resets streak to 1 every frame
trackedDetectionsRef.current = detections.map(d => ({
  detection: d,
  streak: 1,  // Always 1, never reaches 3!
  missed: 0
}));

// ✅ CORRECT - Preserve tracking state
const { trackingState, visibleDetections } = updateTrackedDetections(
  trackedDetectionsRef.current,
  detections
);
trackedDetectionsRef.current = trackingState;  // Keeps streak accumulating
```

### Jittery POIs
- Adjust tracking parameters in `utils/detection-tracking.ts`
- Increase MIN_STABLE_FRAMES for more stability (reduces false positives)
- Increase MAX_MISSED_FRAMES for smoother transitions (keeps POIs visible longer)
- Increase MAX_MATCH_DISTANCE_PX if detections move quickly between frames

### Performance issues
- Check detection count per frame in console logs
- Consider throttling tracking updates (process every Nth frame)
- Profile with React DevTools
- Check if backend is serving video efficiently (check network tab)

### Backend connection issues
1. **"Failed to load detections" error:**
   - Ensure backend is running: `cd backend && uv run python api.py`
   - Check `backend/data/raw/detections.json` exists

2. **Video not loading:**
   - Check `backend/data/processed/video/*.mp4` exists
   - Verify file path in backend `api.py` matches actual file
   - Check browser network tab for 404 or 500 errors

3. **Port conflicts:**
   - Backend should run on port 8000
   - Frontend should run on port 5173
   - Change ports in `.env` if needed

---

## Maintainability Checklist

- ✅ No duplicate types or constants
- ✅ Clear separation of concerns
- ✅ Pure functions are testable
- ✅ Configuration is centralized
- ✅ Components are focused and single-purpose
- ✅ Hooks have clear responsibilities
- ✅ Code is documented where non-obvious
