import { useEffect, useRef, useState } from "react";
import { DetectedVessel, Detection } from "../types/detection";

interface InterpolatedDetectionOptions {
  maxExtrapolationMs?: number;
  trackDropMs?: number;
  staleHoldMs?: number;
  anonMatchDistancePx?: number;
}

interface Kalman1D {
  x: number; // position
  v: number; // velocity (px/s)
  p00: number;
  p01: number;
  p10: number;
  p11: number;
}

interface TrackState {
  key: string;
  trackIdForOutput: number;
  className: string;
  confidence: number;
  vessel?: DetectedVessel["vessel"];
  kx: Kalman1D;
  ky: Kalman1D;
  kw: Kalman1D;
  kh: Kalman1D;
  lastMeasurementAtMs: number;
  lastRenderAtMs: number;
  lastRendered: { x: number; y: number; width: number; height: number } | null;
}

const DEFAULT_OPTIONS = {
  maxExtrapolationMs: 1000,
  trackDropMs: 3000,
  staleHoldMs: 1500,
  anonMatchDistancePx: 240,
} satisfies Required<InterpolatedDetectionOptions>;

const PROCESS_NOISE_POS = 80; // px² per prediction step
const PROCESS_NOISE_VEL = 250; // (px/s)² per prediction step
const MEASUREMENT_NOISE_XY = 36; // px² — position measurement variance
const MEASUREMENT_NOISE_WH = 64; // px² — dimension measurement variance
const EMA_TAU_MS = 140; // ms — exponential moving average time constant for render smoothing

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const getTrackKey = (trackId: number): string => `track:${trackId}`;

const makeKalman1D = (position: number): Kalman1D => ({
  x: position,
  v: 0,
  p00: 500,
  p01: 0,
  p10: 0,
  p11: 500,
});

function predictKalman(filter: Kalman1D, dtSeconds: number): void {
  const dt = Math.max(0, dtSeconds);
  filter.x = filter.x + filter.v * dt;

  const p00 = filter.p00;
  const p01 = filter.p01;
  const p10 = filter.p10;
  const p11 = filter.p11;

  // Constant-velocity model with diagonal process noise.
  filter.p00 = p00 + dt * (p01 + p10) + dt * dt * p11 + PROCESS_NOISE_POS;
  filter.p01 = p01 + dt * p11;
  filter.p10 = p10 + dt * p11;
  filter.p11 = p11 + PROCESS_NOISE_VEL;
}

function updateKalman(filter: Kalman1D, measurement: number, measurementNoise: number): void {
  const innovation = measurement - filter.x;
  const s = filter.p00 + measurementNoise;
  if (s <= 0) return;

  const k0 = filter.p00 / s;
  const k1 = filter.p10 / s;

  filter.x = filter.x + k0 * innovation;
  filter.v = filter.v + k1 * innovation;

  const p00 = filter.p00;
  const p01 = filter.p01;
  const p10 = filter.p10;
  const p11 = filter.p11;

  filter.p00 = (1 - k0) * p00;
  filter.p01 = (1 - k0) * p01;
  filter.p10 = p10 - k1 * p00;
  filter.p11 = p11 - k1 * p01;
}

const squaredDistanceFromTrack = (track: TrackState, detection: Detection): number => {
  const dx = track.kx.x - detection.x;
  const dy = track.ky.x - detection.y;
  return dx * dx + dy * dy;
};

const getSampleTimeMs = (): number => Date.now();

const buildTrack = (
  key: string,
  trackIdForOutput: number,
  item: DetectedVessel,
  sampleTimeMs: number
): TrackState => ({
  key,
  trackIdForOutput,
  className: item.detection.class_name ?? "boat",
  confidence: item.detection.confidence,
  vessel: item.vessel,
  kx: makeKalman1D(item.detection.x),
  ky: makeKalman1D(item.detection.y),
  kw: makeKalman1D(item.detection.width),
  kh: makeKalman1D(item.detection.height),
  lastMeasurementAtMs: sampleTimeMs,
  lastRenderAtMs: sampleTimeMs,
  lastRendered: {
    x: item.detection.x,
    y: item.detection.y,
    width: item.detection.width,
    height: item.detection.height,
  },
});

