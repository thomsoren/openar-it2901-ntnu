/**
 * Map layer and marker helpers for AISGeoJsonMap.
 *
 * Consolidates repeated GeoJSON construction, layer management,
 * and draggable-marker creation logic.
 */
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import type { ReactElement } from "react";
import { AISData } from "../../types/aisData";
import getVesselIcon, { type VesselIconSet } from "../../utils/vesselIconMapper";

// Utility functions
function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getVesselMarkerRotation(vessel: AISData): number {
  if (isFiniteNumber(vessel.trueHeading)) {
    return vessel.trueHeading;
  }

  if (isFiniteNumber(vessel.courseOverGround)) {
    return vessel.courseOverGround;
  }

  return 0;
}

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

// Scan-area layer management
// ---------------------------------------------------------------------------

const LAYER_OUTLINE = "fov-wedge-outline";
const LAYER_FILL = "fov-wedge-fill";
const SOURCE_ID = "fov-wedge";
const SCAN_AREA_COLOR = "#2d558c";
const SCAN_AREA_BORDER_COLOR = "#cadefc";

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
      paint: { "line-color": SCAN_AREA_COLOR, "line-width": 3 },
    },
    firstSymbolId
  );

  map.addLayer(
    {
      id: LAYER_FILL,
      type: "fill",
      source: SOURCE_ID,
      paint: { "fill-color": SCAN_AREA_BORDER_COLOR, "fill-opacity": 0.3 },
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

// Marker factories
// ---------------------------------------------------------------------------

interface AnchorMarkerOptions {
  className: string;
  lngLat: [number, number];
  icon: ReactElement;
  draggable?: boolean;
}

/** Create a draggable anchor marker with an icon (no popup - add separately if needed). */
export function createAnchorMarker(
  map: maplibregl.Map,
  { className, lngLat, icon, draggable = true }: AnchorMarkerOptions
): maplibregl.Marker {
  const element = document.createElement("div");
  element.className = className;
  const root = createRoot(element);
  root.render(icon);

  const marker = new maplibregl.Marker({ element, draggable }).setLngLat(lngLat).addTo(map);

  return marker;
}

/** Create a non-draggable vessel marker. */
export function createVesselMarker(
  map: maplibregl.Map,
  vessel: AISData,
  onClick: (vessel: AISData) => void,
  iconSet: VesselIconSet = "generic"
): maplibregl.Marker {
  const element = document.createElement("div");
  element.className = "geojson-map-vessel-icon";

  const root = createRoot(element);
  root.render(getVesselIcon(vessel, { iconSet, returnType: "icon" }));

  const popup = new maplibregl.Popup({ offset: 10 }).setText(
    `MMSI: ${vessel.mmsi}\n${vessel.name || "Unknown Vessel"}`
  );

  const marker = new maplibregl.Marker({
    element: element,
    rotationAlignment: "map",
    pitchAlignment: "map",
  })
    .setLngLat([vessel.longitude ?? 0, vessel.latitude ?? 0])
    .setRotation(getVesselMarkerRotation(vessel))
    .setPopup(popup)
    .addTo(map);

  element.addEventListener("click", () => {
    if (isFiniteNumber(vessel.longitude) && isFiniteNumber(vessel.latitude)) {
      onClick(vessel);
    }
  });

  return marker;
}
