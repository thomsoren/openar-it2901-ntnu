import { apiFetch } from "../lib/api-client";

export interface MediaAsset {
  id: string;
  asset_name: string | null;
  s3_key: string;
  media_type: string;
  visibility: string;
  owner_user_id: string | null;
  group_id: string | null;
  is_system: boolean;
  created_at: string;
}

export interface PresignGetResult {
  url: string;
}

export type MediaVisibility = "private" | "group" | "public";

interface MultipartPartPresign {
  part_number: number;
  url: string;
  headers: Record<string, string>;
}

interface MultipartInitResult {
  key: string;
  upload_id: string;
  part_count: number;
  part_urls: MultipartPartPresign[];
}

const MULTIPART_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const MULTIPART_MAX_CONCURRENCY = 4;

const postStoragePresign = async <T>(
  payload: Record<string, unknown>,
  errorPrefix: string
): Promise<T> => {
  const response = await apiFetch("/api/storage/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${errorPrefix}: ${text}`);
  }

  return (await response.json()) as T;
};

const presignMultipartInit = async (
  filename: string,
  contentType: string,
  visibility: MediaVisibility,
  partCount: number,
  groupId?: string
): Promise<MultipartInitResult> => {
  return postStoragePresign<MultipartInitResult>(
    {
      method: "MULTIPART_INIT",
      filename,
      content_type: contentType,
      visibility,
      part_count: partCount,
      ...(groupId ? { group_id: groupId } : {}),
    },
    "Multipart init failed"
  );
};

const presignMultipartComplete = async (
  key: string,
  uploadId: string,
  completedParts: Array<{ part_number: number; etag: string }>
): Promise<void> => {
  await postStoragePresign(
    {
      method: "MULTIPART_COMPLETE",
      key,
      upload_id: uploadId,
      completed_parts: completedParts,
    },
    "Multipart complete failed"
  );
};

const presignMultipartAbort = async (key: string, uploadId: string): Promise<void> => {
  await postStoragePresign(
    {
      method: "MULTIPART_ABORT",
      key,
      upload_id: uploadId,
    },
    "Multipart abort failed"
  );
};

const uploadPart = (
  url: string,
  headers: Record<string, string>,
  chunk: Blob,
  partNumber: number,
  activeXhrs: Set<XMLHttpRequest>,
  onProgress?: (loadedBytes: number) => void
): Promise<string> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeXhrs.add(xhr);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(event.loaded);
    });

    const cleanup = () => {
      activeXhrs.delete(xhr);
    };

    xhr.addEventListener("load", () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`S3 upload part ${partNumber} failed with status ${xhr.status}`));
        return;
      }
      const etag = xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag");
      if (!etag) {
        reject(new Error(`S3 upload part ${partNumber} missing ETag`));
        return;
      }
      resolve(etag);
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new Error(`Network error during S3 upload part ${partNumber}`));
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new Error("S3 upload aborted"));
    });

    xhr.open("PUT", url);
    for (const [header, value] of Object.entries(headers)) {
      xhr.setRequestHeader(header, value);
    }
    xhr.send(chunk);
  });

export const uploadFileToS3Multipart = async (
  file: File,
  visibility: MediaVisibility,
  onProgress?: (percentage: number) => void,
  onAbortReady?: (abortFn: () => void) => void,
  groupId?: string
): Promise<{ key: string }> => {
  const partCount = Math.max(1, Math.ceil(file.size / MULTIPART_CHUNK_SIZE_BYTES));
  const init = await presignMultipartInit(file.name, file.type, visibility, partCount, groupId);
  const partByNumber = new Map(init.part_urls.map((part) => [part.part_number, part] as const));

  if (!init.upload_id || !init.key || partByNumber.size !== partCount) {
    throw new Error("Multipart init returned an invalid payload");
  }

  const activeXhrs = new Set<XMLHttpRequest>();
  const loadedByPart = new Map<number, number>();
  const completedParts: Array<{ part_number: number; etag: string }> = [];
  let wasAborted = false;

  const emitProgress = () => {
    if (!onProgress) return;
    const loaded = Array.from(loadedByPart.values()).reduce((sum, bytes) => sum + bytes, 0);
    const percent = file.size > 0 ? Math.round((loaded / file.size) * 100) : 100;
    onProgress(Math.max(0, Math.min(99, percent)));
  };

  const abort = () => {
    wasAborted = true;
    for (const xhr of Array.from(activeXhrs)) {
      xhr.abort();
    }
    void presignMultipartAbort(init.key, init.upload_id).catch(() => {
      // Best effort cleanup; upload request already being cancelled.
    });
  };
  onAbortReady?.(abort);

  try {
    let nextPartNumber = 1;

    const worker = async () => {
      while (nextPartNumber <= partCount) {
        const currentPartNumber = nextPartNumber;
        nextPartNumber += 1;

        const part = partByNumber.get(currentPartNumber);
        if (!part) {
          throw new Error(`Missing presigned URL for upload part ${currentPartNumber}`);
        }

        const start = (currentPartNumber - 1) * MULTIPART_CHUNK_SIZE_BYTES;
        const end = Math.min(file.size, start + MULTIPART_CHUNK_SIZE_BYTES);
        const chunk = file.slice(start, end);

        loadedByPart.set(currentPartNumber, 0);
        const etag = await uploadPart(
          part.url,
          part.headers,
          chunk,
          currentPartNumber,
          activeXhrs,
          (loadedBytes) => {
            loadedByPart.set(currentPartNumber, loadedBytes);
            emitProgress();
          }
        );

        loadedByPart.set(currentPartNumber, chunk.size);
        emitProgress();
        completedParts.push({ part_number: currentPartNumber, etag });
      }
    };

    const concurrency = Math.min(MULTIPART_MAX_CONCURRENCY, partCount);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (wasAborted) {
      throw new Error("S3 upload aborted");
    }

    completedParts.sort((a, b) => a.part_number - b.part_number);
    await presignMultipartComplete(init.key, init.upload_id, completedParts);
    onProgress?.(100);
    return { key: init.key };
  } catch (error) {
    if (!wasAborted) {
      await presignMultipartAbort(init.key, init.upload_id).catch(() => {
        // Best effort cleanup when uploads fail.
      });
    }
    throw error;
  } finally {
    onAbortReady?.(() => {});
  }
};

export const listMediaAssets = async (): Promise<MediaAsset[]> => {
  const response = await apiFetch("/api/admin/media");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list media assets: ${text}`);
  }
  return response.json() as Promise<MediaAsset[]>;
};

export const deleteMediaAsset = async (id: string): Promise<void> => {
  const response = await apiFetch(`/api/admin/media/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`Delete failed: ${text}`);
  }
};

export const updateVisibility = async (
  id: string,
  visibility: MediaVisibility
): Promise<MediaAsset> => {
  const response = await apiFetch(`/api/admin/media/${encodeURIComponent(id)}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Update visibility failed: ${text}`);
  }
  return response.json() as Promise<MediaAsset>;
};

export const presignDownload = async (key: string): Promise<PresignGetResult> => {
  const response = await apiFetch("/api/storage/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "GET", key }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Presign GET failed: ${text}`);
  }
  return response.json() as Promise<PresignGetResult>;
};
