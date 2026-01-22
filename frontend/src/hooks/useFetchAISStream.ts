import { useEffect, useState } from "react";

interface AISData {
  courseOverGround: number;
  latitude: number;
  longitude: number;
  name: string;
  rateOfTurn: number;
  shipType: number;
  speedOverGround: number;
  trueHeading: number;
  navigationalStatus: number;
  mmsi: number;
  msgtime: string;
}

export const useFetchAISStream = (shouldStream: boolean = false, durationSeconds: number = 10) => {
  const [features, setFeatures] = useState<AISData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldStream) return;

    const eventSource = new EventSource("http://localhost:8000/api/ais/stream");
    setIsStreaming(true);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setFeatures((prev) => [data, ...prev].slice(0, 50));
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsStreaming(false);
      setError("Connection lost");
    };

    const timer = setTimeout(() => {
      eventSource.close();
      setIsStreaming(false);
    }, durationSeconds * 1000);

    return () => {
      clearTimeout(timer);
      eventSource.close();
    };
  }, [shouldStream, durationSeconds]);

  return { features, isStreaming, error };
};