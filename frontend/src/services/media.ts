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

export interface PresignPutResult {
  url: string;
  headers: Record<string, string>;
  key: string;
}

export interface PresignGetResult {
  url: string;
}

export const presignUpload = async (
  filename: string,
  contentType: string,
  visibility: "private" | "group" | "public",
  groupId?: string
): Promise<PresignPutResult> => {
  const response = await apiFetch("/api/storage/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "PUT",
      filename,
      content_type: contentType,
      visibility,
      ...(groupId ? { group_id: groupId } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Presign failed: ${text}`);
  }

  const payload = (await response.json()) as PresignPutResult;
  return payload;
};

export const uploadFileToS3 = (
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (percentage: number) => void,
  onRequestCreated?: (xhr: XMLHttpRequest) => void
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequestCreated?.(xhr);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during S3 upload")));
    xhr.addEventListener("abort", () => reject(new Error("S3 upload aborted")));

    xhr.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.send(file);
  });
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
  visibility: "private" | "group" | "public"
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
