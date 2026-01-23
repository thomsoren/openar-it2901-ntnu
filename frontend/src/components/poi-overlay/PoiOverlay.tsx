import React from "react";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import { Detection } from "../../types/detection";
import { filterVisibleDetections } from "../../utils/detection-tracking";
import { POI_CONFIG } from "../../config/video";
import { VideoTransform } from "../../hooks/useVideoTransform";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  detections?: Detection[];
  videoTransform: VideoTransform;
}

/**
 * Overlay component that displays POI markers at detected object locations
 * Converts detection coordinates to screen positions accounting for video scaling and offset
 */
function PoiOverlay({ detections = [], videoTransform }: PoiOverlayProps) {
  const visibleDetections = filterVisibleDetections(detections);

  if (visibleDetections.length === 0) {
    return null;
  }

  return (
    <div className="poi-overlay">
      {visibleDetections.map((detection, index) => {
        // Map detection coordinates (from native video resolution) to actual rendered position
        // 1. Scale coordinates from native resolution to rendered size
        const scaledX = detection.x * videoTransform.scaleX;
        const scaledY = detection.y * videoTransform.scaleY;

        // 2. Add offset to account for letterbox/pillarbox
        const screenX = scaledX + videoTransform.offsetX;
        const screenY = scaledY + videoTransform.offsetY;

        return (
          <div
            key={index}
            className="poi-marker"
            style={{
              left: `${screenX}px`,
              top: `${screenY}px`,
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
