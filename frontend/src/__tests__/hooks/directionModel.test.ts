import { describe, expect, it } from "vitest";
import {
  MOTION_DIRECTION_EMA_TAU_MS,
  MOTION_DIRECTION_STALE_MS,
  computeMotionDirectionDeg,
  createMotionDirectionState,
  normalizeAngleDeg,
  normalizeDirectionScales,
  resolveDisplayDirection,
  shortestAngleDeltaDeg,
  updateMotionDirection,
} from "../../hooks/directionModel";

describe("normalizeAngleDeg", () => {
  it("returns 0 for 0", () => {
    expect(normalizeAngleDeg(0)).toBe(0);
  });

  it("wraps negative angles into 0–359", () => {
    expect(normalizeAngleDeg(-1)).toBeCloseTo(359);
    expect(normalizeAngleDeg(-90)).toBeCloseTo(270);
    expect(normalizeAngleDeg(-361)).toBeCloseTo(359);
  });

  it("wraps angles >= 360", () => {
    expect(normalizeAngleDeg(360)).toBe(0);
    expect(normalizeAngleDeg(450)).toBeCloseTo(90);
    expect(normalizeAngleDeg(720)).toBe(0);
  });

  it("preserves fractional degrees", () => {
    expect(normalizeAngleDeg(360.5)).toBeCloseTo(0.5);
  });
});

describe("normalizeDirectionScales", () => {
  it("returns 1:1 for equal scales", () => {
    const result = normalizeDirectionScales(3, 3);
    expect(result.scaleX).toBeCloseTo(1);
    expect(result.scaleY).toBeCloseTo(1);
  });

  it("preserves the ratio when scales differ", () => {
    const result = normalizeDirectionScales(2, 1);
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(1);
  });

  it("normalizes to the smaller axis as baseline", () => {
    const result = normalizeDirectionScales(4, 2);
    expect(result.scaleX).toBeCloseTo(2);
    expect(result.scaleY).toBeCloseTo(1);
  });

  it("handles negative scales by preserving sign", () => {
    const result = normalizeDirectionScales(-2, 1);
    expect(result.scaleX).toBeCloseTo(-2);
    expect(result.scaleY).toBeCloseTo(1);
  });
});

describe("shortestAngleDeltaDeg", () => {
  it("returns 0 for identical angles", () => {
    expect(shortestAngleDeltaDeg(90, 90)).toBe(0);
  });

  it("returns positive delta for clockwise rotation", () => {
    expect(shortestAngleDeltaDeg(10, 30)).toBeCloseTo(20);
  });

  it("returns negative delta for counter-clockwise rotation", () => {
    expect(shortestAngleDeltaDeg(30, 10)).toBeCloseTo(-20);
  });

  it("takes the short path across the 0/360 boundary (clockwise)", () => {
    expect(shortestAngleDeltaDeg(350, 10)).toBeCloseTo(20);
  });

  it("takes the short path across the 0/360 boundary (counter-clockwise)", () => {
    expect(shortestAngleDeltaDeg(10, 350)).toBeCloseTo(-20);
  });

  it("handles exactly 180° apart", () => {
    const delta = shortestAngleDeltaDeg(0, 180);
    expect(Math.abs(delta)).toBeCloseTo(180);
  });

  it("handles unnormalized inputs", () => {
    expect(shortestAngleDeltaDeg(-10, 370)).toBeCloseTo(20);
  });
});

describe("computeMotionDirectionDeg", () => {
  it("maps pure rightward motion (positive vx) to 90°", () => {
    const result = computeMotionDirectionDeg(10, 0);
    expect(result.directionDeg).toBeCloseTo(90);
    expect(result.speedPxPerS).toBeCloseTo(10);
  });

  it("maps pure upward motion (negative vy) to 0°", () => {
    const result = computeMotionDirectionDeg(0, -10);
    expect(result.directionDeg).toBeCloseTo(0);
    expect(result.speedPxPerS).toBeCloseTo(10);
  });

  it("maps pure downward motion (positive vy) to 180°", () => {
    const result = computeMotionDirectionDeg(0, 10);
    expect(result.directionDeg).toBeCloseTo(180);
    expect(result.speedPxPerS).toBeCloseTo(10);
  });

  it("maps pure leftward motion (negative vx) to 270°", () => {
    const result = computeMotionDirectionDeg(-10, 0);
    expect(result.directionDeg).toBeCloseTo(270);
    expect(result.speedPxPerS).toBeCloseTo(10);
  });

  it("applies anisotropic scaling before converting motion to a display direction", () => {
    const result = computeMotionDirectionDeg(1, -1, 2, 1);

    expect(result.directionDeg).toBeCloseTo(63.4349, 3);
    expect(result.speedPxPerS).toBeCloseTo(Math.sqrt(5), 4);
  });

  it("normalizes uniform scaling so it does not affect direction or speed", () => {
    const unscaled = computeMotionDirectionDeg(10, -5, 1, 1);
    const scaled = computeMotionDirectionDeg(10, -5, 3, 3);

    expect(scaled.directionDeg).toBeCloseTo(unscaled.directionDeg);
    expect(scaled.speedPxPerS).toBeCloseTo(unscaled.speedPxPerS);
  });

  it("amplifies speed when one axis is scaled larger than the other", () => {
    const baseline = computeMotionDirectionDeg(10, 0, 1, 1);
    const stretched = computeMotionDirectionDeg(10, 0, 2, 1);

    expect(stretched.speedPxPerS).toBeGreaterThan(baseline.speedPxPerS);
  });
});

