import { useEffect, useState, useCallback } from "react";
import { DetectedVessel } from "../types/detection";
import { apiFetchPublic } from "../lib/api-client";

const DEFAULT_POLL_INTERVAL = 100; // ms (10 FPS)

interface UseDetectionsOptions {
  /** API endpoint URL */
  url: string;
  /** Polling interval in milliseconds (default: 100ms = 10 FPS) */
  pollInterval?: number;
  /** Whether to start polling immediately (default: true) */
  enabled?: boolean;
}

interface UseDetectionsResult {
  /** Current detected vessels with AIS data */
  vessels: DetectedVessel[];
  /** Loading state for initial fetch */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching real-time boat detections from the API.
 * Polls the backend at a configurable interval.
 *
 * @example
 * ```tsx
 * const { vessels, isLoading, error } = useDetections({
 *   url: "http://localhost:8000/api/detections",
 *   pollInterval: 100, // 10 FPS
 * });
 * ```
 */
export const useDetections = ({
  url,
  pollInterval = DEFAULT_POLL_INTERVAL,
  enabled = true,
}: UseDetectionsOptions): UseDetectionsResult => {
  const [vessels, setVessels] = useState<DetectedVessel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetections = useCallback(async () => {
    try {
      const response = await apiFetchPublic(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch detections: ${response.status}`);
      }

      const data: DetectedVessel[] = await response.json();
      setVessels(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch detections");
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  // Initial fetch and polling
  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Initial fetch
    fetchDetections();

    // Set up polling
    const intervalId = setInterval(fetchDetections, pollInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, fetchDetections, pollInterval]);

  return {
    vessels,
    isLoading,
    error,
    refresh: fetchDetections,
  };
};
