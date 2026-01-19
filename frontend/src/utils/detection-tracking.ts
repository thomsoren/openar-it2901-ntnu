import { Detection, TrackedDetection } from "../types/detection";

export const MIN_STABLE_FRAMES = 3;
export const MAX_MATCH_DISTANCE_PX = 60;
export const MAX_MISSED_FRAMES = 6;

/**
 * Get the center point of a detection bounding box
 */
export const getCenter = (detection: Detection) => ({
  x: detection.x + detection.width / 2,
  y: detection.y + detection.height / 2,
});

/**
 * Update tracked detections with new frame detections
 * Implements tracking logic to maintain stable detections across frames
 *
 * Returns both the tracking state and the filtered visible detections
 */
export function updateTrackedDetections(
  previous: TrackedDetection[],
  detections: Detection[]
): { trackingState: TrackedDetection[]; visibleDetections: Detection[] } {
  const used = new Set<number>();
  const next: TrackedDetection[] = [];

  // Match new detections with previous ones
  for (const detection of detections) {
    const { x: cx, y: cy } = getCenter(detection);
    let bestIndex = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < previous.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const candidate = previous[i];
      if (candidate.detection.class !== detection.class) {
        continue;
      }

      const { x: px, y: py } = getCenter(candidate.detection);
      const distance = Math.hypot(cx - px, cy - py);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestDistance <= MAX_MATCH_DISTANCE_PX) {
      used.add(bestIndex);
      next.push({
        detection,
        streak: previous[bestIndex].streak + 1,
        missed: 0,
      });
    } else {
      next.push({ detection, streak: 1, missed: 0 });
    }
  }

  // Keep previous detections that weren't matched (within missed frame limit)
  for (let i = 0; i < previous.length; i += 1) {
    if (used.has(i)) {
      continue;
    }

    const previousItem = previous[i];
    const missed = previousItem.missed + 1;
    if (missed <= MAX_MISSED_FRAMES) {
      next.push({
        detection: previousItem.detection,
        streak: previousItem.streak,
        missed,
      });
    }
  }

  // Filter to only return stable detections
  const visibleDetections = next
    .filter(
      (item) =>
        item.streak >= MIN_STABLE_FRAMES && item.missed <= MAX_MISSED_FRAMES
    )
    .map((item) => item.detection);

  return {
    trackingState: next,
    visibleDetections,
  };
}

/**
 * Filter detections to only show visible/categorized ones
 */
export function filterVisibleDetections(detections: Detection[]): Detection[] {
  return detections.filter((detection) => {
    if (!detection.class) {
      return false;
    }
    return detection.class.toLowerCase() !== "uncategorized";
  });
}