describe("updateMotionDirection — state machine", () => {
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

  it("holds the last direction (without decaying) while inactive but not yet stale", () => {
    const activeState = updateMotionDirection(createMotionDirectionState(), {
      vx: 15,
      vy: 0,
      nowMs: 100,
      dtMs: 16,
    });
    const idleState = updateMotionDirection(activeState, {
      vx: 0,
      vy: 0,
      nowMs: 500,
      dtMs: 16,
    });

    expect(idleState.smoothedDirectionDeg).toBe(90);
    expect(idleState.isActive).toBe(false);
    expect(idleState.lastReliableAtMs).toBe(100);
  });
});

describe("updateMotionDirection — EMA smoothing", () => {
  it("snaps to the raw direction on the very first active frame", () => {
    const state = updateMotionDirection(createMotionDirectionState(), {
      vx: 0,
      vy: -20,
      nowMs: 100,
      dtMs: 16,
    });

    expect(state.smoothedDirectionDeg).toBeCloseTo(0);
  });

  it("blends toward a new direction over successive frames", () => {
    const eastward = updateMotionDirection(createMotionDirectionState(), {
      vx: 20,
      vy: 0,
      nowMs: 0,
      dtMs: 16,
    });
    expect(eastward.smoothedDirectionDeg).toBeCloseTo(90);

    const oneFrame = updateMotionDirection(eastward, {
      vx: 0,
      vy: -20,
      nowMs: 16,
      dtMs: 16,
    });

    expect(oneFrame.smoothedDirectionDeg).toBeLessThan(90);
    expect(oneFrame.smoothedDirectionDeg!).toBeGreaterThan(0);
  });

  it("converges close to the target after several tau intervals", () => {
    let state = updateMotionDirection(createMotionDirectionState(), {
      vx: 20,
      vy: 0,
      nowMs: 0,
      dtMs: 16,
    });

    const frames = Math.ceil((MOTION_DIRECTION_EMA_TAU_MS * 5) / 16);
    for (let i = 1; i <= frames; i++) {
      state = updateMotionDirection(state, {
        vx: 0,
        vy: -20,
        nowMs: i * 16,
        dtMs: 16,
      });
    }

    expect(state.smoothedDirectionDeg!).toBeLessThan(1);
  });

  it("takes the short path across 0/360 when smoothing", () => {
    const near360 = updateMotionDirection(createMotionDirectionState(), {
      vx: -1,
      vy: -20,
      nowMs: 0,
      dtMs: 16,
    });
    expect(near360.smoothedDirectionDeg!).toBeGreaterThan(350);

    const crossZero = updateMotionDirection(near360, {
      vx: 1,
      vy: -20,
      nowMs: 16,
      dtMs: 16,
    });

    expect(crossZero.smoothedDirectionDeg!).toBeGreaterThan(350);
    expect(crossZero.smoothedDirectionDeg!).toBeLessThan(360);
  });
});

describe("resolveDisplayDirection", () => {
  it("prefers motion direction when both motion and AIS are available", () => {
    const result = resolveDisplayDirection(90, 180);

    expect(result.displayDirectionDeg).toBe(90);
    expect(result.displayDirectionSource).toBe("motion");
  });

  it("falls back to AIS heading when motion is unavailable", () => {
    const result = resolveDisplayDirection(undefined, 180);

    expect(result.displayDirectionDeg).toBe(180);
    expect(result.displayDirectionSource).toBe("ais");
  });

  it("returns undefined when neither motion nor AIS is available", () => {
    const result = resolveDisplayDirection(undefined, undefined);

    expect(result.displayDirectionDeg).toBeUndefined();
    expect(result.displayDirectionSource).toBeUndefined();
  });

  it("treats NaN AIS heading as unavailable", () => {
    const result = resolveDisplayDirection(undefined, NaN);

    expect(result.displayDirectionDeg).toBeUndefined();
    expect(result.displayDirectionSource).toBeUndefined();
  });

  it("uses motion direction even when AIS heading is NaN", () => {
    const result = resolveDisplayDirection(45, NaN);

    expect(result.displayDirectionDeg).toBe(45);
    expect(result.displayDirectionSource).toBe("motion");
  });

  it("converts AIS heading to screen-space using camera heading", () => {
    // AIS heading 90° (east), camera facing east (90°) → screen 0° (up)
    const result = resolveDisplayDirection(undefined, 90, 90);

    expect(result.displayDirectionDeg).toBeCloseTo(0);
    expect(result.displayDirectionSource).toBe("ais");
  });

  it("does not apply camera heading conversion to motion direction", () => {
    const result = resolveDisplayDirection(45, 180, 90);

    expect(result.displayDirectionDeg).toBe(45);
    expect(result.displayDirectionSource).toBe("motion");
  });

  it("passes AIS heading through unchanged when camera heading is undefined", () => {
    const result = resolveDisplayDirection(undefined, 180, undefined);

    expect(result.displayDirectionDeg).toBe(180);
    expect(result.displayDirectionSource).toBe("ais");
  });

  it("wraps negative result into 0-360 range", () => {
    // AIS heading 10°, camera heading 90° → 10 - 90 = -80 → 280°
    const result = resolveDisplayDirection(undefined, 10, 90);

    expect(result.displayDirectionDeg).toBeCloseTo(280);
    expect(result.displayDirectionSource).toBe("ais");
  });
});
