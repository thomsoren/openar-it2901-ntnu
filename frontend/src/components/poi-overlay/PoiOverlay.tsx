import React from "react";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import { DetectedVessel } from "../../types/detection";
import { POI_CONFIG } from "../../config/video";
import { VideoTransform } from "../../hooks/useVideoTransform";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  vessels?: DetectedVessel[];
  videoTransform: VideoTransform;
}

function PoiOverlay({ vessels = [], videoTransform }: PoiOverlayProps) {
  if (vessels.length === 0) {
    return null;
  }

  return (
    <div className="poi-overlay">
      {vessels.map((item, index) => {
        const trackId = item.detection.track_id ?? index;

        // Scale coordinates from native resolution to rendered size
        const scaledX = item.detection.x * videoTransform.scaleX;
        const scaledY = item.detection.y * videoTransform.scaleY;

        // Add offset for letterbox/pillarbox
        const screenX = scaledX + videoTransform.offsetX;
        const screenY = scaledY + videoTransform.offsetY;

        return (
          <div
            key={trackId}
            className="poi-marker"
            style={{
              left: `${screenX}px`,
              top: `${screenY}px`,
            }}
          >
            <ObcPoiTarget height={POI_CONFIG.HEIGHT} />
            {item.vessel?.name && <span className="poi-label">{item.vessel.name}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(PoiOverlay);
