import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./AISGeoJsonMap.css";
import { useObcPalette } from "../../hooks/useOBCTheme";
import { getMapLibreStyle } from "./AISGeoJsonMapTilemap";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { AISData } from "../../types/aisData";
import { destinationPoint, headingTo, distanceTo, buildFovPolygon } from "../../utils/geometryMath";
import { AISDataPanel } from "../AISDataPanel/AISDataPanel";
import getVesselIcon from "../../utils/vesselIconMapper";
import { ObiPlaceholderDeviceStatic } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-placeholder-device-static";

interface AISGeoJsonMapProps {
  shipLat: number;
  shipLon: number;
  heading: number;
  offsetMeters: number;
  fovDegrees: number;
  vessels?: AISData[];
  // Called when the user drags adjust-anchor on the map
  onChange?: (
    updates: Partial<{
      shipLat: number;
      shipLon: number;
      heading: number;
      offsetMeters: number;
      fovDegrees: number;
    }>
  ) => void;
}

/** Create an HTML element for a draggable marker */
function createMarkerElement(
  className: string,
  vessel?: AISData,
  icon?: React.ReactElement
): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;

  if (icon) {
    // Render provided icon
    const root = createRoot(element);
    root.render(icon);
  } else if (vessel) {
    // Add OpenBridge AIS target icon by rendering the appropriate React component
    const root = createRoot(element);
    const vesselIcon = getVesselIcon(vessel.shipType);
    root.render(vesselIcon);
  }

  return element;
}

