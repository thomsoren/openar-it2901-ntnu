import React from "react";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import { DetectedVessel } from "../../types/detection";
import { VIDEO_CONFIG, POI_CONFIG } from "../../config/video";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  vessels?: DetectedVessel[];
}

/**
 * Overlay component that displays POI markers at detected vessel locations.
 * Shows vessel info from AIS data when available.
 */
function PoiOverlay({ vessels = [] }: PoiOverlayProps) {
  if (vessels.length === 0) {
    return null;
  }

  return (
    <div className="poi-overlay">
      {vessels.map((item, index) => {
        const { detection, vessel } = item;

        // Convert absolute coordinates to percentage-based positioning
        const leftPercent = (detection.x / VIDEO_CONFIG.WIDTH) * 100;
        const topPercent = (detection.y / VIDEO_CONFIG.HEIGHT) * 100;

        // Use track_id as key if available, otherwise fall back to index
        const key = detection.track_id ?? index;

        return (
          <div
            key={key}
            className="poi-marker"
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
            }}
          >
            <ObcPoiTarget
              height={POI_CONFIG.HEIGHT}
              label={vessel?.name}
            />
            {/* TODO: Add vessel info tooltip/card with AIS data */}
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(PoiOverlay);
