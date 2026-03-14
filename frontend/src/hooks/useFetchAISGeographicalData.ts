import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/api-client";
import { AISData } from "../types/aisData";
import { isPointInPolygon, buildScanPolygon } from "../utils/geometryMath";

const isVesselInFov = (vessel: AISData, polygon: [number, number][]): boolean => {
  if (!vessel.latitude || !vessel.longitude) return false;
  return isPointInPolygon(vessel.longitude, vessel.latitude, polygon);
};

/**
 * Hook for streaming raw AIS geographical vessel data filtered by a dynamic FOV polygon.
 * Connects to `/api/ais/stream` and keeps a cached vessel map for fast re-filtering.
 *
 * @param shouldStream - Whether to start/maintain the stream connection
 * @param shipLat - Observer latitude (default: 63.4365 - Trondheim)
 * @param shipLon - Observer longitude (default: 10.3835 - Trondheim)
 * @param heading - Observer heading in degrees (0=North, 90=East)
 * @param offsetMeters - Distance from observer to FOV base in meters
 * @param fovDegrees - Field of view angle in degrees
 *
 * @example
 * ```tsx
 * const { features, isStreaming, error } = useFetchAISGeographicalData(
 *   true,
 *   63.4365,
 *   10.3835,
 *   90,
 *   3000,
 *   120
 * );
 * ```
 */
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

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const runStream = async () => {
      while (!controller.signal.aborted) {
        try {
          setError(null);
          setIsStreaming(true);

          const response = await apiFetch("/api/ais/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              coordinates: polygon,
              ship_lat: shipLat,
              ship_lon: shipLon,
              heading,
            }),
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
          if (!controller.signal.aborted) {
            setIsStreaming(false);
          }
        }

        if (controller.signal.aborted) return;
        await sleep(1500);
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
