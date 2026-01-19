import { useEffect, useState, useRef } from "react";
import { Detection, FrameDetection, TrackedDetection } from "../types/detection";
import { updateTrackedDetections } from "../utils/detection-tracking";
import { VIDEO_CONFIG } from "../config/video";

/**
 * Hook to load and sync precomputed detections with video playback
 * Loads detection data from JSON file and updates based on current video time
 */
export const usePrecomputedDetections = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  detectionsUrl: string = VIDEO_CONFIG.DETECTIONS_URL
) => {
  const [allDetections, setAllDetections] = useState<FrameDetection[]>([]);
  const [currentDetections, setCurrentDetections] = useState<Detection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fpsEstimate, setFpsEstimate] = useState<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const trackedDetectionsRef = useRef<TrackedDetection[]>([]);

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
        console.log(`[usePrecomputedDetections] Loaded ${data.length} detection frames from API`);
        setAllDetections(data);

        // Calculate FPS estimate from detection data
        if (data.length >= 2) {
          const first = data[0];
          const last = data[data.length - 1];
          const durationSeconds = last.timestamp - first.timestamp;
          const frameSpan = last.frame - first.frame;
          if (durationSeconds > 0 && frameSpan > 0) {
            setFpsEstimate(frameSpan / durationSeconds);
          }
        }

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

    const syncDetections = () => {
      if (video.paused || video.ended) {
        animationFrameRef.current = requestAnimationFrame(syncDetections);
        return;
      }

      const currentTime = video.currentTime;

      // Find the detection frame closest to current video time
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
          animationFrameRef.current = requestAnimationFrame(syncDetections);
          return;
        }

        lastFrameRef.current = closestFrame.frame;
        const { trackingState, visibleDetections } = updateTrackedDetections(
          trackedDetectionsRef.current,
          closestFrame.detections
        );
        trackedDetectionsRef.current = trackingState;

        // Log when visible detections change
        if (visibleDetections.length !== currentDetections.length) {
          console.log(
            `[usePrecomputedDetections] Frame ${closestFrame.frame} @ ${currentTime.toFixed(2)}s: ` +
            `${closestFrame.detections.length} raw -> ${trackingState.length} tracked -> ${visibleDetections.length} visible`
          );
        }

        setCurrentDetections(visibleDetections);
      } else {
        lastFrameRef.current = null;
        const { trackingState, visibleDetections } = updateTrackedDetections(
          trackedDetectionsRef.current,
          []
        );
        trackedDetectionsRef.current = trackingState;
        setCurrentDetections(visibleDetections);
      }

      animationFrameRef.current = requestAnimationFrame(syncDetections);
    };

    syncDetections();

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
    fpsEstimate,
  };
};
