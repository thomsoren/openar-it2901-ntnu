import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeDroppedRate,
  computeRatePerSecond,
  summarizeDetectionLatency,
  toEpochMs,
} from "../../hooks/streamPerformanceMetrics";
import type { DetectionPerformance } from "../../types/detection";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toEpochMs", () => {
  it("converts high-resolution timestamps into epoch time", () => {
    vi.stubGlobal("performance", { timeOrigin: 1000 });
    expect(toEpochMs(25)).toBe(1025);
  });

  it("leaves epoch timestamps untouched", () => {
    vi.stubGlobal("performance", { timeOrigin: 1000 });
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe("computeRatePerSecond", () => {
  it("computes rates over a rolling window", () => {
    expect(computeRatePerSecond([1000, 1200, 1400, 1600], 1600, 2000)).toBeCloseTo(5);
  });

  it("returns null when there are not enough samples", () => {
    expect(computeRatePerSecond([1000], 1000, 2000)).toBeNull();
  });
});

describe("computeDroppedRate", () => {
  it("computes the dropped frame percentage", () => {
    expect(computeDroppedRate(200, 5)).toBeCloseTo(2.5);
  });
});

describe("summarizeDetectionLatency", () => {
  it("derives browser-visible detection metrics from backend timings", () => {
    const performanceMetrics: DetectionPerformance = {
      source_fps: 25,
      detection_fps: 10,
      decoded_at_ms: 1000,
      inference_started_at_ms: 1020,
      inference_completed_at_ms: 1060,
      published_at_ms: 1075,
      decode_to_inference_start_ms: 20,
      inference_duration_ms: 40,
      publish_duration_ms: 15,
      total_detection_latency_ms: 75,
    };

    const summary = summarizeDetectionLatency(performanceMetrics, 1090, 1100);

    expect(summary.detectionFps).toBe(10);
    expect(summary.detectionTransportLatencyMs).toBe(15);
    expect(summary.detectionPipelineLatencyMs).toBe(75);
    expect(summary.detectionTotalLatencyMs).toBe(100);
    expect(summary.detectionBehindVideoMs).toBeNull();
    expect(summary.detectionInferenceLatencyMs).toBe(40);
  });
});
