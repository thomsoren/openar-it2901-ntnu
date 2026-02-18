import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Map, Marker, Polygon, LeafletEvent } from "leaflet";
import type * as LeafletType from "leaflet";
import "./AISGeoJsonMap.css";
import { useObcPalette } from "../../hooks/useOBCTheme";
import getTilemapURL from "./AISGeoJsonMapTilemap";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";

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
// param: steps controls how smooth the arc is - more steps means smoother but more processing
function buildWedge(
  lat: number,
  lon: number,
  headingDeg: number,
  rangeMetre: number,
  fovDeg: number,
  steps = 32
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
  const [followMode, setFollowMode] = useState(true);

  const centerMap = useCallback(() => {
    if (!mapRef.current) return;
    mapRef.current.panTo([shipLat, shipLon], {
      animate: true,
      // Travel time from current to new position (in seconds).
      duration: 0.5,
    });
  }, [shipLat, shipLon]);

  const toggleFollowMode = () => {
    if (!followMode) {
      // Snap back to the vessel before enabling follow mode
      centerMap();
    }
    setFollowMode((prev) => !prev);
  };

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

      // Build wedge polygon
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
        html: `<div class="geojson-map-origin-icon"></div>`,
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
        html: `<div class="geojson-map-range-icon"></div>`,
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
        const origin = originRef.current?.getLatLng();
        if (!origin) return;
        wedgeRef.current?.setLatLngs(
          buildWedge(
            origin.lat,
            origin.lng,
            headingTo(origin.lat, origin.lng, lat, lng),
            distanceTo(origin.lat, origin.lng, lat, lng),
            fovDegrees
          )
        );
      });
      rangeMarker.on("dragend", (e: LeafletEvent) => {
        const { lat, lng } = (e.target as Marker).getLatLng();
        const origin = originRef.current?.getLatLng();
        if (!origin) return;
        onChange?.({
          heading: Math.round(headingTo(origin.lat, origin.lng, lat, lng)),
          offsetMeters: Math.round(distanceTo(origin.lat, origin.lng, lat, lng)),
        });
      });
      rangeRef.current = rangeMarker;

      // Detect panning and disable follow mode
      map.on("drag", () => {
        setFollowMode(false);
      });
      mapRef.current = map;
    });

    // Cleanup on unmount
    return () => {
      alive = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
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

    if (followMode) centerMap();
  }, [shipLat, shipLon, heading, offsetMeters, fovDegrees, centerMap]);

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
    </div>
  );
};
