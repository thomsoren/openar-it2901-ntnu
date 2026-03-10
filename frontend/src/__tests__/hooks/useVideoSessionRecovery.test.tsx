import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVideoSessionRecovery } from "../../hooks/useVideoSessionRecovery";

afterEach(() => {
  vi.useRealTimers();
});

describe("useVideoSessionRecovery", () => {
  it("reconnects after a prolonged stalled state", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useVideoSessionRecovery({ streamKey: "stream-a", initialSession: 0, maxReconnectAttempts: 4 })
    );

    act(() => {
      result.current.handleVideoStatusChange({
        transport: "webrtc",
        status: "playing",
        error: null,
      });
    });

    act(() => {
      result.current.handleVideoStatusChange({
        transport: "webrtc",
        status: "stalled",
        error: null,
      });
    });

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(result.current.videoSession).toBe(1);
    expect(result.current.videoState.status).toBe("idle");
  });
});
