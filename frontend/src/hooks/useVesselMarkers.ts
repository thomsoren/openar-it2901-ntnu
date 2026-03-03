/**
 * Hook to manage AIS vessel markers on a MapLibre map.
 *
 * Handles creating, updating, and removing vessel markers when the
 * vessels data or selected vessel changes.
 */
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { AISData } from "../types/aisData";
import { createVesselMarker, MarkerWithRoot } from "../components/AISGeoJsonMap/mapHelpers";

export function useVesselMarkers(
  map: maplibregl.Map | null,
  vessels: AISData[] | undefined,
  onVesselClick: (vessel: AISData) => void
): void {
  const markersMapRef = useRef<Map<number, MarkerWithRoot>>(new Map());

  useEffect(() => {
    if (!map || !vessels) {
      // Clean up all markers if map or vessels are gone
      markersMapRef.current.forEach(({ marker, root }) => {
        root.unmount();
        marker.remove();
      });
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
      } else {
        // Create new marker
        const markerWithRoot = createVesselMarker(map, vessel, (v) => {
          // Look up the latest vessel data from the map to avoid stale closure
          const latest = markersMapRef.current.get(v.mmsi);
          if (!latest) return;
          // Search for latest vessel data in vessels array
          const latestVessel = vessels.find((vessel) => vessel.mmsi === v.mmsi);
          if (latestVessel) {
            onVesselClick(latestVessel);
            if (latestVessel.longitude && latestVessel.latitude) {
              map.panTo([latestVessel.longitude, latestVessel.latitude], { duration: 500 });
            }
          }
        });
        markersMapRef.current.set(vessel.mmsi, markerWithRoot);
      }
    }

    // Remove markers for vessels that are no longer present
    for (const [mmsi, { marker, root }] of markersMapRef.current.entries()) {
      if (!currentVesselIds.has(mmsi)) {
        root.unmount();
        marker.remove();
        markersMapRef.current.delete(mmsi);
      }
    }
  }, [map, vessels, onVesselClick]);
}
