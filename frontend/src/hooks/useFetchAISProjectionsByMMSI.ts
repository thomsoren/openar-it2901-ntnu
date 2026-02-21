import { useEffect, useRef, useState } from "react";
import { ProjectedCoordinate } from "../types/projection";
import { API_CONFIG } from "../config/video";

interface UseFetchAISProjectionsByMMSIResult {
  /** Array of vessels projected to camera coordinates */
  projections: ProjectedCoordinate[];
  /** Whether the SSE stream is currently active */
  isStreaming: boolean;
  /** Error message if stream failed */
  error: string | null;
}

/**
 * Hook for streaming AIS vessel projections by vessel MMSI.
 * Looks up vessel position by MMSI and streams nearby vessels
 * enriched with pixel coordinate projections.
 *
 * @param shouldStream - Whether to start/maintain the stream connection
 * @param mmsi - Maritime Mobile Service Identity (vessel ID)
 * @param offsetMeters - Distance from vessel to FOV base in meters
 * @param fovDegrees - Field of view angle in degrees
 *
 * @example
 * ```tsx
 * const { projections, isStreaming, error } = useFetchAISProjectionsByMMSI(
 *   true,
 *   "257347700", // LISE
 *   3000,
 *   120
 * );
 * ```
 */
export function useFetchAISProjectionsByMMSI(
  shouldStream: boolean,
  mmsi: string,
  offsetMeters: number,
  fovDegrees: number
): UseFetchAISProjectionsByMMSIResult {
  const [projections, setProjections] = useState<ProjectedCoordinate[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const projectionsMapRef = useRef<Map<number, ProjectedCoordinate>>(new Map());

  useEffect(() => {
    if (!shouldStream) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setTimeout(() => setIsStreaming(false), 0);
      return;
    }

    if (!mmsi || mmsi.trim() === "") {
      setTimeout(() => setError("MMSI is required"), 0);
      return;
    }

    setTimeout(() => setError(null), 0);
    setTimeout(() => setIsStreaming(true), 0);

    const params = new URLSearchParams({
      mmsi: mmsi.trim(),
      offset_meters: offsetMeters.toString(),
      fov_degrees: fovDegrees.toString(),
    });

    const url = `${API_CONFIG.BASE_URL}/api/ais/projections/mmsi?${params.toString()}`;

    try {
      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            setError(data.error);
            eventSource.close();
            return;
          }

          // Extract MMSI with fallback chain
          const mmsiValue =
            data.mmsi || data.properties?.mmsi || parseInt(data.id?.split(":").at(-1) || "0");

          // Create projection object matching ProjectedCoordinate interface
          const projected: ProjectedCoordinate = {
            mmsi: mmsiValue || 0,
            name: data.name || "",
            pixel_x: data.projection?.x_px || 0,
            pixel_y: data.projection?.y_px || 0,
            distance_m: data.projection?.distance_m || 0,
            bearing_deg: data.projection?.bearing_deg || 0,
            relative_bearing_deg: data.projection?.rel_bearing_deg || 0,
            in_fov: true,
            timestamp: data.timestamp || new Date().toISOString(),
          };

          // Use Map to maintain one entry per MMSI
          projectionsMapRef.current.set(mmsiValue || 0, projected);

          // Update state with latest projections (limit to 50 for performance)
          const updatedProjections = Array.from(projectionsMapRef.current.values()).slice(0, 50);
          setProjections(updatedProjections);
        } catch (err) {
          console.error("Error parsing AIS projection data:", err, event.data);
          setError(`Parse error: ${err}`);
        }
      };

      eventSource.onerror = () => {
        setError("Stream connection error");
        eventSource.close();
        setIsStreaming(false);
      };

      eventSourceRef.current = eventSource;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setTimeout(() => setError(errorMessage), 0);
      setTimeout(() => setIsStreaming(false), 0);
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsStreaming(false);
    };
  }, [shouldStream, mmsi, offsetMeters, fovDegrees]);

  return { projections, isStreaming, error } as UseFetchAISProjectionsByMMSIResult;
}