export const AISGeoJsonMap: React.FC<AISGeoJsonMapProps> = ({
  shipLat,
  shipLon,
  heading,
  offsetMeters,
  fovDegrees,
  vessels,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const originRef = useRef<maplibregl.Marker | null>(null);
  const rangeRef = useRef<maplibregl.Marker | null>(null);
  const headingRef = useRef<maplibregl.Marker | null>(null);
  const fovRef = useRef<maplibregl.Marker | null>(null);
  const vesselMarkersRef = useRef<maplibregl.Marker[]>([]);

  const theme = useObcPalette();
  const [followMode, setFollowMode] = useState(true);
  const [editMode, setEditMode] = useState(true);
  const [selectedVessel, setSelectedVessel] = useState<AISData | null>(null);

  // Mutable refs so drag handlers always see latest props without re-binding
  const propsRef = useRef({ shipLat, shipLon, heading, offsetMeters, fovDegrees });
  propsRef.current = { shipLat, shipLon, heading, offsetMeters, fovDegrees };
  const addWedgeLayersRef = useRef<(() => void) | null>(null);

  const centerMap = useCallback(() => {
    if (!mapRef.current) return;
    mapRef.current.panTo([shipLon, shipLat], { duration: 500 });
  }, [shipLat, shipLon]);

  const toggleFollowMode = () => {
    if (!followMode) {
      centerMap();
    }
    setFollowMode((prev) => !prev);
  };

  const toggleEditMode = () => {
    setEditMode((prev) => !prev);
  };

  const setAdjustmentAnchorsVisibility = useCallback((visible: boolean) => {
    const display = visible ? "flex" : "none";
    [originRef.current, rangeRef.current, headingRef.current, fovRef.current].forEach((marker) => {
      if (!marker) return;
      marker.getElement().style.display = display;
    });
  }, []);

  // Initialize map on first render
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapLibreStyle(theme),
      center: [shipLon, shipLat],
      zoom: 14,
    });

    const addWedgeLayers = () => {
      // Only proceed if style is loaded
      if (!map.isStyleLoaded()) return;

      // Remove existing layers/source if present
      if (map.getLayer("fov-wedge-outline")) map.removeLayer("fov-wedge-outline");
      if (map.getLayer("fov-wedge-fill")) map.removeLayer("fov-wedge-fill");
      if (map.getSource("fov-wedge")) map.removeSource("fov-wedge");

      const { shipLat, shipLon, heading, offsetMeters, fovDegrees } = propsRef.current;

      // Add GeoJSON source with polygon geometry
      map.addSource("fov-wedge", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees)],
          },
        },
      });

      // Find the first symbol layer in the style to ensure our layers are added below labels/icons
      const layers = map.getStyle().layers;
      const firstSymbolLayerId = layers?.find((l) => l.type === "symbol")?.id;

      // Add outline first
      map.addLayer(
        {
          id: "fov-wedge-outline",
          type: "line",
          source: "fov-wedge",
          paint: {
            "line-color": "#0d6efd",
            "line-width": 3,
          },
        },
        firstSymbolLayerId
      );

      // Add fill last so it renders above the outline and any opaque tile layers
      map.addLayer(
        {
          id: "fov-wedge-fill",
          type: "fill",
          source: "fov-wedge",
          paint: {
            "fill-color": "#7dadf5",
            "fill-opacity": 0.15,
          },
        },
        firstSymbolLayerId
      );
    };

    const normalizeAngleDelta = (angle: number) => ((angle + 540) % 360) - 180;

    const updateWedgeGeometry = (
      originLat: number,
      originLon: number,
      headingDegrees: number,
      rangeMeters: number,
      fov: number
    ) => {
      const src = map.getSource("fov-wedge") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [buildFovPolygon(originLat, originLon, headingDegrees, rangeMeters, fov)],
        },
      });
    };

    const updateAnchorPositions = (
      originLat: number,
      originLon: number,
      headingDegrees: number,
      rangeMeters: number,
      fov: number
    ) => {
      const [rangeLat, rangeLon] = destinationPoint(
        originLat,
        originLon,
        headingDegrees,
        rangeMeters
      );
      rangeRef.current?.setLngLat([rangeLon, rangeLat]);

      const headingHandleDistance = Math.max(150, Math.round(rangeMeters * 0.7));
      const [headingLat, headingLon] = destinationPoint(
        originLat,
        originLon,
        headingDegrees,
        headingHandleDistance
      );
      headingRef.current?.setLngLat([headingLon, headingLat]);

      const [fovLat, fovLon] = destinationPoint(
        originLat,
        originLon,
        headingDegrees + fov / 2,
        rangeMeters
      );
      fovRef.current?.setLngLat([fovLon, fovLat]);
    };

    addWedgeLayersRef.current = addWedgeLayers;

    map.on("load", () => {
      addWedgeLayers();
    });

    // Origin draggable marker
    const originEl = createMarkerElement(
      "geojson-map-origin-icon",
      undefined,
      <ObiPlaceholderDeviceStatic />
    );
    const originMarker = new maplibregl.Marker({ element: originEl, draggable: true })
      .setLngLat([shipLon, shipLat])
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Drag to move origin"))
      .addTo(map);

    originMarker.on("drag", () => {
      const { lng, lat } = originMarker.getLngLat();
      const { heading, offsetMeters, fovDegrees } = propsRef.current;
      updateWedgeGeometry(lat, lng, heading, offsetMeters, fovDegrees);
      updateAnchorPositions(lat, lng, heading, offsetMeters, fovDegrees);
    });
    originMarker.on("dragend", () => {
      const { lng, lat } = originMarker.getLngLat();
      onChange?.({ shipLat: lat, shipLon: lng });
    });
    originRef.current = originMarker;

    // Range draggable marker (range-only; constrained to current heading ray)
    const [rLat, rLon] = destinationPoint(shipLat, shipLon, heading, offsetMeters);
    const rangeEl = createMarkerElement(
      "geojson-map-range-icon",
      undefined,
      <ObiPlaceholderDeviceStatic />
    );
    const rangeMarker = new maplibregl.Marker({ element: rangeEl, draggable: true })
      .setLngLat([rLon, rLat])
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Drag to set range"))
      .addTo(map);

    rangeMarker.on("drag", () => {
      const { lng, lat } = rangeMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading, fovDegrees } = propsRef.current;
      const dragBearing = headingTo(origin.lat, origin.lng, lat, lng);
      const dragDistance = distanceTo(origin.lat, origin.lng, lat, lng);
      const alongTrackDistance = Math.max(
        400,
        dragDistance *
          Math.max(0, Math.cos((normalizeAngleDelta(dragBearing - heading) * Math.PI) / 180))
      );

      const [constrainedLat, constrainedLon] = destinationPoint(
        origin.lat,
        origin.lng,
        heading,
        alongTrackDistance
      );

      rangeMarker.setLngLat([constrainedLon, constrainedLat]);
      updateWedgeGeometry(origin.lat, origin.lng, heading, alongTrackDistance, fovDegrees);
      updateAnchorPositions(origin.lat, origin.lng, heading, alongTrackDistance, fovDegrees);
    });

    rangeMarker.on("dragend", () => {
      const { lng, lat } = rangeMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading } = propsRef.current;
      const dragBearing = headingTo(origin.lat, origin.lng, lat, lng);
      const dragDistance = distanceTo(origin.lat, origin.lng, lat, lng);
      const alongTrackDistance = Math.max(
        400,
        dragDistance *
          Math.max(0, Math.cos((normalizeAngleDelta(dragBearing - heading) * Math.PI) / 180))
      );
      onChange?.({
        offsetMeters: Math.round(alongTrackDistance),
      });
    });
    rangeRef.current = rangeMarker;

    // Heading draggable marker (heading-only)
    const [hLat, hLon] = destinationPoint(
      shipLat,
      shipLon,
      heading,
      Math.max(150, Math.round(offsetMeters * 0.7))
    );
    const headingEl = createMarkerElement(
      "geojson-map-heading-icon",
      undefined,
      <ObiPlaceholderDeviceStatic />
    );
    const headingMarker = new maplibregl.Marker({ element: headingEl, draggable: true })
      .setLngLat([hLon, hLat])
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Drag to set heading"))
      .addTo(map);

    headingMarker.on("drag", () => {
      const { lng, lat } = headingMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { offsetMeters, fovDegrees } = propsRef.current;
      const nextHeading = headingTo(origin.lat, origin.lng, lat, lng);
      updateWedgeGeometry(origin.lat, origin.lng, nextHeading, offsetMeters, fovDegrees);
      updateAnchorPositions(origin.lat, origin.lng, nextHeading, offsetMeters, fovDegrees);
    });

    headingMarker.on("dragend", () => {
      const { lng, lat } = headingMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      onChange?.({
        heading: Math.round(headingTo(origin.lat, origin.lng, lat, lng)),
      });
    });
    headingRef.current = headingMarker;

    // FOV draggable marker (fov-only)
    const [fLat, fLon] = destinationPoint(shipLat, shipLon, heading + fovDegrees / 2, offsetMeters);
    const fovEl = createMarkerElement(
      "geojson-map-fov-icon",
      undefined,
      <ObiPlaceholderDeviceStatic />
    );
    const fovMarker = new maplibregl.Marker({ element: fovEl, draggable: true })
      .setLngLat([fLon, fLat])
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Drag to set FOV"))
      .addTo(map);

    fovMarker.on("drag", () => {
      const { lng, lat } = fovMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading, offsetMeters } = propsRef.current;
      const fovBearing = headingTo(origin.lat, origin.lng, lat, lng);
      const nextFovDegrees = Math.min(
        360,
        Math.max(10, Math.abs(normalizeAngleDelta(fovBearing - heading)) * 2)
      );
      updateWedgeGeometry(origin.lat, origin.lng, heading, offsetMeters, nextFovDegrees);
      updateAnchorPositions(origin.lat, origin.lng, heading, offsetMeters, nextFovDegrees);
    });

    fovMarker.on("dragend", () => {
      const { lng, lat } = fovMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { heading } = propsRef.current;
      const fovBearing = headingTo(origin.lat, origin.lng, lat, lng);
      const nextFovDegrees = Math.min(
        360,
        Math.max(10, Math.abs(normalizeAngleDelta(fovBearing - heading)) * 2)
      );
      onChange?.({
        fovDegrees: Math.round(nextFovDegrees),
      });
    });
    fovRef.current = fovMarker;

    updateAnchorPositions(shipLat, shipLon, heading, offsetMeters, fovDegrees);
    setAdjustmentAnchorsVisibility(editMode);

    // Detect user panning and disable follow mode
    map.on("dragstart", () => setFollowMode(false));

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync wedge + markers when props change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const src = map.getSource("fov-wedge") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees)],
        },
      });
    } else if (map.isStyleLoaded()) {
      // Only try to create layers if style is ready
      addWedgeLayersRef.current?.();
    }

    originRef.current?.setLngLat([shipLon, shipLat]);
    const [rLat, rLon] = destinationPoint(shipLat, shipLon, heading, offsetMeters);
    rangeRef.current?.setLngLat([rLon, rLat]);
    const [hLat, hLon] = destinationPoint(
      shipLat,
      shipLon,
      heading,
      Math.max(150, Math.round(offsetMeters * 0.7))
    );
    headingRef.current?.setLngLat([hLon, hLat]);
    const [fLat, fLon] = destinationPoint(shipLat, shipLon, heading + fovDegrees / 2, offsetMeters);
    fovRef.current?.setLngLat([fLon, fLat]);

    if (followMode) centerMap();
  }, [shipLat, shipLon, heading, offsetMeters, fovDegrees, centerMap, followMode]);

  useEffect(() => {
    setAdjustmentAnchorsVisibility(editMode);
  }, [editMode, setAdjustmentAnchorsVisibility]);

  // Sync vessel markers when vessels data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing vessel markers
    vesselMarkersRef.current.forEach((marker) => marker.remove());
    vesselMarkersRef.current = [];

    if (!vessels) return;

    vessels.forEach((vessel) => {
      if (!vessel.latitude || !vessel.longitude) return;

      const el = createMarkerElement("geojson-map-vessel-icon", vessel);

      const popup = new maplibregl.Popup({ offset: 10 }).setText(
        `MMSI: ${vessel.mmsi}\n${vessel.name || "Unknown Vessel"}`
      );

      const marker = new maplibregl.Marker({
        element: el,
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat([vessel.longitude, vessel.latitude])
        .setRotation(vessel.courseOverGround || 0)
        .setPopup(popup)
        .addTo(map);

      el.addEventListener("click", () => {
        setSelectedVessel(vessel);
        map.panTo([vessel.longitude!, vessel.latitude!], { duration: 500 });
      });

      vesselMarkersRef.current.push(marker);
    });
  }, [vessels]);

  // Update map style on theme change, re-adding wedge layers after style loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(getMapLibreStyle(theme));
    map.once("styledata", () => {
      addWedgeLayersRef.current?.();
    });
  }, [theme]);

  // Keep selected vessel data in sync when AIS updates arrive
  useEffect(() => {
    if (!selectedVessel || !vessels) return;

    const updated = vessels.find((v) => v.mmsi === selectedVessel.mmsi);
    if (updated) setSelectedVessel(updated);
  }, [vessels, selectedVessel]);

  return (
    <div className="geojson-map-container">
      <div className="geojson-map-header">
        <span className="geojson-map-text">
          {Math.abs(shipLat).toFixed(4)}
          {shipLat >= 0 ? "N" : "S"} . {Math.abs(shipLon).toFixed(4)}
          {shipLon >= 0 ? "E" : "W"} . {heading}° . {offsetMeters}m . FOV {fovDegrees}°
        </span>
      </div>
      <div ref={containerRef} style={{ height: "420px", width: "100%" }} />
      <div className="geojson-map-controls">
        <ObcButton
          variant={followMode ? ButtonVariant.flat : ButtonVariant.normal}
          onClick={toggleFollowMode}
        >
          {followMode ? "Following" : "Follow"}
        </ObcButton>
        <ObcButton
          variant={editMode ? ButtonVariant.flat : ButtonVariant.normal}
          onClick={toggleEditMode}
        >
          {editMode ? "Editing" : "Edit"}
        </ObcButton>
      </div>

      {/* 
          Selected vessel card 
          TODO: Change with OBC-Poi-Card component
      */}
      {selectedVessel && (
        <AISDataPanel
          vessel={selectedVessel}
          onClose={() => {
            setSelectedVessel(null);
          }}
        />
      )}
    </div>
  );
};
