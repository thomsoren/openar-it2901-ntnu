import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStreamPerformanceTelemetry } from "../../hooks/useStreamPerformanceTelemetry";

afterEach(() => {
  vi.useRealTimers();
});

describe("useStreamPerformanceTelemetry", () => {
  it("computes how many ms detections are behind the displayed video", () => {
    vi.useFakeTimers();

    let frameCallback: ((now: number, metadata: { mediaTime?: number }) => void) | null = null;

    const videoElement = {
      currentTime: 0,
      requestVideoFrameCallback: (
        callback: (now: number, metadata: { mediaTime?: number }) => void
      ) => {
        frameCallback = callback;
        return 1;
      },
      cancelVideoFrameCallback: () => {},
      getVideoPlaybackQuality: () => ({
        totalVideoFrames: 100,
        droppedVideoFrames: 2,
      }),
    } as unknown as HTMLVideoElement;

    const { result } = renderHook(() =>
      useStreamPerformanceTelemetry({
        videoElement,
        detectionPerformance: null,
        backendInferenceFps: 12.5,
        detectionReceivedAtMs: 10_000,
        detectionTimestampMs: 4_700,
      })
    );

    act(() => {
      frameCallback?.(0, { mediaTime: 5.0 });
      vi.advanceTimersByTime(400);
    });

    expect(result.current.videoMediaTimeMs).toBe(5000);
    expect(result.current.detectionFps).toBe(12.5);
    expect(result.current.detectionBehindVideoMs).toBe(300);
  });
});
