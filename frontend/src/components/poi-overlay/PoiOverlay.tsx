import React from "react";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import { DetectedVessel } from "../../types/detection";
import { VIDEO_CONFIG, POI_CONFIG } from "../../config/video";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  vessels?: DetectedVessel[];
  width?: number;
  height?: number;
}

/**
 * Overlay component that displays POI markers at detected vessel locations.
 * Shows vessel info from AIS data when available.
 */
function PoiOverlay({
  vessels = [],
  width = VIDEO_CONFIG.WIDTH,
  height = VIDEO_CONFIG.HEIGHT,
}: PoiOverlayProps) {
  if (vessels.length === 0) {
    return null;
  }

  return (
    <div className="poi-overlay">
      {vessels.map((item, index) => {
        const { detection } = item;

        // Convert absolute coordinates to percentage-based positioning
        const leftPercent = (detection.x / width) * 100;
        const topPercent = (detection.y / height) * 100;

        // IMPORTANT: Use track_id as key for stable identity
        // This prevents React from unmounting/remounting the same boat
        const key = detection.track_id ?? `temp-${index}`;

        return (
          <div
            key={key}
            className="poi-marker"
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
            }}
          >
            <ObcPoiTarget height={POI_CONFIG.HEIGHT} />
          </div>
        );
      })}
    </div>
  );
}

// Memoize with custom comparison to prevent unnecessary re-renders
export default React.memo(PoiOverlay, (prevProps, nextProps) => {
  const prevVessels = prevProps.vessels || [];
  const nextVessels = nextProps.vessels || [];

  // Only re-render if vessels array actually changed
  if (prevVessels.length !== nextVessels.length) {
    return false;
  }

  // Check if vessel positions or IDs changed
  for (let i = 0; i < prevVessels.length; i++) {
    const prev = prevVessels[i]?.detection;
    const next = nextVessels[i]?.detection;

    if (!prev || !next) return false;

    if (prev.track_id !== next.track_id || prev.x !== next.x || prev.y !== next.y) {
      return false;
    }
  }

  return true; // No changes, skip re-render
});
