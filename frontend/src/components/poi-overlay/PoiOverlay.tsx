import React, { useRef, useState, useLayoutEffect, useCallback, useEffect } from "react";
import { ObcPoiController } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-controller/poi-controller";
import { ObcPoiLayerStack } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-layer-stack/poi-layer-stack";
import { ObcPoiLayer } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-layer/poi-layer";
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
  metricsMode?: "default" | "fusion";
}

type PoiMetric = {
  value: string;
  label: string;
  unit: string;
};

type PoiDataElement = HTMLElement & {
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  value: PoiDataValue;
  data: PoiMetric[];
  relativeDirection: number;
};

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

const formatMmsiPrefix = (mmsi: string | undefined): string => {
  if (!mmsi) return "N/A";
  const digitsOnly = mmsi.replace(/\D/g, "");
  const source = digitsOnly || mmsi;
  return source.slice(0, 4) || "N/A";
};

const formatNumber = (value: number | null | undefined, digits = 0): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return value.toFixed(digits);
};

function PoiOverlay({
  vessels = [],
  videoTransform,
  detectionFrame = null,
  videoRef,
  videoSource,
  videoFitMode = "cover",
  metricsMode = "default",
}: PoiOverlayProps) {
  const { state: arControls } = useARControls();
  const overlayRef = useRef<HTMLDivElement>(null);
  const layerElRef = useRef<HTMLElement | null>(null);
  const [layerTopOffset, setLayerTopOffset] = useState(0);

  // Tracks all imperatively-created obc-poi-data elements by trackId.
  // We never query layer.children because the web component may move elements
  // into obc-poi-group containers; instead we own the references ourselves.
  const poiElementsRef = useRef<Map<string | number, PoiDataElement>>(new Map());

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
  }, [measureLayerOffset]);

  // Imperatively sync obc-poi-data elements with the current vessel list.
  // We bypass React reconciliation entirely for these elements because
  // obc-poi-layer internally moves its light-DOM children (even without
  // overlap-mode), which breaks React's removeChild assumptions.
  useEffect(() => {
    const layer = layerElRef.current;
    if (!layer) return;

    const sourceWidth = videoTransform.sourceWidth;
    const sourceHeight = videoTransform.sourceHeight;
    const detectionWidth =
      detectionFrame?.width && detectionFrame.width > 0 ? detectionFrame.width : sourceWidth;
    const detectionHeight =
      detectionFrame?.height && detectionFrame.height > 0 ? detectionFrame.height : sourceHeight;
    const mapX = detectionWidth > 0 ? sourceWidth / detectionWidth : 1;
    const mapY = detectionHeight > 0 ? sourceHeight / detectionHeight : 1;

    const keysToRemove = new Set(poiElementsRef.current.keys());

    vessels.forEach((item, index) => {
      const detection = item?.detection;
      if (!detection) {
        return;
      }
      if (!isLayerVisible(detection.class_name, arControls)) {
        return;
      }

      const trackId = detection.track_id ?? `vessel-${index}`;
      keysToRemove.delete(trackId);

      const scaledX = detection.x * mapX * videoTransform.scaleX;
      const scaledY = detection.y * mapY * videoTransform.scaleY;
      const scaledWidth = Math.max(1, Math.abs(detection.width * mapX * videoTransform.scaleX));
      const scaledHeight = Math.max(1, Math.abs(detection.height * mapY * videoTransform.scaleY));
      const screenX = scaledX + videoTransform.offsetX;
      const screenY = scaledY + videoTransform.offsetY;
      const lineLength = Math.max(0, screenY - layerTopOffset);

      const matchDistancePx = item.fusion?.match_distance_px ?? item.match_distance_px;
      const hasFusionMetrics =
        Boolean(item.vessel) && matchDistancePx !== null && matchDistancePx !== undefined;

      const trackingId =
        typeof detection.track_id === "number" ? String(detection.track_id) : "N/A";
      const vesselData =
        arControls.aisCardsVisible && item.vessel
          ? metricsMode === "fusion"
            ? [
                { value: formatMmsiPrefix(item.vessel.mmsi), label: "MMSI", unit: "" },
                hasFusionMetrics
                  ? { value: formatNumber(matchDistancePx, 1), label: "Dpx", unit: "px" }
                  : { value: trackingId, label: "TRK", unit: "" },
              ]
            : hasFusionMetrics
              ? [
                  { value: formatMmsiPrefix(item.vessel.mmsi), label: "MMSI", unit: "" },
                  { value: formatNumber(matchDistancePx, 1), label: "Dpx", unit: "px" },
                ]
              : [{ value: item.vessel.speed?.toFixed(1) || "N/A", label: "SPD", unit: "kts" }]
          : [];

      let el = poiElementsRef.current.get(trackId);
      if (!el) {
        el = document.createElement("obc-poi-data") as PoiDataElement;
        el.style.position = "absolute";
        poiElementsRef.current.set(trackId, el);
        layer.appendChild(el);
      }

      // Update Lit reactive properties directly on the element.
      el.x = screenX;
      el.y = lineLength;
      el.boxWidth = scaledWidth;
      el.boxHeight = scaledHeight;
      el.value = PoiDataValue.Unchecked;
      el.data = vesselData;
      el.relativeDirection = item.vessel?.heading ?? 0;
    });

    // Remove elements whose vessels are no longer present.
    // Use el.parentNode (not layer) because the web component may have
    // moved the element into an obc-poi-group child.
    for (const key of keysToRemove) {
      const el = poiElementsRef.current.get(key);
      if (el) {
        el.parentNode?.removeChild(el);
        poiElementsRef.current.delete(key);
      }
    }
  }, [vessels, arControls, videoTransform, detectionFrame, layerTopOffset, metricsMode]);

  // Remove all imperative elements when this component unmounts.
  useEffect(() => {
    const poiElements = poiElementsRef.current;
    return () => {
      for (const el of poiElements.values()) {
        el.parentNode?.removeChild(el);
      }
      poiElements.clear();
    };
  }, []);

  return (
    <div className="poi-overlay" ref={overlayRef}>
      <ObcPoiController
        style={
          {
            display: "block",
            width: "100%",
            height: "100%",
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
        <div
          slot="stack"
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column-reverse",
          }}
        >
          <div style={{ height: "60%" }} />
          <ObcPoiLayerStack
            selection-mode="multi"
            className="poi-layer-stack"
            style={{
              transform: "none",
              height: "auto",
            }}
          >
            <ObcPoiLayer label="Second Layer" className="poi-layer" is-selected>
              {/* Second layer content */}
            </ObcPoiLayer>
            <ObcPoiLayer ref={layerRefCallback} label="Vessel Layer" className="poi-layer">
              {/* obc-poi-data elements are managed imperatively in useEffect above */}
            </ObcPoiLayer>
          </ObcPoiLayerStack>
        </div>
      </ObcPoiController>
    </div>
  );
}

export default React.memo(PoiOverlay);
