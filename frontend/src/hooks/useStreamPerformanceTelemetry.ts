import { useEffect, useRef, useState } from "react";
import { DetectionPerformance } from "../types/detection";
import {
  computeDroppedRate,
  computeRatePerSecond,
  EMPTY_STREAM_PERFORMANCE_SNAPSHOT,
  StreamPerformanceSnapshot,
  summarizeDetectionLatency,
  toEpochMs,
} from "./streamPerformanceMetrics";

interface UseStreamPerformanceTelemetryOptions {
  videoElement: HTMLVideoElement | null;
  detectionPerformance: DetectionPerformance | null;
  backendInferenceFps: number | null;
  detectionReceivedAtMs: number;
  detectionTimestampMs: number;
}

interface VideoPlaybackQualityLike {
  totalVideoFrames: number;
  droppedVideoFrames: number;
}

type VideoFrameMetadataLike = {
  presentedFrames?: number;
  expectedDisplayTime?: number;
  presentationTime?: number;
  captureTime?: number;
  receiveTime?: number;
  mediaTime?: number;
};

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadataLike) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  webkitDecodedFrameCount?: number;
  webkitDroppedFrameCount?: number;
};

const SAMPLE_WINDOW_MS = 4_000;
const PUBLISH_INTERVAL_MS = 400;

function getPlaybackQuality(videoEl: VideoWithFrameCallback): VideoPlaybackQualityLike | null {
  if (typeof videoEl.getVideoPlaybackQuality === "function") {
    return videoEl.getVideoPlaybackQuality();
  }

  const totalVideoFrames = videoEl.webkitDecodedFrameCount;
  const droppedVideoFrames = videoEl.webkitDroppedFrameCount;
  if (typeof totalVideoFrames === "number" && typeof droppedVideoFrames === "number") {
    return { totalVideoFrames, droppedVideoFrames };
  }
  return null;
}

