interface FrozenVideoRecoveryArgs {
  nowMs: number;
  imageLoaded: boolean;
  lastVideoFrameAtMs: number | null;
  lastDetectionAtMs: number | null;
  freezeThresholdMs: number;
  detectionFreshThresholdMs: number;
}

export function shouldRecoverFrozenVideo({
  nowMs,
  imageLoaded,
  lastVideoFrameAtMs,
  lastDetectionAtMs,
  freezeThresholdMs,
  detectionFreshThresholdMs,
}: FrozenVideoRecoveryArgs): boolean {
  if (!imageLoaded || lastVideoFrameAtMs === null || lastDetectionAtMs === null) {
    return false;
  }

  const videoFrozen = nowMs - lastVideoFrameAtMs >= freezeThresholdMs;
  const detectionsStillFresh = nowMs - lastDetectionAtMs <= detectionFreshThresholdMs;
  return videoFrozen && detectionsStillFresh;
}
