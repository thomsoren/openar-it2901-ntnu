export const readApiError = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail || fallback;
  } catch {
    return fallback;
  }
};

export const readJsonSafely = async (response: Response): Promise<Record<string, unknown>> => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Backend returned non-JSON response. Check API URL/proxy config.");
  }
  return response.json();
};

export const explainFetchError = (err: unknown, fallback: string): string => {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return "Failed to fetch. Verify backend URL, network reachability, and CORS origin allowlist.";
  }
  return err instanceof Error ? err.message : fallback;
};
