export interface MotionDirectionState {
  smoothedDirectionDeg: number | undefined;
  isActive: boolean;
  lastReliableAtMs: number | null;
}

export interface MotionDirectionInput {
  vx: number;
  vy: number;
  nowMs: number;
  dtMs: number;
  scaleX?: number;
  scaleY?: number;
}

export const MOTION_DIRECTION_START_SPEED_PX_S = 12;
export const MOTION_DIRECTION_STOP_SPEED_PX_S = 5;
export const MOTION_DIRECTION_EMA_TAU_MS = 400;
export const MOTION_DIRECTION_STALE_MS = 3500;

const MIN_DIRECTION_DT_MS = 1;

export function createMotionDirectionState(): MotionDirectionState {
  return {
    smoothedDirectionDeg: undefined,
    isActive: false,
    lastReliableAtMs: null,
  };
}

export function normalizeAngleDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  let delta = normalizeAngleDeg(toDeg) - normalizeAngleDeg(fromDeg);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function normalizeDirectionScales(
  scaleX: number,
  scaleY: number
): { scaleX: number; scaleY: number } {
  const absX = Math.abs(scaleX);
  const absY = Math.abs(scaleY);
  const baseline = Math.max(1e-6, Math.min(absX || 1, absY || 1));

  return {
    scaleX: scaleX / baseline,
    scaleY: scaleY / baseline,
  };
}

export function computeMotionDirectionDeg(
  vx: number,
  vy: number,
  scaleX = 1,
  scaleY = 1
): { directionDeg: number; speedPxPerS: number } {
  const normalizedScales = normalizeDirectionScales(scaleX, scaleY);
  const adjustedVx = vx * normalizedScales.scaleX;
  const adjustedVy = vy * normalizedScales.scaleY;

  return {
    directionDeg: normalizeAngleDeg((Math.atan2(adjustedVx, -adjustedVy) * 180) / Math.PI),
    speedPxPerS: Math.hypot(adjustedVx, adjustedVy),
  };
}

export interface DisplayDirection {
  displayDirectionDeg: number | undefined;
  displayDirectionSource: "motion" | "ais" | undefined;
}

export function resolveDisplayDirection(
  motionDirectionDeg: number | undefined,
  aisHeadingDeg: number | undefined
): DisplayDirection {
  if (motionDirectionDeg !== undefined) {
    return { displayDirectionDeg: motionDirectionDeg, displayDirectionSource: "motion" };
  }
  if (aisHeadingDeg !== undefined && !Number.isNaN(aisHeadingDeg)) {
    return { displayDirectionDeg: aisHeadingDeg, displayDirectionSource: "ais" };
  }
  return { displayDirectionDeg: undefined, displayDirectionSource: undefined };
}

export function updateMotionDirection(
  state: MotionDirectionState,
  { vx, vy, nowMs, dtMs, scaleX = 1, scaleY = 1 }: MotionDirectionInput
): MotionDirectionState {
  const { directionDeg: rawDirectionDeg, speedPxPerS } = computeMotionDirectionDeg(
    vx,
    vy,
    scaleX,
    scaleY
  );
  const activationSpeed = state.isActive
    ? MOTION_DIRECTION_STOP_SPEED_PX_S
    : MOTION_DIRECTION_START_SPEED_PX_S;

  if (speedPxPerS >= activationSpeed) {
    const previousDirection = state.smoothedDirectionDeg;
    const nextDirection =
      previousDirection === undefined
        ? rawDirectionDeg
        : normalizeAngleDeg(
            previousDirection +
              shortestAngleDeltaDeg(previousDirection, rawDirectionDeg) *
                (1 - Math.exp(-Math.max(MIN_DIRECTION_DT_MS, dtMs) / MOTION_DIRECTION_EMA_TAU_MS))
          );

    return {
      smoothedDirectionDeg: nextDirection,
      isActive: true,
      lastReliableAtMs: nowMs,
    };
  }

  const isStale =
    state.smoothedDirectionDeg !== undefined &&
    state.lastReliableAtMs !== null &&
    nowMs - state.lastReliableAtMs > MOTION_DIRECTION_STALE_MS;

  if (isStale) {
    return createMotionDirectionState();
  }

  return {
    ...state,
    isActive: false,
  };
}
