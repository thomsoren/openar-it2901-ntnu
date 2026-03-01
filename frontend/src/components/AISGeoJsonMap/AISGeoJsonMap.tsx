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
    updates: Partial<{ shipLat: number; shipLon: number; heading: number; offsetMeters: number }>
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
  const vesselMarkersRef = useRef<maplibregl.Marker[]>([]);

  const theme = useObcPalette();
  const [followMode, setFollowMode] = useState(true);
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
      const src = map.getSource("fov-wedge") as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [buildFovPolygon(lat, lng, heading, offsetMeters, fovDegrees)],
          },
        });
      }
      const [rLat, rLon] = destinationPoint(lat, lng, heading, offsetMeters);
      rangeRef.current?.setLngLat([rLon, rLat]);
    });
    originMarker.on("dragend", () => {
      const { lng, lat } = originMarker.getLngLat();
      onChange?.({ shipLat: lat, shipLon: lng });
    });
    originRef.current = originMarker;

    // Range / heading draggable marker
    const [rLat, rLon] = destinationPoint(shipLat, shipLon, heading, offsetMeters);
    const rangeEl = createMarkerElement(
      "geojson-map-range-icon",
      undefined,
      <ObiPlaceholderDeviceStatic />
    );
    const rangeMarker = new maplibregl.Marker({ element: rangeEl, draggable: true })
      .setLngLat([rLon, rLat])
      .setPopup(new maplibregl.Popup({ offset: 10 }).setText("Drag to set heading & range"))
      .addTo(map);

    rangeMarker.on("drag", () => {
      const { lng, lat } = rangeMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      const { fovDegrees } = propsRef.current;
      const src = map.getSource("fov-wedge") as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              buildFovPolygon(
                origin.lat,
                origin.lng,
                headingTo(origin.lat, origin.lng, lat, lng),
                distanceTo(origin.lat, origin.lng, lat, lng),
                fovDegrees
              ),
            ],
          },
        });
      }
    });
    rangeMarker.on("dragend", () => {
      const { lng, lat } = rangeMarker.getLngLat();
      const origin = originRef.current?.getLngLat();
      if (!origin) return;
      onChange?.({
        heading: Math.round(headingTo(origin.lat, origin.lng, lat, lng)),
        offsetMeters: Math.round(distanceTo(origin.lat, origin.lng, lat, lng)),
      });
    });
    rangeRef.current = rangeMarker;

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

    if (followMode) centerMap();
  }, [shipLat, shipLon, heading, offsetMeters, fovDegrees, centerMap, followMode]);

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
      <ObcButton
        variant={followMode ? ButtonVariant.flat : ButtonVariant.normal}
        onClick={toggleFollowMode}
        className="geojson-map-center-button"
      >
        {followMode ? "Following" : "Follow"}
      </ObcButton>

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
