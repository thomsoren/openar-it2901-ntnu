import { useCallback, useState } from "react";
import { apiFetch } from "../lib/api-client";
import { HistoricalMmsiInAreaRequest } from "../types/aisData";

interface UseFetchHistoricalMmsiInAreaResult {
  /** List of MMSIs present in the area during the requested timeframe. */
  mmsis: number[];
  /** Whether the request is in-flight. */
  isLoading: boolean;
  /** Error message if the request failed. */
  error: string | null;
  /** Trigger the request manually with the given parameters. */
  fetchMmsis: (params: HistoricalMmsiInAreaRequest) => Promise<number[]>;
  /** Reset state back to its initial values. */
  reset: () => void;
}

/**
 * Hook for querying the historical MMSI-in-area endpoint.
 *
 * Returns a stable `fetch` callback that POSTs to
 * `POST /api/ais/historical/mmsi_in_area` and resolves with the list of
 * MMSIs that were inside the polygon during the specified timeframe.
 *
 * Constraints forwarded to the Barentswatch API:
 *   - Max timeframe between `msgTimeFrom` and `msgTimeTo`: **7 days**
 *   - Max polygon area: **500 km²**
 *
 * @example
 * ```tsx
 * const { mmsis, isLoading, error, fetchMmsis } = useFetchHistoricalMmsiInArea();
 *
 * const handleQuery = async () => {
 *   await fetchMmsis({
 *     polygon: {
 *       type: "Polygon",
 *       coordinates: [[[10.3, 63.4], [10.4, 63.4], [10.4, 63.5], [10.3, 63.5], [10.3, 63.4]]],
 *     },
 *     msgTimeFrom: "2026-02-17T08:00:00Z",
 *     msgTimeTo:   "2026-02-17T10:00:00Z",
 *     ship_lat: 63.4365,
 *     ship_lon: 10.3835,
 *     heading: 90,
 *   });
 * };
 * ```
 */
export function useFetchHistoricalMmsiInArea(): UseFetchHistoricalMmsiInAreaResult {
  const [mmsis, setMmsis] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMmsis([]);
    setIsLoading(false);
    setError(null);
  }, []);

  const fetchMmsis = useCallback(async (params: HistoricalMmsiInAreaRequest): Promise<number[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/api/ais/historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      const data: number[] = await response.json();
      setMmsis(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { mmsis, isLoading, error, fetchMmsis, reset };
}
