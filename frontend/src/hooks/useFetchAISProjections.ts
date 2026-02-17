import { useEffect, useState, useRef } from "react";
import { ProjectedCoordinate } from "../types/projection";

interface UseFetchAISProjectionsResult {
  /** Array of vessels projected to camera coordinates */
  projections: ProjectedCoordinate[];
  /** Whether the SSE stream is currently active */
  isStreaming: boolean;
  /** Error message if stream failed */
  error: string | null;
}

/**
 * Hook for streaming AIS vessel projections with manual position parameters.
 * Connects to /api/ais/projections endpoint and streams vessel positions
 * enriched with pixel coordinate projections based on observer position.
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
 * const { projections, isStreaming, error } = useFetchAISProjections(
 *   true,
 *   63.4365,
 *   10.3835,
 *   90,
 *   3000,
 *   120
 * );
 * ```
 */
export const useFetchAISProjections = (
  shouldStream: boolean = false,
  shipLat: number = 63.4365,
  shipLon: number = 10.3835,
  heading: number = 90,
  offsetMeters: number = 3000,
  fovDegrees: number = 120
): UseFetchAISProjectionsResult => {
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

    setTimeout(() => setError(null), 0);
    projectionsMapRef.current.clear();

    const url = `http://localhost:8000/api/ais/projections?ship_lat=${shipLat}&ship_lon=${shipLon}&heading=${heading}&offset_meters=${offsetMeters}&fov_degrees=${fovDegrees}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    setTimeout(() => setIsStreaming(true), 0);

    eventSource.onmessage = (event) => {
      const feature = JSON.parse(event.data);
      const projection = feature.projection;
      console.log("Received projection:", projection);
      console.log(
        "Feature MMSI field:",
        feature.mmsi,
        "Properties MMSI:",
        feature.properties?.mmsi
      );

      if (projection && projection.x_px !== undefined && projection.y_px !== undefined) {
        // Extract MMSI from different possible locations in the feature object
        const mmsi = feature.mmsi || feature.properties?.mmsi || 0;
        const name =
          feature.name ||
          feature.properties?.name ||
          feature.properties?.shipname ||
          `MMSI ${mmsi}`;

        console.log("Using MMSI:", mmsi, "Name:", name);

        const projected: ProjectedCoordinate = {
          mmsi: mmsi,
          name: name,
          pixel_x: projection.x_px,
          pixel_y: projection.y_px,
          distance_m: projection.distance_m,
          bearing_deg: projection.bearing_deg,
          relative_bearing_deg: projection.rel_bearing_deg,
          in_fov: true,
          timestamp: new Date().toISOString(),
        };

        // Update or add vessel in the map
        projectionsMapRef.current.set(mmsi, projected);

        // Convert map to array for state, keeping only latest 50
        const updatedProjections = Array.from(projectionsMapRef.current.values()).slice(0, 50);
        setProjections(updatedProjections);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;
      setTimeout(() => setIsStreaming(false), 0);
      setError("Connection lost");
    };

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [shouldStream, shipLat, shipLon, heading, offsetMeters, fovDegrees]);

  return {
    projections,
    isStreaming,
    error,
  } as UseFetchAISProjectionsResult;
};
