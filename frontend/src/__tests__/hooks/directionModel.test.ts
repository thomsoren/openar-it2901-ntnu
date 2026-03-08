import { describe, expect, it } from "vitest";
import {
  MOTION_DIRECTION_STALE_MS,
  computeMotionDirectionDeg,
  createMotionDirectionState,
  updateMotionDirection,
} from "../../hooks/directionModel";

describe("directionModel", () => {
  it("applies anisotropic scaling before converting motion to a display direction", () => {
    const result = computeMotionDirectionDeg(1, -1, 2, 1);

    expect(result.directionDeg).toBeCloseTo(63.4349, 3);
    expect(result.speedPxPerS).toBeCloseTo(Math.sqrt(5), 4);
  });

  it("ignores uniform downscaling when deciding whether motion is strong enough", () => {
    const state = updateMotionDirection(createMotionDirectionState(), {
      vx: 15,
      vy: 0,
      nowMs: 100,
      dtMs: 16,
      scaleX: 0.4,
      scaleY: 0.4,
    });

    expect(state.smoothedDirectionDeg).toBe(90);
    expect(state.isActive).toBe(true);
    expect(state.lastReliableAtMs).toBe(100);
  });

  it("does not start emitting a direction while motion stays below the start threshold", () => {
    const state = updateMotionDirection(createMotionDirectionState(), {
      vx: 6,
      vy: 0,
      nowMs: 100,
      dtMs: 16,
    });

    expect(state.smoothedDirectionDeg).toBeUndefined();
    expect(state.isActive).toBe(false);
    expect(state.lastReliableAtMs).toBeNull();
  });

  it("keeps updating while speed remains above the stop threshold after activation", () => {
    const activeState = updateMotionDirection(createMotionDirectionState(), {
      vx: 15,
      vy: 0,
      nowMs: 100,
      dtMs: 16,
    });
    const nextState = updateMotionDirection(activeState, {
      vx: 6,
      vy: 0,
      nowMs: 200,
      dtMs: 16,
    });

    expect(activeState.smoothedDirectionDeg).toBe(90);
    expect(nextState.smoothedDirectionDeg).toBe(90);
    expect(nextState.isActive).toBe(true);
    expect(nextState.lastReliableAtMs).toBe(200);
  });

  it("requires a full restart threshold after motion drops below the stop threshold", () => {
    const activeState = updateMotionDirection(createMotionDirectionState(), {
      vx: 15,
      vy: 0,
      nowMs: 100,
      dtMs: 16,
    });
    const pausedState = updateMotionDirection(activeState, {
      vx: 4,
      vy: 0,
      nowMs: 200,
      dtMs: 16,
    });
    const bandState = updateMotionDirection(pausedState, {
      vx: 6,
      vy: 0,
      nowMs: 300,
      dtMs: 16,
    });

    expect(pausedState.smoothedDirectionDeg).toBe(90);
    expect(pausedState.isActive).toBe(false);
    expect(bandState.smoothedDirectionDeg).toBe(90);
    expect(bandState.isActive).toBe(false);
    expect(bandState.lastReliableAtMs).toBe(100);
  });

  it("expires a stale direction after prolonged low-speed motion", () => {
    const activeState = updateMotionDirection(createMotionDirectionState(), {
      vx: 15,
      vy: 0,
      nowMs: 100,
      dtMs: 16,
    });
    const staleState = updateMotionDirection(activeState, {
      vx: 0,
      vy: 0,
      nowMs: 100 + MOTION_DIRECTION_STALE_MS + 1,
      dtMs: 16,
    });

    expect(staleState.smoothedDirectionDeg).toBeUndefined();
    expect(staleState.isActive).toBe(false);
    expect(staleState.lastReliableAtMs).toBeNull();
  });
});
