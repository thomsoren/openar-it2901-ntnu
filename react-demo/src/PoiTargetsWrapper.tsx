import React from "react";
import { ObcPoiTarget } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-target/poi-target";
import "./PoiTargetsWrapper.css";

const POI_HEIGHT = 150;

export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
}

function PoiTargetsWrapper({
  detections = [],
}: {
  detections?: Detection[];
}) {
  const visibleDetections = detections.filter((detection) => {
    if (!detection.class) {
      return false;
    }

    return detection.class.toLowerCase() !== "uncategorized";
  });

  // If we have detections, render POIs at detected boat locations
  if (visibleDetections.length === 0) {
    return null;
  }

  return (
    <div className="poi-container">
      {visibleDetections.map((detection, index) => {
        // Use percentage-based positioning for responsive scaling
        // Detection coordinates are from video processing (likely 1920x1080)
        // Convert to percentage of video dimensions
        const VIDEO_WIDTH = 1920;
        const VIDEO_HEIGHT = 1080;

        const leftPercent = (detection.x / VIDEO_WIDTH) * 100;
        const topPercent = (detection.y / VIDEO_HEIGHT) * 100;

        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
              transform: "translate(-50%, -100%)", // Center POI on detection point
              zIndex: 10,
            }}
          >
            <ObcPoiTarget height={POI_HEIGHT} />
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(PoiTargetsWrapper);
