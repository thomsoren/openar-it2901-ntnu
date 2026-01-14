import { useEffect, useState, useRef } from "react";

const MIN_STABLE_FRAMES = 3;
const MAX_MATCH_DISTANCE_PX = 60;
const MAX_MISSED_FRAMES = 6;

export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
}

interface FrameDetection {
  frame: number;
  timestamp: number;
  detections: Detection[];
}

interface TrackedDetection {
  detection: Detection;
  streak: number;
  missed: number;
}

export const useVideoDetections = (
  videoRef: React.RefObject<HTMLVideoElement>,
  detectionsUrl: string = "/detections.json"
) => {
  const [allDetections, setAllDetections] = useState<FrameDetection[]>([]);
  const [currentDetections, setCurrentDetections] = useState<Detection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const trackedDetectionsRef = useRef<TrackedDetection[]>([]);

  const getCenter = (detection: Detection) => ({
    x: detection.x + detection.width / 2,
    y: detection.y + detection.height / 2,
  });

  const updateTrackedDetections = (detections: Detection[]) => {
    const previous = trackedDetectionsRef.current;
    const used = new Set<number>();
    const next: TrackedDetection[] = [];

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

    trackedDetectionsRef.current = next;
    return next
      .filter(
        (item) =>
          item.streak >= MIN_STABLE_FRAMES &&
          item.missed <= MAX_MISSED_FRAMES
      )
      .map((item) => item.detection);
  };

  // Load detections JSON on mount
  useEffect(() => {
    const loadDetections = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(detectionsUrl);

        if (!response.ok) {
          throw new Error(`Failed to load detections: ${response.status}`);
        }

        const data: FrameDetection[] = await response.json();
        setAllDetections(data);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load detections");
        setIsLoading(false);
      }
    };

    loadDetections();
  }, [detectionsUrl]);

  // Sync detections with video playback
  useEffect(() => {
    if (!videoRef.current || allDetections.length === 0) {
      return;
    }

    const video = videoRef.current;

    const updateDetections = () => {
      if (video.paused || video.ended) {
        animationFrameRef.current = requestAnimationFrame(updateDetections);
        return;
      }

      const currentTime = video.currentTime;

      // Find the detection frame closest to current video time
      // Using binary search for efficiency with large detection arrays
      let closestFrame: FrameDetection | null = null;
      let minDiff = Infinity;

      for (const frame of allDetections) {
        const diff = Math.abs(frame.timestamp - currentTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestFrame = frame;
        }
        // Since timestamps are sequential, we can break early
        if (frame.timestamp > currentTime + 0.5) {
          break;
        }
      }

      if (closestFrame && minDiff < 0.5) {
        // Only update if timestamp is within 0.5 seconds
        if (lastFrameRef.current === closestFrame.frame) {
          animationFrameRef.current = requestAnimationFrame(updateDetections);
          return;
        }

        lastFrameRef.current = closestFrame.frame;
        setCurrentDetections(updateTrackedDetections(closestFrame.detections));
      } else {
        lastFrameRef.current = null;
        setCurrentDetections(updateTrackedDetections([]));
      }

      animationFrameRef.current = requestAnimationFrame(updateDetections);
    };

    updateDetections();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [videoRef, allDetections]);

  return {
    detections: currentDetections,
    isLoading,
    error,
    totalFrames: allDetections.length,
  };
};
