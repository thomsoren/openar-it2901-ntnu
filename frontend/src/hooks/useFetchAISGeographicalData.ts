import { useEffect, useState, useRef } from "react";
import { AISData } from "../types/AisData";
// React hook
export const useFetchAISGeographicalData = (
  shouldStream: boolean = false,
  shipLat: number = 63.4365,
  shipLon: number = 10.3835,
  heading: number = 0,
  offsetMeters: number = 1000,
  fovDegrees: number = 60
) => {
  const [features, setFeatures] = useState<AISData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

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

    const url = `http://localhost:8000/api/ais/stream?ship_lat=${shipLat}&ship_lon=${shipLon}&heading=${heading}&offset_meters=${offsetMeters}&fov_degrees=${fovDegrees}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    // Set streaming state after creating EventSource (avoids cascading renders)
    setTimeout(() => setIsStreaming(true), 0);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Raw data received from backend:", JSON.stringify(data).substring(0, 200));
      console.log("Full data:", data);
      setFeatures((prev) => [data, ...prev].slice(0, 50));
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
