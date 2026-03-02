import React, { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./AISGeoJsonMap.css";
import { useObcPalette } from "../../hooks/useOBCTheme";
import { getMapLibreStyle } from "./AISGeoJsonMapTilemap";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { AISData } from "../../types/aisData";
import {
  destinationPoint,
  headingTo,
  buildScanPolygon,
  normalizeAngleDelta,
  computeAlongTrackDistance,
  computeCrossTrackDistance,
} from "../../utils/geometryMath";
import { AISDataPanel } from "../AISDataPanel/AISDataPanel";
import { ObiPlaceholderDeviceStatic } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-placeholder-device-static";
import {
  addScanAreaLayers,
  updateScanAreaData,
  getScanAreaSource,
  createAnchorMarker,
} from "./mapHelpers";
import { useVesselMarkers } from "../../hooks/useVesselMarkers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanAreaParams {
  shipLat: number;
  shipLon: number;
  heading: number;
  offsetMeters: number;
  fovDegrees: number;
  shapeMode: "wedge" | "rect";
  rectLength: number;
  rectWidth: number;
}

interface AISGeoJsonMapProps extends ScanAreaParams {
  vessels?: AISData[];
  onChange?: (updates: Partial<ScanAreaParams>) => void;
}

// ---------------------------------------------------------------------------
// Anchor-position computation (shared by init + sync)
// ---------------------------------------------------------------------------

interface AnchorPositions {
  range: [number, number]; // [lon, lat]
  heading: [number, number];
  fov: [number, number];
}

function computeAnchorPositions(
  lat: number,
  lon: number,
  heading: number,
  shapeMode: "wedge" | "rect",
  offsetMeters: number,
  fovDegrees: number,
  rectLength: number,
  rectWidth: number
): AnchorPositions {
  if (shapeMode === "rect") {
    const halfLen = rectLength / 2;
    const [fwdLat, fwdLon] = destinationPoint(lat, lon, heading, halfLen);
    const headingDist = Math.max(150, Math.round(halfLen * 0.7));
    const [hLat, hLon] = destinationPoint(lat, lon, heading, headingDist);
    const [sideLat, sideLon] = destinationPoint(lat, lon, heading + 90, rectWidth / 2);
    return {
      range: [fwdLon, fwdLat],
      heading: [hLon, hLat],
      fov: [sideLon, sideLat],
    };
  }

  const [rLat, rLon] = destinationPoint(lat, lon, heading, offsetMeters);
  const headingDist = Math.max(150, Math.round(offsetMeters * 0.7));
  const [hLat, hLon] = destinationPoint(lat, lon, heading, headingDist);
  const [fLat, fLon] = destinationPoint(lat, lon, heading + fovDegrees / 2, offsetMeters);
  return {
    range: [rLon, rLat],
    heading: [hLon, hLat],
    fov: [fLon, fLat],
  };
}

