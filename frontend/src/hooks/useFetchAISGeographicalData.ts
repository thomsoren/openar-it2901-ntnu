import { useEffect, useState, useRef } from "react";
import { AISData } from "../types/aisData";
import { isPointInPolygon, buildFovPolygon } from "../utils/geometryMath";

const isVesselInFov = (vessel: AISData, polygon: [number, number][]): boolean => {
  if (!vessel.latitude || !vessel.longitude) return false;
  return isPointInPolygon(vessel.longitude, vessel.latitude, polygon);
};

export const useFetchAISGeographicalData = (
  shouldStream: boolean = false,
  shipLat: number = 63.4365,
  shipLon: number = 10.3835,
  heading: number = 0,
  offsetMeters: number = 1000,
  fovDegrees: number = 60
) => {
  // All received vessels, unfiltered (source of truth for re-filtering)
  const vesselCacheRef = useRef<Map<number, AISData>>(new Map());

  const [features, setFeatures] = useState<AISData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Re-filter cached vessels whenever FOV parameters change
  useEffect(() => {
    const polygon = buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees);
    const inFov = Array.from(vesselCacheRef.current.values()).filter((vessel) =>
      isVesselInFov(vessel, polygon)
    );
    setFeatures(inFov.slice(0, 50));
  }, [shipLat, shipLon, heading, offsetMeters, fovDegrees]);

  useEffect(() => {
    if (!shouldStream) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      // Defer state update to avoid cascading renders
      setTimeout(() => setIsStreaming(false), 0);
      return;
    }

    // Clear error state when starting a new stream (deferred to avoid cascading renders)
    setTimeout(() => setError(null), 0);

    const url = `http://localhost:8000/api/ais/stream?ship_lat=${shipLat}&ship_lon=${shipLon}&heading=${heading}&offset_meters=${offsetMeters}&fov_degrees=${fovDegrees}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    // Set streaming state after creating EventSource (avoids cascading renders)
    setTimeout(() => setIsStreaming(true), 0);

    eventSource.onmessage = (event) => {
      const data: AISData = JSON.parse(event.data);
      if (!data.latitude || !data.longitude || !data.mmsi) return;

      // Update the cache with the latest position for this vessel
      vesselCacheRef.current.set(data.mmsi, data);

      // Re-filter the full cache against current FOV
      const polygon = buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees);
      const inFov = Array.from(vesselCacheRef.current.values()).filter((vessel) =>
        isVesselInFov(vessel, polygon)
      );
      setFeatures(inFov.slice(0, 50));
    };

    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;
      setTimeout(() => setIsStreaming(false), 0);
      setError("Connection lost");
    };

    return () => {
      if (eventSource) {
        eventSource.close();
        eventSourceRef.current = null;
      }
      setTimeout(() => setIsStreaming(false), 0);
    };
  }, [shouldStream, shipLat, shipLon, heading, offsetMeters, fovDegrees]);

  return { features, isStreaming, error };
};
