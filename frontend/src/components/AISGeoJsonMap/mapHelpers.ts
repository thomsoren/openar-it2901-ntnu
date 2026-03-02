/**
 * Map layer and marker helpers for AISGeoJsonMap.
 *
 * Consolidates repeated GeoJSON construction, layer management,
 * and draggable-marker creation logic.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { AISData } from "../../types/aisData";
import getVesselIcon from "../../utils/vesselIconMapper";

// ---------------------------------------------------------------------------
// GeoJSON helpers
// ---------------------------------------------------------------------------

/** Wrap polygon coordinates into a GeoJSON Feature */
export function makePolygonFeature(coords: [number, number][]): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

// ---------------------------------------------------------------------------
// Scan-area layer management
// ---------------------------------------------------------------------------

const LAYER_OUTLINE = "fov-wedge-outline";
const LAYER_FILL = "fov-wedge-fill";
const SOURCE_ID = "fov-wedge";

/** Remove existing scan-area source & layers, then add fresh ones. */
export function addScanAreaLayers(map: maplibregl.Map, coords: [number, number][]): void {
  if (!map.isStyleLoaded()) return;

  // Remove existing
  if (map.getLayer(LAYER_OUTLINE)) map.removeLayer(LAYER_OUTLINE);
  if (map.getLayer(LAYER_FILL)) map.removeLayer(LAYER_FILL);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

  map.addSource(SOURCE_ID, { type: "geojson", data: makePolygonFeature(coords) });

  // Insert below the first symbol layer so labels/icons stay on top
  const firstSymbolId = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;

  map.addLayer(
    {
      id: LAYER_OUTLINE,
      type: "line",
      source: SOURCE_ID,
      paint: { "line-color": "#0d6efd", "line-width": 3 },
    },
    firstSymbolId
  );

  map.addLayer(
    {
      id: LAYER_FILL,
      type: "fill",
      source: SOURCE_ID,
      paint: { "fill-color": "#7dadf5", "fill-opacity": 0.15 },
    },
    firstSymbolId
  );
}

/** Update only the GeoJSON data of the scan-area source (no layer recreation). */
export function updateScanAreaData(map: maplibregl.Map, coords: [number, number][]): void {
  const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  src.setData(makePolygonFeature(coords));
}

/** Return the GeoJSON source if it exists. */
export function getScanAreaSource(map: maplibregl.Map): maplibregl.GeoJSONSource | undefined {
  return map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
}

// ---------------------------------------------------------------------------
// Marker factories
// ---------------------------------------------------------------------------

interface AnchorMarkerOptions {
  className: string;
  lngLat: [number, number];
  popupText: string;
  icon: React.ReactElement;
}

/** Create a draggable anchor marker with an icon and popup. */
export function createAnchorMarker(
  map: maplibregl.Map,
  { className, lngLat, popupText, icon }: AnchorMarkerOptions
): maplibregl.Marker {
  const element = document.createElement("div");
  element.className = className;
  createRoot(element).render(icon);

  return new maplibregl.Marker({ element, draggable: true })
    .setLngLat(lngLat)
    .setPopup(new maplibregl.Popup({ offset: 10 }).setText(popupText))
    .addTo(map);
}

/** Create a non-draggable vessel marker. */
export function createVesselMarker(
  map: maplibregl.Map,
  vessel: AISData,
  onClick: (vessel: AISData) => void
): maplibregl.Marker {
  const element = document.createElement("div");
  element.className = "geojson-map-vessel-icon";

  if (vessel.shipType) {
    createRoot(element).render(getVesselIcon(vessel.shipType));
  }

  const popup = new maplibregl.Popup({ offset: 10 }).setText(
    `MMSI: ${vessel.mmsi}\n${vessel.name || "Unknown Vessel"}`
  );

  const marker = new maplibregl.Marker({
    element: element,
    rotationAlignment: "map",
    pitchAlignment: "map",
  })
    .setLngLat([vessel.longitude!, vessel.latitude!])
    .setRotation(vessel.courseOverGround || 0)
    .setPopup(popup)
    .addTo(map);

  element.addEventListener("click", () => onClick(vessel));

  return marker;
}
