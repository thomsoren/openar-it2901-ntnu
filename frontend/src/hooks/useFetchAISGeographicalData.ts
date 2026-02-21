import { useEffect, useState, useRef } from "react";
import { AISData } from "../types/aisData";
import { API_CONFIG } from "../config/video";
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
  // All received vessels unfiltered
  const vesselCacheRef = useRef<Map<number, AISData>>(new Map());

  const [features, setFeatures] = useState<AISData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Re-filter cached vessels whenever parameters change or vessels are out of bounds
  useEffect(() => {
    const polygon = buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees);
    const inFov = Array.from(vesselCacheRef.current.values()).filter((vessel) =>
      isVesselInFov(vessel, polygon)
    );
    setFeatures(inFov.slice(0, 50));
  }, [shipLat, shipLon, heading, offsetMeters, fovDegrees]);

  useEffect(() => {
    if (!shouldStream) {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      return;
    }

    const polygon = buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees);

    setError(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const runStream = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/api/ais/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: polygon }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data: AISData = JSON.parse(line.slice(6));
              if (!data.latitude || !data.longitude || !data.mmsi) continue;

              vesselCacheRef.current.set(data.mmsi, data);

              const currentPolygon = buildFovPolygon(
                shipLat,
                shipLon,
                heading,
                offsetMeters,
                fovDegrees
              );
              const inFov = Array.from(vesselCacheRef.current.values()).filter((vessel) =>
                isVesselInFov(vessel, currentPolygon)
              );
              setFeatures(inFov.slice(0, 50));
            } catch {
              // Ignore JSON parse errors or invalid data entries
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError("Connection lost");
      } finally {
        // Only clear streaming state if the stream ended naturally or errored out.
        if (!controller.signal.aborted) {
          setIsStreaming(false);
        }
      }
    };

    runStream();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [shouldStream, shipLat, shipLon, heading, offsetMeters, fovDegrees]);

  return { features, isStreaming, error };
};