export function useInterpolatedDetections(
  vessels: DetectedVessel[],
  options?: InterpolatedDetectionOptions
): DetectedVessel[] {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const tracksRef = useRef<Map<string, TrackState>>(new Map());
  const anonTrackCounterRef = useRef(-1);
  const [rendered, setRendered] = useState<DetectedVessel[]>([]);

  useEffect(() => {
    const sampleTimeMs = getSampleTimeMs();
    const tracks = tracksRef.current;
    const seenKeys = new Set<string>();
    const unmatchedAnon = new Set<string>();
    const maxAnonDistanceSq = config.anonMatchDistancePx * config.anonMatchDistancePx;

    for (const [key, track] of tracks.entries()) {
      if (key.startsWith("anon:")) {
        unmatchedAnon.add(key);
      }
      // 3x trackDropMs: keep hidden tracks for re-identification if the same ID reappears
      if (sampleTimeMs - track.lastMeasurementAtMs > config.trackDropMs * 3) {
        tracks.delete(key);
      }
    }

    for (const item of vessels) {
      const detection = item.detection;
      const className = detection.class_name ?? "boat";
      const directTrackId = detection.track_id;

      let key: string;
      let trackIdForOutput: number;

      if (typeof directTrackId === "number") {
        key = getTrackKey(directTrackId);
        trackIdForOutput = directTrackId;
      } else {
        let bestAnonKey: string | null = null;
        let bestDistanceSq = Number.POSITIVE_INFINITY;

        for (const anonKey of unmatchedAnon) {
          const anonTrack = tracks.get(anonKey);
          if (!anonTrack || anonTrack.className !== className) continue;
          const distSq = squaredDistanceFromTrack(anonTrack, detection);
          if (distSq < bestDistanceSq && distSq <= maxAnonDistanceSq) {
            bestDistanceSq = distSq;
            bestAnonKey = anonKey;
          }
        }

        if (bestAnonKey) {
          key = bestAnonKey;
          unmatchedAnon.delete(bestAnonKey);
          trackIdForOutput =
            tracks.get(bestAnonKey)?.trackIdForOutput ?? anonTrackCounterRef.current;
        } else {
          const nextAnonId = anonTrackCounterRef.current;
          anonTrackCounterRef.current -= 1;
          key = `anon:${Math.abs(nextAnonId)}`;
          trackIdForOutput = nextAnonId;
        }
      }

      const existing = tracks.get(key);
      if (!existing) {
        tracks.set(key, buildTrack(key, trackIdForOutput, item, sampleTimeMs));
        seenKeys.add(key);
        continue;
      }

      const dtSeconds = Math.max(0.001, (sampleTimeMs - existing.lastMeasurementAtMs) / 1000);
      predictKalman(existing.kx, dtSeconds);
      predictKalman(existing.ky, dtSeconds);
      predictKalman(existing.kw, dtSeconds);
      predictKalman(existing.kh, dtSeconds);

      updateKalman(existing.kx, detection.x, MEASUREMENT_NOISE_XY);
      updateKalman(existing.ky, detection.y, MEASUREMENT_NOISE_XY);
      updateKalman(existing.kw, detection.width, MEASUREMENT_NOISE_WH);
      updateKalman(existing.kh, detection.height, MEASUREMENT_NOISE_WH);

      existing.className = className;
      existing.confidence = detection.confidence;
      existing.vessel = item.vessel;
      existing.lastMeasurementAtMs = sampleTimeMs;
      seenKeys.add(key);
    }
  }, [vessels, config.anonMatchDistancePx, config.trackDropMs]);

  useEffect(() => {
    let rafId = 0;

    const render = () => {
      const nowMs = Date.now();
      const next: DetectedVessel[] = [];
      const tracks = tracksRef.current;

      for (const [key, track] of tracks.entries()) {
        const ageMs = nowMs - track.lastMeasurementAtMs;
        if (ageMs > config.trackDropMs) {
          tracks.delete(key);
          continue;
        }

        const predictionHorizonMs = ageMs <= config.staleHoldMs ? ageMs : config.maxExtrapolationMs;
        const dtPredictionS = clamp(predictionHorizonMs, 0, config.maxExtrapolationMs) / 1000;

        const predicted = {
          x: track.kx.x + track.kx.v * dtPredictionS,
          y: track.ky.x + track.ky.v * dtPredictionS,
          width: Math.max(2, track.kw.x + track.kw.v * dtPredictionS),
          height: Math.max(2, track.kh.x + track.kh.v * dtPredictionS),
        };

        const dtRenderMs = Math.max(1, nowMs - track.lastRenderAtMs);
        const alpha = 1 - Math.exp(-dtRenderMs / EMA_TAU_MS);
        const prevRendered = track.lastRendered ?? predicted;
        const smoothed = {
          x: prevRendered.x + (predicted.x - prevRendered.x) * alpha,
          y: prevRendered.y + (predicted.y - prevRendered.y) * alpha,
          width: prevRendered.width + (predicted.width - prevRendered.width) * alpha,
          height: prevRendered.height + (predicted.height - prevRendered.height) * alpha,
        };

        track.lastRendered = smoothed;
        track.lastRenderAtMs = nowMs;

        next.push({
          detection: {
            x: smoothed.x,
            y: smoothed.y,
            width: smoothed.width,
            height: smoothed.height,
            confidence: track.confidence,
            class_name: track.className,
            track_id: track.trackIdForOutput,
          },
          vessel: track.vessel,
        });
      }

      setRendered(next);
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [config.maxExtrapolationMs, config.staleHoldMs, config.trackDropMs]);

  return rendered;
}
