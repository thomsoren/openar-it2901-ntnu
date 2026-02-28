import React, { useRef, useState, useLayoutEffect, useCallback, useMemo } from "react";
import { ObcPoiController } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-controller/poi-controller";
import { ObcPoiLayerStack } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-layer-stack/poi-layer-stack";
import { ObcPoiLayer } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-layer/poi-layer";
import { ObcPoiData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-data/poi-data";
import { PoiDataValue } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-data/poi-data";
import { DetectedVessel } from "../../types/detection";
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
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  videoSource?: string;
  videoFitMode?: string;
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

function PoiOverlay({
  vessels = [],
  videoTransform,
  detectionFrame = null,
  videoRef,
  videoSource,
  videoFitMode = "cover",
}: PoiOverlayProps) {
  const { state: arControls } = useARControls();
  const overlayRef = useRef<HTMLDivElement>(null);
  const layerElRef = useRef<HTMLElement | null>(null);
  const [layerTopOffset, setLayerTopOffset] = useState(0);

  const layerRefCallback = useCallback((el: unknown) => {
    layerElRef.current = el instanceof HTMLElement ? el : null;
  }, []);

  const measureLayerOffset = useCallback(() => {
    const overlay = overlayRef.current;
    const layer = layerElRef.current;
    if (!overlay || !layer) return;
    const overlayRect = overlay.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    setLayerTopOffset(layerRect.bottom - overlayRect.top);
  }, []);

  // Create ResizeObserver once, don't recreate on every vessel/transform update
  useLayoutEffect(() => {
    measureLayerOffset();

    const rafId = requestAnimationFrame(() => measureLayerOffset());
    const overlay = overlayRef.current;
    const layer = layerElRef.current;
    if (!overlay) return () => cancelAnimationFrame(rafId);

    const ro = new ResizeObserver(measureLayerOffset);
    ro.observe(overlay);
    if (layer) ro.observe(layer);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [measureLayerOffset]); // Don't include vessels.length or videoTransform

  const filteredVessels = vessels.filter((item) =>
    isLayerVisible(item.detection.class_name, arControls)
  );

  const sourceWidth = videoTransform.sourceWidth;
  const sourceHeight = videoTransform.sourceHeight;
  const detectionWidth =
    detectionFrame?.width && detectionFrame.width > 0 ? detectionFrame.width : sourceWidth;
  const detectionHeight =
    detectionFrame?.height && detectionFrame.height > 0 ? detectionFrame.height : sourceHeight;
  const mapX = detectionWidth > 0 ? sourceWidth / detectionWidth : 1;
  const mapY = detectionHeight > 0 ? sourceHeight / detectionHeight : 1;

  // Memoize vessel elements to prevent recreating web components on every render
  const vesselElements = useMemo(() => {
    return filteredVessels.map((item, index) => {
      const trackId = item.detection.track_id ?? `vessel-${index}`;

      const scaledX = item.detection.x * mapX * videoTransform.scaleX;
      const scaledY = item.detection.y * mapY * videoTransform.scaleY;

      const scaledWidth = item.detection.width * mapX * videoTransform.scaleX;
      const scaledHeight = item.detection.height * mapY * videoTransform.scaleY;

      const screenX = scaledX + videoTransform.offsetX;
      const screenY = scaledY + videoTransform.offsetY;

      // Prevent negative line lengths which can break web components
      const lineLength = Math.max(0, screenY - layerTopOffset);

      const vesselData =
        arControls.aisCardsVisible && item.vessel
          ? [{ value: item.vessel.speed?.toFixed(1) || "N/A", label: "SPD", unit: "kts" }]
          : [];

      return (
        <ObcPoiData
          key={trackId}
          style={{ position: "absolute" }}
          x={screenX}
          y={lineLength}
          boxWidth={scaledWidth}
          boxHeight={scaledHeight}
          value={PoiDataValue.Unchecked}
          data={vesselData}
          relativeDirection={item.vessel?.heading ?? 0}
        />
      );
    });
  }, [filteredVessels, mapX, mapY, videoTransform, layerTopOffset, arControls.aisCardsVisible]);

  return (
    <div className="poi-overlay" ref={overlayRef}>
      <ObcPoiController
        style={
          {
            display: "block",
            width: "100%",
            height: "100%",
            "--obc-poi-controller-stack-top": "15%",
          } as React.CSSProperties
        }
      >
        {videoRef && videoSource && (
          <video
            ref={videoRef}
            slot="media"
            autoPlay
            loop
            muted
            playsInline
            className="background-video"
            style={{ objectFit: videoFitMode === "cover" ? "cover" : "contain" }}
          >
            <source src={videoSource} type="video/mp4" />
          </video>
        )}
        <ObcPoiLayerStack
          slot="stack"
          selection-mode="multi"
          className="poi-layer-stack"
          style={{ transform: "none", height: "auto" }}
        >
          <ObcPoiLayer
            overlap-mode="crossing"
            label="Second Layer"
            className="poi-layer"
            is-selected
            debug
          >
            {/* Second layer content - can add different POIs here */}
          </ObcPoiLayer>
          <ObcPoiLayer
            debug
            ref={layerRefCallback}
            overlap-mode="crossing"
            label="Vessel Layer"
            className="poi-layer"
          >
            {vesselElements}
          </ObcPoiLayer>
        </ObcPoiLayerStack>
      </ObcPoiController>
    </div>
  );
}

export default React.memo(PoiOverlay);
