import { describe, expect, it } from "vitest";
import { shouldRecoverFrozenVideo } from "../../hooks/videoRecoveryHeuristics";

describe("shouldRecoverFrozenVideo", () => {
  it("returns true when video frames are frozen but detections are still fresh", () => {
    expect(
      shouldRecoverFrozenVideo({
        nowMs: 10_000,
        imageLoaded: true,
        lastVideoFrameAtMs: 5_000,
        lastDetectionAtMs: 9_000,
        freezeThresholdMs: 4_000,
        detectionFreshThresholdMs: 2_500,
      })
    ).toBe(true);
  });

  it("returns false when detections are stale too", () => {
    expect(
      shouldRecoverFrozenVideo({
        nowMs: 10_000,
        imageLoaded: true,
        lastVideoFrameAtMs: 5_000,
        lastDetectionAtMs: 6_000,
        freezeThresholdMs: 4_000,
        detectionFreshThresholdMs: 2_500,
      })
    ).toBe(false);
  });

  it("returns false before the first frame is loaded", () => {
    expect(
      shouldRecoverFrozenVideo({
        nowMs: 10_000,
        imageLoaded: false,
        lastVideoFrameAtMs: 5_000,
        lastDetectionAtMs: 9_000,
        freezeThresholdMs: 4_000,
        detectionFreshThresholdMs: 2_500,
      })
    ).toBe(false);
  });
});
