import React, { useRef, useEffect, useState } from "react";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import { DetectedVessel } from "../../types/detection";
import { VIDEO_CONFIG, POI_CONFIG } from "../../config/video";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  vessels?: DetectedVessel[];
}

interface SmoothedPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
  lastUpdate: number;
}

const SMOOTHING_FACTOR = 0.15; // Lower = smoother but more lag

/**
 * Overlay component that displays POI markers at detected vessel locations.
 * Uses interpolation for smooth marker movement between detection updates.
 */
function PoiOverlay({ vessels = [] }: PoiOverlayProps) {
  const positionsRef = useRef<Map<number, SmoothedPosition>>(new Map());
  const [smoothedVessels, setSmoothedVessels] = useState<
    Array<{
      trackId: number;
      x: number;
      y: number;
      width: number;
      height: number;
      vessel: DetectedVessel["vessel"];
    }>
  >([]);
  const animationRef = useRef<number | null>(null);

  // Update target positions when new detections arrive
  useEffect(() => {
    const now = Date.now();
    const currentTrackIds = new Set<number>();

    vessels.forEach((item, index) => {
      const trackId = item.detection.track_id ?? -(index + 1);
      currentTrackIds.add(trackId);

      const existing = positionsRef.current.get(trackId);
      if (existing) {
        // Update target position
        existing.targetX = item.detection.x;
        existing.targetY = item.detection.y;
        existing.targetWidth = item.detection.width;
        existing.targetHeight = item.detection.height;
        existing.lastUpdate = now;
      } else {
        // New detection - start at target position
        positionsRef.current.set(trackId, {
          x: item.detection.x,
          y: item.detection.y,
          width: item.detection.width,
          height: item.detection.height,
          targetX: item.detection.x,
          targetY: item.detection.y,
          targetWidth: item.detection.width,
          targetHeight: item.detection.height,
          lastUpdate: now,
        });
      }
    });

    // Remove old tracks that haven't been updated recently
    const staleThreshold = 500; // ms
    positionsRef.current.forEach((pos, trackId) => {
      if (!currentTrackIds.has(trackId) && now - pos.lastUpdate > staleThreshold) {
        positionsRef.current.delete(trackId);
      }
    });
  }, [vessels]);

  // Animation loop for smooth interpolation
  useEffect(() => {
    const animate = () => {
      const updated: typeof smoothedVessels = [];

      positionsRef.current.forEach((pos, trackId) => {
        // Lerp towards target
        pos.x += (pos.targetX - pos.x) * SMOOTHING_FACTOR;
        pos.y += (pos.targetY - pos.y) * SMOOTHING_FACTOR;
        pos.width += (pos.targetWidth - pos.width) * SMOOTHING_FACTOR;
        pos.height += (pos.targetHeight - pos.height) * SMOOTHING_FACTOR;

        // Find vessel info for this track
        const vesselData = vessels.find((v, i) => (v.detection.track_id ?? -(i + 1)) === trackId);

        updated.push({
          trackId,
          x: pos.x,
          y: pos.y,
          width: pos.width,
          height: pos.height,
          vessel: vesselData?.vessel ?? null,
        });
      });

      setSmoothedVessels(updated);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [vessels]);

  if (smoothedVessels.length === 0) {
    return null;
  }

  return (
    <div className="poi-overlay">
      {smoothedVessels.map((item) => {
        // Convert absolute coordinates to percentage-based positioning
        const leftPercent = (item.x / VIDEO_CONFIG.WIDTH) * 100;
        const topPercent = (item.y / VIDEO_CONFIG.HEIGHT) * 100;

        return (
          <div
            key={item.trackId}
            className="poi-marker"
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
            }}
          >
            <ObcPoiTarget height={POI_CONFIG.HEIGHT} label={item.vessel?.name} />
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(PoiOverlay);