/** Apply computed positions to the marker refs. */
function applyAnchorPositions(
  positions: AnchorPositions,
  rangeRef: React.RefObject<maplibregl.Marker | null>,
  headingRef: React.RefObject<maplibregl.Marker | null>,
  fovRef: React.RefObject<maplibregl.Marker | null>
): void {
  rangeRef.current?.setLngLat(positions.range);
  headingRef.current?.setLngLat(positions.heading);
  fovRef.current?.setLngLat(positions.fov);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ANCHOR_ICON = <ObiPlaceholderDeviceStatic />;

export const AISGeoJsonMap: React.FC<AISGeoJsonMapProps> = ({
  shipLat,
  shipLon,
  heading,
  offsetMeters,
  fovDegrees,
  shapeMode,
  rectLength,
  rectWidth,
  vessels,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const originRef = useRef<maplibregl.Marker | null>(null);
  const rangeRef = useRef<maplibregl.Marker | null>(null);
  const headingRef = useRef<maplibregl.Marker | null>(null);
  const fovRef = useRef<maplibregl.Marker | null>(null);

  const theme = useObcPalette();
  const [followMode, setFollowMode] = useState(true);
  const [editMode, setEditMode] = useState(true);
  const [selectedVessel, setSelectedVessel] = useState<AISData | null>(null);

  // Mutable ref so drag handlers always see latest props
  const paramsRef = useRef<ScanAreaParams>({
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees,
    shapeMode,
    rectLength,
    rectWidth,
  });
  paramsRef.current = {
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees,
    shapeMode,
    rectLength,
    rectWidth,
  };

  // Ref for re-creating layers after style swap
  const rebuildLayersRef = useRef<(() => void) | null>(null);

  // ---- Callbacks ----

  const centerMap = useCallback(() => {
    mapRef.current?.panTo([shipLon, shipLat], { duration: 500 });
  }, [shipLat, shipLon]);

  const handleVesselClick = useCallback((vessel: AISData) => {
    setSelectedVessel(vessel);
  }, []);

  const setAnchorVisibility = useCallback((visible: boolean) => {
    const display = visible ? "flex" : "none";
    [originRef, rangeRef, headingRef, fovRef].forEach((ref) => {
      if (ref.current) ref.current.getElement().style.display = display;
    });
  }, []);

  // Keep vessel markers in sync with vessels data + selected vessel

  useVesselMarkers(mapRef.current, vessels, handleVesselClick);

  // Map initialisation (runs once)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapLibreStyle(theme),
      center: [shipLon, shipLat],
      zoom: 14,
    });

    // Add scan area layers on style load, and save a ref to re-add them after future style changes

    const rebuildLayers = () => {
      const p = paramsRef.current;
      const coords = buildScanPolygon(
        p.shipLat,
        p.shipLon,
        p.heading,
        p.offsetMeters,
        p.fovDegrees,
        p.shapeMode,
        p.rectLength,
        p.rectWidth
      );
      addScanAreaLayers(map, coords);
    };

    rebuildLayersRef.current = rebuildLayers;
    map.on("load", rebuildLayers);

    // --- Shared drag utility ------------------------------------------------

    /** Rebuild polygon + reposition anchors during a drag. */
    const syncVisuals = (
      lat: number,
      lon: number,
      hdg: number,
      overrides?: {
        offsetMeters?: number;
        fovDegrees?: number;
        rectLength?: number;
        rectWidth?: number;
      }
    ) => {
      const p = paramsRef.current;
      const coords = buildScanPolygon(
        lat,
        lon,
        hdg,
        overrides?.offsetMeters ?? p.offsetMeters,
        overrides?.fovDegrees ?? p.fovDegrees,
        p.shapeMode,
        overrides?.rectLength ?? p.rectLength,
        overrides?.rectWidth ?? p.rectWidth
      );
      updateScanAreaData(map, coords);

      const positions = computeAnchorPositions(
        lat,
        lon,
        hdg,
        p.shapeMode,
        overrides?.offsetMeters ?? p.offsetMeters,
        overrides?.fovDegrees ?? p.fovDegrees,
        overrides?.rectLength ?? p.rectLength,
        overrides?.rectWidth ?? p.rectWidth
      );
      applyAnchorPositions(positions, rangeRef, headingRef, fovRef);
    };

    // --- Origin marker -------------------------------------------------------

    const originMarker = createAnchorMarker(map, {
      className: "geojson-map-origin-icon",
      lngLat: [shipLon, shipLat],
      popupText: "Drag to move origin",
      icon: ANCHOR_ICON,
    });

    originMarker.on("drag", () => {
      const { lng, lat } = originMarker.getLngLat();
      syncVisuals(lat, lng, paramsRef.current.heading);
    });
    originMarker.on("dragend", () => {
      const { lng, lat } = originMarker.getLngLat();
      onChange?.({ shipLat: lat, shipLon: lng });
    });
    originRef.current = originMarker;

    // --- Range marker (constrained to heading ray) ---------------------------

    const initAnchors = computeAnchorPositions(
      shipLat,
      shipLon,
      heading,
      shapeMode,
      offsetMeters,
      fovDegrees,
      rectLength,
      rectWidth
    );

    const rangeMarker = createAnchorMarker(map, {
      className: "geojson-map-range-icon",
      lngLat: initAnchors.range,
      popupText: "Drag to set range",
      icon: ANCHOR_ICON,
    });

    rangeMarker.on("drag", () => {
      const { lng, lat } = rangeMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading, shapeMode } = paramsRef.current;
      const along = computeAlongTrackDistance(origin.lat, origin.lng, lat, lng, heading, 100);

      if (shapeMode === "rect") {
        const newLen = Math.max(100, along * 2);
        const [cLat, cLon] = destinationPoint(origin.lat, origin.lng, heading, newLen / 2);
        rangeMarker.setLngLat([cLon, cLat]);
        syncVisuals(origin.lat, origin.lng, heading, { rectLength: newLen });
      } else {
        const dist = Math.max(400, along);
        const [cLat, cLon] = destinationPoint(origin.lat, origin.lng, heading, dist);
        rangeMarker.setLngLat([cLon, cLat]);
        syncVisuals(origin.lat, origin.lng, heading, { offsetMeters: dist });
      }
    });

    rangeMarker.on("dragend", () => {
      const { lng, lat } = rangeMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading, shapeMode } = paramsRef.current;
      const along = computeAlongTrackDistance(origin.lat, origin.lng, lat, lng, heading, 100);

      if (shapeMode === "rect") {
        onChange?.({ rectLength: Math.round(Math.max(100, along * 2)) });
      } else {
        onChange?.({ offsetMeters: Math.round(Math.max(400, along)) });
      }
    });
    rangeRef.current = rangeMarker;

    // --- Heading marker (heading-only) ---------------------------------------

    const headingMarker = createAnchorMarker(map, {
      className: "geojson-map-heading-icon",
      lngLat: initAnchors.heading,
      popupText: "Drag to set heading",
      icon: ANCHOR_ICON,
    });

    headingMarker.on("drag", () => {
      const { lng, lat } = headingMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const nextHeading = headingTo(origin.lat, origin.lng, lat, lng);
      syncVisuals(origin.lat, origin.lng, nextHeading);
    });

    headingMarker.on("dragend", () => {
      const { lng, lat } = headingMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      onChange?.({ heading: Math.round(headingTo(origin.lat, origin.lng, lat, lng)) });
    });
    headingRef.current = headingMarker;

    // --- FOV / Width marker --------------------------------------------------

    const fovMarker = createAnchorMarker(map, {
      className: "geojson-map-fov-icon",
      lngLat: initAnchors.fov,
      popupText: "Drag to set FOV / width",
      icon: ANCHOR_ICON,
    });

    fovMarker.on("drag", () => {
      const { lng, lat } = fovMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading, shapeMode } = paramsRef.current;

      if (shapeMode === "rect") {
        const cross = computeCrossTrackDistance(origin.lat, origin.lng, lat, lng, heading);
        const newWidth = Math.max(50, cross * 2);
        syncVisuals(origin.lat, origin.lng, heading, { rectWidth: newWidth });
      } else {
        const fovBearing = headingTo(origin.lat, origin.lng, lat, lng);
        const nextFov = Math.min(
          360,
          Math.max(10, Math.abs(normalizeAngleDelta(fovBearing - heading)) * 2)
        );
        syncVisuals(origin.lat, origin.lng, heading, { fovDegrees: nextFov });
      }
    });

    fovMarker.on("dragend", () => {
      const { lng, lat } = fovMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading, shapeMode } = paramsRef.current;

      if (shapeMode === "rect") {
        const cross = computeCrossTrackDistance(origin.lat, origin.lng, lat, lng, heading);
        onChange?.({ rectWidth: Math.round(Math.max(50, cross * 2)) });
      } else {
        const fovBearing = headingTo(origin.lat, origin.lng, lat, lng);
        const nextFov = Math.min(
          360,
          Math.max(10, Math.abs(normalizeAngleDelta(fovBearing - heading)) * 2)
        );
        onChange?.({ fovDegrees: Math.round(nextFov) });
      }
    });
    fovRef.current = fovMarker;

    // Initially show anchors if in edit mode, hide if not

    setAnchorVisibility(editMode);
    map.on("dragstart", () => setFollowMode(false));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Sync polygon + anchors when props change ----------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const coords = buildScanPolygon(
      shipLat,
      shipLon,
      heading,
      offsetMeters,
      fovDegrees,
      shapeMode,
      rectLength,
      rectWidth
    );

    if (getScanAreaSource(map)) {
      updateScanAreaData(map, coords);
    } else if (map.isStyleLoaded()) {
      rebuildLayersRef.current?.();
    }

    originRef.current?.setLngLat([shipLon, shipLat]);

    const positions = computeAnchorPositions(
      shipLat,
      shipLon,
      heading,
      shapeMode,
      offsetMeters,
      fovDegrees,
      rectLength,
      rectWidth
    );
    applyAnchorPositions(positions, rangeRef, headingRef, fovRef);

    if (followMode) centerMap();
  }, [
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees,
    shapeMode,
    rectLength,
    rectWidth,
    centerMap,
    followMode,
  ]);

  // ---- Anchor visibility ---------------------------------------------------

  useEffect(() => {
    setAnchorVisibility(editMode);
  }, [editMode, setAnchorVisibility]);

  // ---- Theme sync ----------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let disposed = false;

    const rebuildLayers = () => {
      if (disposed) return;
      if (!map.isStyleLoaded()) return;
      rebuildLayersRef.current?.();
    };

    map.once("idle", rebuildLayers);
    map.setStyle(getMapLibreStyle(theme));

    return () => {
      disposed = true;
      map.off("idle", rebuildLayers);
    };
  }, [theme]);

  // ---- Keep selected vessel in sync ----------------------------------------

  useEffect(() => {
    if (!selectedVessel || !vessels) return;
    const updated = vessels.find((v) => v.mmsi === selectedVessel.mmsi);
    if (updated) setSelectedVessel(updated);
  }, [vessels, selectedVessel]);

  // ---- Render --------------------------------------------------------------

  const headerInfo =
    shapeMode === "rect"
      ? `${rectLength}m x ${rectWidth}m`
      : `${offsetMeters}m . FOV ${fovDegrees}°`;

  return (
    <div className="geojson-map-container">
      <div className="geojson-map-header">
        <span className="geojson-map-text">
          {Math.abs(shipLat).toFixed(4)}
          {shipLat >= 0 ? "N" : "S"} . {Math.abs(shipLon).toFixed(4)}
          {shipLon >= 0 ? "E" : "W"} . {heading}° . {headerInfo}
        </span>
      </div>

      <div ref={containerRef} style={{ height: "420px", width: "100%" }} />

      <div className="geojson-map-controls">
        <ObcButton
          variant={followMode ? ButtonVariant.flat : ButtonVariant.normal}
          onClick={() => {
            if (!followMode) centerMap();
            setFollowMode((prev) => !prev);
          }}
        >
          {followMode ? "Following" : "Follow"}
        </ObcButton>
        <ObcButton
          variant={editMode ? ButtonVariant.flat : ButtonVariant.normal}
          onClick={() => setEditMode((prev) => !prev)}
        >
          {editMode ? "Editing" : "Edit"}
        </ObcButton>
        <ObcButton
          variant={shapeMode === "rect" ? ButtonVariant.flat : ButtonVariant.normal}
          onClick={() => onChange?.({ shapeMode: shapeMode === "wedge" ? "rect" : "wedge" })}
        >
          {shapeMode === "rect" ? "Rect" : "Wedge"}
        </ObcButton>
      </div>

      {selectedVessel && (
        <AISDataPanel vessel={selectedVessel} onClose={() => setSelectedVessel(null)} />
      )}
    </div>
  );
};
