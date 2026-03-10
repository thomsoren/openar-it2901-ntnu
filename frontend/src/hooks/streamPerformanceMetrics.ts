import { DetectionPerformance } from "../types/detection";

export interface StreamPerformanceSnapshot {
  videoFps: number | null;
  videoDroppedFrames: number | null;
  videoDroppedRate: number | null;
  videoLatencyMs: number | null;
  videoReceiveToDisplayLatencyMs: number | null;
  videoMediaTimeMs: number | null;
  detectionFps: number | null;
  detectionDeliveryFps: number | null;
  detectionTransportLatencyMs: number | null;
  detectionPipelineLatencyMs: number | null;
  detectionTotalLatencyMs: number | null;
  detectionBehindVideoMs: number | null;
  detectionInferenceLatencyMs: number | null;
  detectionDecodeQueueLatencyMs: number | null;
  detectionPublishLatencyMs: number | null;
  lastVideoFrameAtMs: number | null;
  lastDetectionAtMs: number | null;
}

export const EMPTY_STREAM_PERFORMANCE_SNAPSHOT: StreamPerformanceSnapshot = {
  videoFps: null,
  videoDroppedFrames: null,
  videoDroppedRate: null,
  videoLatencyMs: null,
  videoReceiveToDisplayLatencyMs: null,
  videoMediaTimeMs: null,
  detectionFps: null,
  detectionDeliveryFps: null,
  detectionTransportLatencyMs: null,
  detectionPipelineLatencyMs: null,
  detectionTotalLatencyMs: null,
  detectionBehindVideoMs: null,
  detectionInferenceLatencyMs: null,
  detectionDecodeQueueLatencyMs: null,
  detectionPublishLatencyMs: null,
  lastVideoFrameAtMs: null,
  lastDetectionAtMs: null,
};

const HIGH_RES_EPOCH_THRESHOLD_MS = 1_000_000_000_000;

export const toEpochMs = (value: number): number =>
  value >= HIGH_RES_EPOCH_THRESHOLD_MS ? value : performance.timeOrigin + value;

export function computeRatePerSecond(
  samples: number[],
  nowMs: number,
  windowMs: number
): number | null {
  const recent = samples.filter((value) => nowMs - value <= windowMs);
  if (recent.length < 2) {
    return null;
  }
  const spanMs = recent[recent.length - 1] - recent[0];
  if (spanMs <= 0) {
    return null;
  }
  return ((recent.length - 1) * 1000) / spanMs;
}

export function computeDroppedRate(totalFrames: number, droppedFrames: number): number | null {
  if (totalFrames <= 0 || droppedFrames < 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (droppedFrames / totalFrames) * 100));
}

export function summarizeDetectionLatency(
  performanceMetrics: DetectionPerformance | null,
  detectionReceivedAtMs: number,
  nowMs: number
): Pick<
  StreamPerformanceSnapshot,
  | "detectionFps"
  | "detectionTransportLatencyMs"
  | "detectionPipelineLatencyMs"
  | "detectionTotalLatencyMs"
  | "detectionBehindVideoMs"
  | "detectionInferenceLatencyMs"
  | "detectionDecodeQueueLatencyMs"
  | "detectionPublishLatencyMs"
  | "lastDetectionAtMs"
> {
  if (!performanceMetrics) {
    return {
      detectionFps: null,
      detectionTransportLatencyMs: null,
      detectionPipelineLatencyMs: null,
      detectionTotalLatencyMs: null,
      detectionBehindVideoMs: null,
      detectionInferenceLatencyMs: null,
      detectionDecodeQueueLatencyMs: null,
      detectionPublishLatencyMs: null,
      lastDetectionAtMs: detectionReceivedAtMs > 0 ? detectionReceivedAtMs : null,
    };
  }

  const transportLatencyMs =
    detectionReceivedAtMs > 0
      ? Math.max(0, detectionReceivedAtMs - performanceMetrics.published_at_ms)
      : null;
  const totalLatencyMs = Math.max(0, nowMs - performanceMetrics.decoded_at_ms);

  return {
    detectionFps: performanceMetrics.detection_fps,
    detectionTransportLatencyMs: transportLatencyMs,
    detectionPipelineLatencyMs: performanceMetrics.total_detection_latency_ms,
    detectionTotalLatencyMs: totalLatencyMs,
    detectionBehindVideoMs: null,
    detectionInferenceLatencyMs: performanceMetrics.inference_duration_ms ?? null,
    detectionDecodeQueueLatencyMs: performanceMetrics.decode_to_inference_start_ms ?? null,
    detectionPublishLatencyMs: performanceMetrics.publish_duration_ms ?? null,
    lastDetectionAtMs: detectionReceivedAtMs > 0 ? detectionReceivedAtMs : null,
  };
}
