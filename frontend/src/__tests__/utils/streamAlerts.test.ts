import { describe, expect, it } from "vitest";
import {
  buildStreamAlerts,
  describeDataStreamProblem,
  describeSystemProblem,
  describeVideoStreamError,
} from "../../utils/streamAlerts";

describe("describeVideoStreamError", () => {
  it("maps missing streams to an operator-facing message", () => {
    expect(describeVideoStreamError("WHEP OPTIONS rejected (404)")).toMatchObject({
      title: "Video stream not available",
    });
  });

  it("maps ICE failures to a concrete network problem", () => {
    expect(describeVideoStreamError("WebRTC ICE connection timeout")).toMatchObject({
      title: "Video stream timed out",
    });
  });
});

describe("describeDataStreamProblem", () => {
  it("maps websocket disconnects to a detection alarm", () => {
    expect(
      describeDataStreamProblem({
        error: "WebSocket connection error",
        isConnected: false,
      })
    ).toMatchObject({
      title: "Detection data stream disconnected",
    });
  });

  it("flags stale data when updates stop arriving", () => {
    expect(
      describeDataStreamProblem({
        isConnected: true,
        isStale: true,
      })
    ).toMatchObject({
      title: "Detection data stream stalled",
    });
  });
});

describe("buildStreamAlerts", () => {
  it("adds recovery context without losing the root cause", () => {
    expect(
      buildStreamAlerts({
        videoError: "WHEP offer rejected (503)",
        videoRecovery: "WebRTC stream reconnecting (attempt 2)...",
      })
    ).toEqual([
      expect.objectContaining({
        title: "Video stream negotiation failed",
        recovery: "WebRTC stream reconnecting (attempt 2)...",
      }),
    ]);
  });
});

describe("describeSystemProblem", () => {
  it("maps unauthorized backend responses to an auth alarm", () => {
    expect(describeSystemProblem("Failed to load streams (401 Unauthorized)")).toMatchObject({
      title: "Authentication required",
    });
  });
});
