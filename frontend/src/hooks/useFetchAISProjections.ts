import { useEffect, useState, useRef } from "react";
import { ProjectedCoordinate } from "../types/projection";

export const useFetchAISProjections = (
  shouldStream: boolean = false,
  shipLat: number = 63.4365,
  shipLon: number = 10.3835,
  heading: number = 90,
  offsetMeters: number = 3000,
  fovDegrees: number = 120,
) => {
  const [projections, setProjections] = useState<ProjectedCoordinate[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

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

    const url = `http://localhost:8000/api/ais/projections?ship_lat=${shipLat}&ship_lon=${shipLon}&heading=${heading}&offset_meters=${offsetMeters}&fov_degrees=${fovDegrees}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    setTimeout(() => setIsStreaming(true), 0);

    eventSource.onmessage = (event) => {
      const feature = JSON.parse(event.data);
      const projection = feature.projection;
      console.log("Received projection:", projection);
      const props = feature.properties || {};

      if (projection && projection.x_px !== undefined && projection.y_px !== undefined) {
        const projected: ProjectedCoordinate = {
          mmsi: props.mmsi || 0,
          name: props.name || props.shipname,
          pixel_x: projection.x_px,
          pixel_y: projection.y_px,
          distance_m: projection.distance_m,
          bearing_deg: projection.bearing_deg,
          relative_bearing_deg: projection.rel_bearing_deg,
          in_fov: true,
          timestamp: new Date().toISOString(),
        };
        setProjections((prev) => [projected, ...prev].slice(0, 50));
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
  };
};
