import React from "react";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import { Detection } from "../../types/detection";
import { filterVisibleDetections } from "../../utils/detection-tracking";
import { VIDEO_CONFIG, POI_CONFIG } from "../../config/video";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  detections?: Detection[];
}

/**
 * Overlay component that displays POI markers at detected object locations
 * Converts detection coordinates to responsive percentage-based positioning
 */
function PoiOverlay({ detections = [] }: PoiOverlayProps) {
  const visibleDetections = filterVisibleDetections(detections);

  if (visibleDetections.length === 0) {
    return null;
  }

  return (
    <div className="poi-overlay">
      {visibleDetections.map((detection, index) => {
        // Convert absolute coordinates to percentage-based positioning
        const leftPercent = (detection.x / VIDEO_CONFIG.WIDTH) * 100;
        const topPercent = (detection.y / VIDEO_CONFIG.HEIGHT) * 100;

        return (
          <div
            key={index}
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

export default React.memo(PoiOverlay);
