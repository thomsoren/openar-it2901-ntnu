import React, { useEffect, useRef } from "react";
import type { Map, Marker, Polygon, LeafletEvent } from "leaflet";
import type * as LeafletType from "leaflet";
import "./AISGeoJsonMap.css";
import { useObcPalette } from "../../hooks/useOBCTheme";
import getTilemapURL from "./AISGeoJSONMapTilemap";

interface AISGeoJsonMapProps {
  shipLat: number;
  shipLon: number;
  heading: number;
  offsetMeters: number;
  fovDegrees: number;
  // Called when the user drags adjust-anchor on the map
  onChange?: (
    updates: Partial<{ shipLat: number; shipLon: number; heading: number; offsetMeters: number }>
  ) => void;
}

// Geo helpers
const METERS_PER_LAT_DEGREE = 111_320;
const metersPerLonDegree = (lat: number) => METERS_PER_LAT_DEGREE * Math.cos(lat * (Math.PI / 180));

// Return the destination point from current origin, based on heading (degrees) and distance (metres)
function destinationPoint(
  lat: number,
  lon: number,
  headingDeg: number,
  distanceM: number
): [number, number] {
  const headingRad = headingDeg * (Math.PI / 180);
  const destLat = lat + (distanceM * Math.cos(headingRad)) / METERS_PER_LAT_DEGREE;
  const destLon = lon + (distanceM * Math.sin(headingRad)) / metersPerLonDegree(lat);
  return [destLat, destLon];
}

// Return the compass heading (0-360 degrees) from point A to point B
function headingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const deltaY = (lat2 - lat1) * METERS_PER_LAT_DEGREE;
  const deltaX = (lon2 - lon1) * metersPerLonDegree(lat1);
  return (Math.atan2(deltaX, deltaY) * (180 / Math.PI) + 360) % 360;
}

// Return the straight-line distance in metres between two points
function distanceTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const deltaY = (lat2 - lat1) * METERS_PER_LAT_DEGREE;
  const deltaX = (lon2 - lon1) * metersPerLonDegree(lat1);
  return Math.sqrt(deltaX ** 2 + deltaY ** 2);
}

// Helper to build the geojson shape
function buildWedge(
  lat: number,
  lon: number,
  headingDeg: number,
  rangeMetre: number,
  fovDeg: number,
  steps = 48
): [number, number][] {
  const half = fovDeg / 2;
  const arc: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    arc.push(destinationPoint(lat, lon, headingDeg - half + (fovDeg * i) / steps, rangeMetre));
  }
  return [[lat, lon], ...arc, [lat, lon]];
}

/**  Leaflet CDN loader  **/

type LeafletLib = typeof LeafletType;

let leafletPromise: Promise<LeafletLib> | null = null;

