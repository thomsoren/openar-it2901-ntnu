import React from "react";
import { ObcPoiData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-data/poi-data";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";
import { DetectedVessel } from "../../types/detection";
import { POI_CONFIG } from "../../config/video";
import { VideoTransform } from "../../hooks/useVideoTransform";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  vessels?: DetectedVessel[];
  videoTransform: VideoTransform;
  detectionFrame?: {
    width: number;
    height: number;
  } | null;
}

function PoiOverlay({ vessels = [], videoTransform, detectionFrame = null }: PoiOverlayProps) {
  if (vessels.length === 0) {
    return null;
  }

  const sourceWidth = videoTransform.sourceWidth;
  const sourceHeight = videoTransform.sourceHeight;
  const detectionWidth =
    detectionFrame?.width && detectionFrame.width > 0 ? detectionFrame.width : sourceWidth;
  const detectionHeight =
    detectionFrame?.height && detectionFrame.height > 0 ? detectionFrame.height : sourceHeight;
  const mapX = detectionWidth > 0 ? sourceWidth / detectionWidth : 1;
  const mapY = detectionHeight > 0 ? sourceHeight / detectionHeight : 1;

  return (
    <div className="poi-overlay">
      {vessels.map((item, index) => {
        const trackId = item.detection.track_id ?? index;

        // Scale coordinates from native resolution to rendered size
        const scaledX = item.detection.x * mapX * videoTransform.scaleX;
        const scaledY = item.detection.y * mapY * videoTransform.scaleY;

        // Add offset for letterbox/pillarbox
        const screenX = scaledX + videoTransform.offsetX;
        const screenY = scaledY + videoTransform.offsetY;

        // POI configuration for obc-poi-data:
        // - x: horizontal position
        // - y: line length (height from button to target)
        // - buttonY: vertical position of the button (top of POI)
        // We want the target at screenY (detection point), with line extending upward
        const lineHeight = POI_CONFIG.HEIGHT;
        const buttonY = screenY - lineHeight;

        // Prepare vessel data for display
        const vesselData = item.vessel?.name
          ? [{ value: item.vessel.name, label: "Vessel", unit: "" }]
          : [];

        return (
          <ObcPoiData
            key={trackId}
            style={{ position: "absolute" }}
            x={screenX}
            y={lineHeight}
            buttonY={buttonY}
            value={PoiDataValue.Unchecked}
            data={vesselData}
          />
        );
      })}
    </div>
  );
}

export default React.memo(PoiOverlay);