export function useStreamPerformanceTelemetry({
  videoElement,
  detectionPerformance,
  backendInferenceFps,
  detectionReceivedAtMs,
  detectionTimestampMs,
}: UseStreamPerformanceTelemetryOptions): StreamPerformanceSnapshot {
  const [snapshot, setSnapshot] = useState<StreamPerformanceSnapshot>(
    EMPTY_STREAM_PERFORMANCE_SNAPSHOT
  );
  const videoFrameTimesRef = useRef<number[]>([]);
  const detectionTimesRef = useRef<number[]>([]);
  const videoLatencyMsRef = useRef<number | null>(null);
  const videoReceiveToDisplayLatencyMsRef = useRef<number | null>(null);
  const videoMediaTimeMsRef = useRef<number | null>(null);
  const droppedFramesRef = useRef<number | null>(null);
  const droppedRateRef = useRef<number | null>(null);
  const frameCallbackHandleRef = useRef<number | null>(null);
  const detectionPerformanceRef = useRef<DetectionPerformance | null>(detectionPerformance);
  const detectionReceivedAtRef = useRef<number>(detectionReceivedAtMs);
  const detectionTimestampRef = useRef<number>(detectionTimestampMs);

  useEffect(() => {
    detectionPerformanceRef.current = detectionPerformance;
  }, [detectionPerformance]);

  useEffect(() => {
    detectionReceivedAtRef.current = detectionReceivedAtMs;
    if (detectionReceivedAtMs > 0) {
      detectionTimesRef.current = [...detectionTimesRef.current, detectionReceivedAtMs].filter(
        (value) => detectionReceivedAtMs - value <= SAMPLE_WINDOW_MS
      );
    }
  }, [detectionReceivedAtMs]);

  useEffect(() => {
    detectionTimestampRef.current = detectionTimestampMs;
  }, [detectionTimestampMs]);

  useEffect(() => {
    const videoEl = videoElement as VideoWithFrameCallback | null;
    if (!videoEl || typeof videoEl.requestVideoFrameCallback !== "function") {
      return;
    }

    let cancelled = false;

    const onFrame = (_now: number, metadata: VideoFrameMetadataLike) => {
      if (cancelled) {
        return;
      }

      const wallNowMs = Date.now();
      videoFrameTimesRef.current = [...videoFrameTimesRef.current, wallNowMs].filter(
        (value) => wallNowMs - value <= SAMPLE_WINDOW_MS
      );
      if (typeof metadata.mediaTime === "number") {
        videoMediaTimeMsRef.current = metadata.mediaTime * 1000;
      } else if (Number.isFinite(videoEl.currentTime)) {
        videoMediaTimeMsRef.current = videoEl.currentTime * 1000;
      }

      if (typeof metadata.captureTime === "number") {
        const displayTime = metadata.expectedDisplayTime ?? metadata.presentationTime;
        if (typeof displayTime === "number") {
          videoLatencyMsRef.current = Math.max(
            0,
            toEpochMs(displayTime) - toEpochMs(metadata.captureTime)
          );
        }
      }

      if (
        typeof metadata.receiveTime === "number" &&
        typeof metadata.expectedDisplayTime === "number"
      ) {
        videoReceiveToDisplayLatencyMsRef.current = Math.max(
          0,
          toEpochMs(metadata.expectedDisplayTime) - toEpochMs(metadata.receiveTime)
        );
      }

      const playbackQuality = getPlaybackQuality(videoEl);
      if (playbackQuality) {
        droppedFramesRef.current = playbackQuality.droppedVideoFrames;
        droppedRateRef.current = computeDroppedRate(
          playbackQuality.totalVideoFrames,
          playbackQuality.droppedVideoFrames
        );
      }

      frameCallbackHandleRef.current = videoEl.requestVideoFrameCallback?.(onFrame) ?? null;
    };

    frameCallbackHandleRef.current = videoEl.requestVideoFrameCallback(onFrame);

    return () => {
      cancelled = true;
      if (
        frameCallbackHandleRef.current !== null &&
        typeof videoEl.cancelVideoFrameCallback === "function"
      ) {
        videoEl.cancelVideoFrameCallback(frameCallbackHandleRef.current);
      }
      frameCallbackHandleRef.current = null;
      videoFrameTimesRef.current = [];
    };
  }, [videoElement]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      const videoFrameTimes = videoFrameTimesRef.current.filter(
        (value) => nowMs - value <= SAMPLE_WINDOW_MS
      );
      const detectionTimes = detectionTimesRef.current.filter(
        (value) => nowMs - value <= SAMPLE_WINDOW_MS
      );

      videoFrameTimesRef.current = videoFrameTimes;
      detectionTimesRef.current = detectionTimes;

      setSnapshot({
        videoFps: computeRatePerSecond(videoFrameTimes, nowMs, SAMPLE_WINDOW_MS),
        videoDroppedFrames: droppedFramesRef.current,
        videoDroppedRate: droppedRateRef.current,
        videoLatencyMs: videoLatencyMsRef.current,
        videoReceiveToDisplayLatencyMs: videoReceiveToDisplayLatencyMsRef.current,
        videoMediaTimeMs: videoMediaTimeMsRef.current,
        detectionDeliveryFps: computeRatePerSecond(detectionTimes, nowMs, SAMPLE_WINDOW_MS),
        ...summarizeDetectionLatency(
          detectionPerformanceRef.current,
          detectionReceivedAtRef.current,
          nowMs
        ),
        detectionFps: detectionPerformanceRef.current?.detection_fps ?? backendInferenceFps ?? null,
        detectionBehindVideoMs:
          videoMediaTimeMsRef.current !== null && detectionTimestampRef.current > 0
            ? Math.max(0, videoMediaTimeMsRef.current - detectionTimestampRef.current)
            : null,
        lastVideoFrameAtMs:
          videoFrameTimes.length > 0 ? videoFrameTimes[videoFrameTimes.length - 1] : null,
      });
    }, PUBLISH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return snapshot;
}
