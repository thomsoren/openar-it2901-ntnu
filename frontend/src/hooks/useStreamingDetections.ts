import { useEffect, useRef, useState } from "react";
import { Detection, FrameDetection, TrackedDetection } from "../types/detection";
import { updateTrackedDetections } from "../utils/detection-tracking";
import { VIDEO_CONFIG } from "../config/video";

type StreamingState = {
  detections: Detection[];
  isStreaming: boolean;
  error: string | null;
  lastFrame: number | null;
  lastTimestamp: number | null;
  fpsEstimate: number | null;
};

/**
 * Hook to stream detections over SSE.
 * If no video element is provided, detections are applied immediately (MJPEG mode).
 */
export const useStreamingDetections = (
  videoRef?: React.RefObject<HTMLVideoElement | null>,
  streamUrl: string = VIDEO_CONFIG.DETECTIONS_STREAM_URL
): StreamingState => {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<number | null>(null);
  const [lastTimestamp, setLastTimestamp] = useState<number | null>(null);
  const [fpsEstimate, setFpsEstimate] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const trackedDetectionsRef = useRef<TrackedDetection[]>([]);
  const lastReceivedFrameRef = useRef<FrameDetection | null>(null);
  const bufferRef = useRef<FrameDetection[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const lastDisplayedTimestampRef = useRef<number | null>(null);

  const stopStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  };

  const startStream = (startTime?: number) => {
    if (typeof EventSource === "undefined") {
      setError("EventSource is not supported in this browser.");
      return;
    }

    stopStream();
    setError(null);
    bufferRef.current = [];
    trackedDetectionsRef.current = [];
    lastDisplayedTimestampRef.current = null;
    setDetections([]);
    setLastFrame(null);
    setLastTimestamp(null);

    const url = new URL(streamUrl);
    if (typeof startTime === "number") {
      url.searchParams.set("start_time", startTime.toString());
    }

    const eventSource = new EventSource(url.toString());
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsStreaming(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data) as FrameDetection;

        if (lastReceivedFrameRef.current) {
          const dt = frame.timestamp - lastReceivedFrameRef.current.timestamp;
          const frameSpan = frame.frame - lastReceivedFrameRef.current.frame;
          if (dt > 0 && frameSpan > 0) {
            setFpsEstimate(frameSpan / dt);
          }
        }

        lastReceivedFrameRef.current = frame;
        if (!videoRef) {
          const { trackingState, visibleDetections } = updateTrackedDetections(
            trackedDetectionsRef.current,
            frame.detections
          );
          trackedDetectionsRef.current = trackingState;
          setDetections(visibleDetections);
          setLastFrame(frame.frame);
          setLastTimestamp(frame.timestamp);
          lastDisplayedTimestampRef.current = frame.timestamp;
        } else {
          bufferRef.current.push(frame);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse stream data");
      }
    };

    eventSource.addEventListener("detections_error", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { message?: string };
        setError(data.message ?? "Detection error.");
      } catch {
        setError("Detection error.");
      }
      stopStream();
    });

    eventSource.onerror = () => {
      setError("Detections stream error.");
      stopStream();
    };
  };

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) {
      return;
    }

    const maxBufferSeconds = 5;
    const syncToleranceSeconds = 0.2;

    const syncDetections = () => {
      const currentTime = video.currentTime;
      const buffer = bufferRef.current;

      while (buffer.length > 0 && buffer[0].timestamp < currentTime - maxBufferSeconds) {
        buffer.shift();
      }

      let selectedIndex = -1;
      for (let i = 0; i < buffer.length; i += 1) {
        if (buffer[i].timestamp <= currentTime + syncToleranceSeconds) {
          selectedIndex = i;
        } else {
          break;
        }
      }

      if (selectedIndex >= 0) {
        const frame = buffer[selectedIndex];
        bufferRef.current = buffer.slice(selectedIndex + 1);

        const { trackingState, visibleDetections } = updateTrackedDetections(
          trackedDetectionsRef.current,
          frame.detections
        );
        trackedDetectionsRef.current = trackingState;
        setDetections(visibleDetections);
        setLastFrame(frame.frame);
        setLastTimestamp(frame.timestamp);
        lastDisplayedTimestampRef.current = frame.timestamp;
      } else if (
        lastDisplayedTimestampRef.current !== null &&
        currentTime - lastDisplayedTimestampRef.current > 0.5
      ) {
        const { trackingState, visibleDetections } = updateTrackedDetections(
          trackedDetectionsRef.current,
          []
        );
        trackedDetectionsRef.current = trackingState;
        setDetections(visibleDetections);
      }

      animationFrameRef.current = requestAnimationFrame(syncDetections);
    };

    syncDetections();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) {
      // MJPEG stream doesn't expose playback time, so start immediately.
      startStream();
      return () => {
        stopStream();
      };
    }

    const handlePlay = () => {
      startStream(video.currentTime);
    };

    const handleSeeked = () => {
      if (!video.paused && !video.ended) {
        startStream(video.currentTime);
      }
    };

    const handlePauseOrEnd = () => {
      stopStream();
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("pause", handlePauseOrEnd);
    video.addEventListener("ended", handlePauseOrEnd);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("pause", handlePauseOrEnd);
      video.removeEventListener("ended", handlePauseOrEnd);
      stopStream();
    };
  }, [videoRef, streamUrl]);

  return {
    detections,
    isStreaming,
    error,
    lastFrame,
    lastTimestamp,
    fpsEstimate,
  };
};
