import React from "react";
import { ObcPoiData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-data/poi-data";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";
import { DetectedVessel } from "../../types/detection";
import { POI_CONFIG } from "../../config/video";
import { VideoTransform } from "../../hooks/useVideoTransform";
import { useARControls } from "../ar-control-panel/useARControls";
import "./PoiOverlay.css";

interface PoiOverlayProps {
  vessels?: DetectedVessel[];
  videoTransform: VideoTransform;
  detectionFrame?: {
    width: number;
    height: number;
  } | null;
}

function isLayerVisible(
  className: string | undefined,
  arControls: ReturnType<typeof useARControls>["state"]
): boolean {
  const cls = className ?? "boat";
  if (cls === "boat" || cls === "vessel") return arControls.vesselLayerVisible;
  if (cls === "buoy") return arControls.buoyLayerVisible;
  if (cls === "flotsam") return arControls.flotsamLayerVisible;
  if (cls === "mob") return arControls.mobLayerVisible;
  return arControls.vesselLayerVisible;
}

function PoiOverlay({ vessels = [], videoTransform, detectionFrame = null }: PoiOverlayProps) {
  const { state: arControls } = useARControls();

  const filteredVessels = vessels.filter((item) =>
    isLayerVisible(item.detection.class_name, arControls)
  );

  if (filteredVessels.length === 0) {
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
      {filteredVessels.map((item, index) => {
        const trackId = item.detection.track_id ?? index;

        const scaledX = item.detection.x * mapX * videoTransform.scaleX;
        const scaledY = item.detection.y * mapY * videoTransform.scaleY;

        const screenX = scaledX + videoTransform.offsetX;
        const screenY = scaledY + videoTransform.offsetY;

        const lineHeight = POI_CONFIG.HEIGHT;
        const buttonY = screenY - lineHeight;

        const vesselData =
          arControls.aisCardsVisible && item.vessel?.name
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
