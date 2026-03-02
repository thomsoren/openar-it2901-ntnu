import { apiFetch, getApiAccessToken, getApiBaseUrl } from "../lib/api-client";
import { explainFetchError, readJsonSafely } from "../utils/api-helpers";
import type { StreamSummary } from "../types/stream";

interface StreamListPayload {
  detail?: string;
  streams?: StreamSummary[];
}

interface ApiDetailPayload {
  detail?: string;
}

const parseStreamList = async (response: Response): Promise<StreamSummary[]> => {
  const payload = (await readJsonSafely(response)) as StreamListPayload;
  if (!response.ok) {
    throw new Error(payload.detail || "Failed to load streams");
  }
  return Array.isArray(payload.streams) ? payload.streams : [];
};

const parseDetailError = async (response: Response, fallback: string) => {
  try {
    const payload = (await readJsonSafely(response)) as ApiDetailPayload;
    return payload.detail || fallback;
  } catch {
    return fallback;
  }
};

export const listStreams = async (): Promise<StreamSummary[]> => {
  const response = await apiFetch("/api/streams");
  return parseStreamList(response);
};

export const startStream = async (
  streamId: string,
  options: { sourceUrl?: string; loop?: boolean; allowExisting?: boolean } = {}
): Promise<void> => {
  const allowExisting = options.allowExisting ?? true;
  const response = await apiFetch(`/api/streams/${encodeURIComponent(streamId)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      loop: options.loop ?? true,
      ...(options.sourceUrl ? { source_url: options.sourceUrl } : {}),
    }),
  });

  if (!response.ok) {
    if (allowExisting && response.status === 409) {
      return;
    }
    const message = await parseDetailError(response, "Failed to start stream");
    throw new Error(message);
  }
};

export const stopStream = async (streamId: string): Promise<void> => {
  const response = await apiFetch(`/api/streams/${encodeURIComponent(streamId)}`, {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    const message = await parseDetailError(response, "Failed to stop stream");
    throw new Error(message);
  }
};

export const ensureDefaultStreamRunning = async (): Promise<StreamSummary[]> => {
  const initial = await listStreams();
  const hasDefault = initial.some((stream) => stream.stream_id === "default");
  if (hasDefault) {
    return initial;
  }

  await startStream("default", { loop: true });
  return listStreams();
};

export const sendStreamHeartbeat = async (streamId: string): Promise<void> => {
  await apiFetch(`/api/streams/${encodeURIComponent(streamId)}/heartbeat`, {
    method: "POST",
  });
};

export const uploadStreamSource = async (
  streamId: string,
  file: File,
  onProgress?: (percentage: number) => void,
  onRequestCreated?: (request: XMLHttpRequest) => void
): Promise<void> => {
  const formData = new FormData();
  formData.append("file", file);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequestCreated?.(xhr);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }
      onProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText) as ApiDetailPayload;
        reject(new Error(payload.detail || `Upload failed with status ${xhr.status}`));
      } catch {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.open("POST", `${getApiBaseUrl()}/api/streams/${encodeURIComponent(streamId)}/upload`);
    const token = getApiAccessToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.send(formData);
  });
};

export const startStreamFromKey = async (
  streamId: string,
  s3Key: string,
  loop: boolean = true
): Promise<void> => {
  await startStream(streamId, { sourceUrl: `s3://${s3Key}`, loop });
};

export const toStreamError = (err: unknown, fallback: string): string => {
  return explainFetchError(err, fallback);
};