async function loadLeaflet(): Promise<LeafletLib> {
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if ((window as Window & { L?: LeafletLib }).L) {
      resolve((window as Window & { L: LeafletLib }).L);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    script.onload = () => resolve((window as Window & { L: LeafletLib }).L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletPromise;
}

export const AISGeoJsonMap: React.FC<AISGeoJsonMapProps> = ({
  shipLat,
  shipLon,
  heading,
  offsetMeters,
  fovDegrees,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const wedgeRef = useRef<Polygon | null>(null);
  const originRef = useRef<Marker | null>(null);
  const rangeRef = useRef<Marker | null>(null);
  const tileLayerRef = useRef<LeafletType.TileLayer | null>(null);
  const theme = useObcPalette();

  // Initialize map on first render
  useEffect(() => {
    let alive = true;
    loadLeaflet().then((L) => {
      if (!alive || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, { center: [shipLat, shipLon], zoom: 14 });

      const tileLayer = L.tileLayer(getTilemapURL(theme), {
        maxZoom: 19,
      }).addTo(map);
      tileLayerRef.current = tileLayer;

      // Wedge polygon
      wedgeRef.current = L.polygon(
        buildWedge(shipLat, shipLon, heading, offsetMeters, fovDegrees),
        {
          color: "#00d4ff",
          fillColor: "#00d4ff",
          fillOpacity: 0.1,
          weight: 1.5,
          dashArray: "6 4",
        }
      ).addTo(map);

      // Origin handle
      const originIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#00d4ff;border:2px solid #0a0e1a;cursor:grab;box-shadow:0 0 6px #00d4ff88"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        className: "",
      });
      const originMarker = L.marker([shipLat, shipLon], {
        icon: originIcon,
        draggable: true,
        zIndexOffset: 100,
      })
        .addTo(map)
        .bindTooltip("Drag to move origin", { direction: "top", offset: [0, -10] });

      originMarker.on("drag", (e: LeafletEvent) => {
        const { lat, lng } = (e.target as Marker).getLatLng();
        wedgeRef.current?.setLatLngs(buildWedge(lat, lng, heading, offsetMeters, fovDegrees));
        const [rLat, rLon] = destinationPoint(lat, lng, heading, offsetMeters);
        rangeRef.current?.setLatLng([rLat, rLon]);
      });
      originMarker.on("dragend", (e: LeafletEvent) => {
        const { lat, lng } = (e.target as Marker).getLatLng();
        onChange?.({ shipLat: lat, shipLon: lng });
      });
      originRef.current = originMarker;

      // Range / heading handle
      const [newLat, newLon] = destinationPoint(shipLat, shipLon, heading, offsetMeters);
      const rangeIcon = L.divIcon({
        html: `<div style="width:12px;height:12px;background:#facc15;border:2px solid #0a0e1a;cursor:grab;transform:rotate(45deg);box-shadow:0 0 6px #facc1588"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        className: "",
      });
      const rangeMarker = L.marker([newLat, newLon], {
        icon: rangeIcon,
        draggable: true,
        zIndexOffset: 100,
      })
        .addTo(map)
        .bindTooltip("Drag to set heading & range", { direction: "top", offset: [0, -10] });

      rangeMarker.on("drag", (e: LeafletEvent) => {
        const { lat, lng } = (e.target as Marker).getLatLng();
        const o = originRef.current?.getLatLng();
        if (!o) return;
        const h = headingTo(o.lat, o.lng, lat, lng);
        const d = distanceTo(o.lat, o.lng, lat, lng);
        wedgeRef.current?.setLatLngs(buildWedge(o.lat, o.lng, h, d, fovDegrees));
      });
      rangeMarker.on("dragend", (e: LeafletEvent) => {
        const { lat, lng } = (e.target as Marker).getLatLng();
        const o = originRef.current?.getLatLng();
        if (!o) return;
        onChange?.({
          heading: Math.round(headingTo(o.lat, o.lng, lat, lng)),
          offsetMeters: Math.round(distanceTo(o.lat, o.lng, lat, lng)),
        });
      });
      rangeRef.current = rangeMarker;

      mapRef.current = map;
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync layers when props change from the input fields
  useEffect(() => {
    if (!mapRef.current) return;
    wedgeRef.current?.setLatLngs(buildWedge(shipLat, shipLon, heading, offsetMeters, fovDegrees));
    originRef.current?.setLatLng([shipLat, shipLon]);
    const [rLat, rLon] = destinationPoint(shipLat, shipLon, heading, offsetMeters);
    rangeRef.current?.setLatLng([rLat, rLon]);
  }, [shipLat, shipLon, heading, offsetMeters, fovDegrees]);

  // Refresh tile layer when theme changes
  useEffect(() => {
    loadLeaflet().then((L) => {
      if (!mapRef.current) return;
      const newUrl = getTilemapURL(theme);
      if (tileLayerRef.current) {
        tileLayerRef.current.setUrl(newUrl);
        return;
      }

      tileLayerRef.current = L.tileLayer(newUrl, { maxZoom: 19 }).addTo(mapRef.current);
    });
  }, [theme]);

  return (
    <div className="geojson-map-container">
      <div className="geojson-map-header">
        <span className="geojson-map-text">
          {shipLat.toFixed(4)}N . {shipLon.toFixed(4)}E . {heading} . {offsetMeters}m . FOV{" "}
          {fovDegrees}
        </span>
      </div>
      {/* Map container */}
      <div ref={containerRef} style={{ height: "420px", width: "100%" }} />
    </div>
  );
};
