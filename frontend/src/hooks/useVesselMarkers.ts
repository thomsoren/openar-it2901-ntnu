/**
 * Hook to manage AIS vessel markers on a MapLibre map.
 *
 * Handles creating, updating, and removing vessel markers when the
 * vessels data or selected vessel changes.
 */
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { AISData } from "../types/aisData";
import type { VesselIconSet } from "../utils/vesselIconMapper";
import {
  createVesselMarker,
  getVesselMarkerRotation,
  updateVesselMarkerIcon,
} from "../components/AISGeoJsonMap/mapHelpers";

type VesselEntry = { marker: maplibregl.Marker; vessel: AISData };

export function useVesselMarkers(
  map: maplibregl.Map | null,
  vessels: AISData[] | undefined,
  onVesselClick: (vessel: AISData) => void,
  iconSet: VesselIconSet = "generic",
  selectedMmsis?: readonly number[]
): void {
  const markersMapRef = useRef<Map<number, VesselEntry>>(new Map());
  const lastIconSetRef = useRef<VesselIconSet>(iconSet);
  const lastSelectedMmsiSetRef = useRef<Set<number>>(new Set());
  const lastSelectedIconSetRef = useRef<VesselIconSet>(iconSet);

  useEffect(() => {
    if (!map || !vessels) {
      // Clean up all markers if map or vessels are gone
      markersMapRef.current.forEach(({ marker }) => {
        marker.remove();
      });
      markersMapRef.current.clear();
      return;
    }

    if (lastIconSetRef.current !== iconSet) {
      markersMapRef.current.forEach(({ marker }) => {
        marker.remove();
      });
      markersMapRef.current.clear();
      lastIconSetRef.current = iconSet;
    }

    const currentVesselIds = new Set<number>();

    // Update or create markers for current vessels
    for (const vessel of vessels) {
      if (!vessel.latitude || !vessel.longitude) continue;

      currentVesselIds.add(vessel.mmsi);
      const existing = markersMapRef.current.get(vessel.mmsi);

      if (existing) {
        // Update existing marker position, rotation, and stored vessel data
        existing.vessel = vessel;
        existing.marker.setLngLat([vessel.longitude, vessel.latitude]);
        existing.marker.setRotation(getVesselMarkerRotation(vessel));
      } else {
        // Create new marker
        const marker = createVesselMarker(
          map,
          vessel,
          (v) => {
            // Search for latest vessel data in vessels array
            const latestVessel = vessels.find((vessel) => vessel.mmsi === v.mmsi);
            if (latestVessel) {
              onVesselClick(latestVessel);
              if (latestVessel.longitude && latestVessel.latitude) {
                map.panTo([latestVessel.longitude, latestVessel.latitude], { duration: 500 });
              }
            }
          },
          iconSet
        );
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
  }, [map, vessels, iconSet, onVesselClick]);

  // Update marker icons when selected set changes
  useEffect(() => {
    const prevSet = lastSelectedMmsiSetRef.current;
    const nextSet = new Set(selectedMmsis ?? []);
    const didIconSetChange = lastSelectedIconSetRef.current !== iconSet;

    // Revert deselected markers
    for (const mmsi of prevSet) {
      if (!nextSet.has(mmsi)) {
        const entry = markersMapRef.current.get(mmsi);
        if (entry) {
          updateVesselMarkerIcon(entry.marker.getElement(), entry.vessel, false, iconSet);
        }
      }
    }

    // Apply selected icon to newly selected markers
    for (const mmsi of nextSet) {
      if (didIconSetChange || !prevSet.has(mmsi)) {
        const entry = markersMapRef.current.get(mmsi);
        if (entry) {
          updateVesselMarkerIcon(entry.marker.getElement(), entry.vessel, true, iconSet);
        }
      }
    }

    lastSelectedMmsiSetRef.current = nextSet;
    lastSelectedIconSetRef.current = iconSet;
  }, [selectedMmsis, iconSet]);
}
