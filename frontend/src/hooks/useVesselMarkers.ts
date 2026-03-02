/**
 * Hook to manage AIS vessel markers on a MapLibre map.
 *
 * Handles creating, updating, and removing vessel markers when the
 * vessels data or selected vessel changes.
 */
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { AISData } from "../types/aisData";
import { createVesselMarker } from "../components/AISGeoJsonMap/mapHelpers";

export function useVesselMarkers(
  map: maplibregl.Map | null,
  vessels: AISData[] | undefined,
  onVesselClick: (vessel: AISData) => void
): void {
  const markersMapRef = useRef<Map<number, { marker: maplibregl.Marker; vessel: AISData }>>(
    new Map()
  );

  useEffect(() => {
    if (!map || !vessels) {
      // Clean up all markers if map or vessels are gone
      markersMapRef.current.forEach(({ marker }) => marker.remove());
      markersMapRef.current.clear();
      return;
    }

    const currentVesselIds = new Set<number>();

    // Update or create markers for current vessels
    for (const vessel of vessels) {
      if (!vessel.latitude || !vessel.longitude) continue;

      currentVesselIds.add(vessel.mmsi);
      const existing = markersMapRef.current.get(vessel.mmsi);

      if (existing) {
        // Update existing marker position and rotation
        existing.marker.setLngLat([vessel.longitude, vessel.latitude]);
        existing.marker.setRotation(vessel.courseOverGround || 0);
        existing.vessel = vessel; // Update vessel data reference
      } else {
        // Create new marker
        const marker = createVesselMarker(map, vessel, (vessel) => {
          onVesselClick(vessel);
          map.panTo([vessel.longitude!, vessel.latitude!], { duration: 500 });
        });
        markersMapRef.current.set(vessel.mmsi, { marker, vessel });
      }
    }

    // Remove markers for vessels that are no longer present
    for (const [mmsi, { marker }] of markersMapRef.current.entries()) {
      if (!currentVesselIds.has(mmsi)) {
        marker.remove();
        markersMapRef.current.delete(mmsi);
      }
    }
  }, [map, vessels, onVesselClick]);
}
