import { useEffect, useState, useRef } from "react";
import { AISData } from "../types/aisData";
import { API_CONFIG } from "../config/video";
import { isPointInPolygon, buildFovPolygon, buildRectPolygon } from "../utils/geometryMath";

const isVesselInFov = (vessel: AISData, polygon: [number, number][]): boolean => {
  if (!vessel.latitude || !vessel.longitude) return false;
  return isPointInPolygon(vessel.longitude, vessel.latitude, polygon);
};

function buildScanPolygon(
  shipLat: number,
  shipLon: number,
  heading: number,
  offsetMeters: number,
  fovDegrees: number,
  shapeMode: "wedge" | "rect",
  rectLength: number,
  rectWidth: number
): [number, number][] {
  return shapeMode === "rect"
    ? buildRectPolygon(shipLat, shipLon, heading, rectLength, rectWidth)
    : buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees);
}

export const useFetchAISGeographicalData = (
  shouldStream: boolean = false,
  shipLat: number = 63.4365,
  shipLon: number = 10.3835,
  heading: number = 0,
  offsetMeters: number = 1000,
  fovDegrees: number = 60,
  shapeMode: "wedge" | "rect" = "wedge",
  rectLength: number = 1000,
  rectWidth: number = 600
) => {
  // All received vessels unfiltered
  const vesselCacheRef = useRef<Map<number, AISData>>(new Map());

  const [features, setFeatures] = useState<AISData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Re-filter cached vessels whenever parameters change or vessels are out of bounds
  useEffect(() => {
    const polygon = buildScanPolygon(
      shipLat,
      shipLon,
      heading,
      offsetMeters,
      fovDegrees,
      shapeMode,
      rectLength,
      rectWidth
    );
    const inFov = Array.from(vesselCacheRef.current.values()).filter((vessel) =>
      isVesselInFov(vessel, polygon)
    );
    setFeatures(inFov.slice(0, 50));
  }, [shipLat, shipLon, heading, offsetMeters, fovDegrees, shapeMode, rectLength, rectWidth]);

  useEffect(() => {
    if (!shouldStream) {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      return;
    }

    const polygon = buildScanPolygon(
      shipLat,
      shipLon,
      heading,
      offsetMeters,
      fovDegrees,
      shapeMode,
      rectLength,
      rectWidth
    );

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

              const currentPolygon = buildScanPolygon(
                shipLat,
                shipLon,
                heading,
                offsetMeters,
                fovDegrees,
                shapeMode,
                rectLength,
                rectWidth
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
  }, [
    shouldStream,
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees,
    shapeMode,
    rectLength,
    rectWidth,
  ]);

  return { features, isStreaming, error };
};
