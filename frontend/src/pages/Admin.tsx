import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import {
  type MediaAsset,
  type MediaVisibility,
  deleteMediaAsset,
  listMediaAssets,
  presignDownload,
  updateVisibility,
  uploadFileToS3Multipart,
} from "../services/media";
import { listStreams, stopStream } from "../services/streams";
import { removePersistedStreamIds } from "../hooks/stream-tabs/storage";
import "./Admin.css";

type UploadStatus = "idle" | "uploading" | "done" | "error";
const VISIBILITY_OPTION_LABELS: Record<MediaVisibility, string> = {
  private: "Private",
  group: "Group",
  public: "Public",
};

export default function Admin() {
  const { session, isSessionPending, authBridgeStatus, authBridgeError, retryAuthBridge, isAdmin } =
    useAuth();
  const storageScope = session?.user?.id ?? "anon";

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<MediaVisibility>("private");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const visibilityOptions: MediaVisibility[] = isAdmin
    ? ["private", "group", "public"]
    : ["private", "group"];

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortUploadRef = useRef<(() => void) | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    return () => {
      abortUploadRef.current?.();
    };
  }, []);

  const loadAssets = useCallback(async () => {
    try {
      const data = await listMediaAssets();
      setAssets(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load assets");
    }
  }, []);

  useEffect(() => {
    if (!session || authBridgeStatus !== "ready") return;
    const timeoutId = window.setTimeout(() => {
      void loadAssets();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [session, authBridgeStatus, loadAssets]);

  if (isSessionPending || authBridgeStatus === "loading") {
    return (
      <div className="admin-page">
        <p className="admin-empty">Loading media library…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="admin-page">
        <p className="admin-empty">Sign in to view your media library.</p>
      </div>
    );
  }

  if (authBridgeStatus === "error") {
    return (
      <div className="admin-page">
        <div className="admin-error">{authBridgeError || "Authentication bridge failed."}</div>
        <button className="admin-button admin-button--small" onClick={retryAuthBridge}>
          Retry
        </button>
      </div>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) setSelectedFile(file);
    if (e.target) e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file && file.type.startsWith("video/")) setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadError(null);

    try {
      await uploadFileToS3Multipart(selectedFile, visibility, setUploadProgress, (abortFn) => {
        abortUploadRef.current = abortFn;
      });
      abortUploadRef.current = null;
      setUploadProgress(100);
      setUploadStatus("done");
      setSelectedFile(null);
      await loadAssets();
    } catch (err) {
      abortUploadRef.current = null;
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const streamSourceUsesAssetKey = (sourceUrl: string, assetKey: string): boolean => {
    const normalizedKey = assetKey.replace(/^\/+/, "");
    if (!normalizedKey) return false;
    if (sourceUrl.startsWith(`s3://${normalizedKey}`)) return true;
    try {
      const parsed = new URL(sourceUrl);
      const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
      return path.endsWith(normalizedKey) || path.includes(`/${normalizedKey}`);
    } catch {
      return sourceUrl.includes(normalizedKey);
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    if (!window.confirm(`Delete "${asset.s3_key}"?`)) return;
    try {
      const streams = await listStreams().catch(() => []);
      await deleteMediaAsset(asset.id);
      const affectedStreamIds = streams
        .filter((stream) => streamSourceUsesAssetKey(stream.source_url, asset.s3_key))
        .map((stream) => stream.stream_id);
      if (affectedStreamIds.length > 0) {
        await Promise.all(
          affectedStreamIds.map(async (streamId) => {
            try {
              await stopStream(streamId);
            } catch {
              // Ignore stop failures during cleanup.
            }
          })
        );
        removePersistedStreamIds(affectedStreamIds, storageScope);
      }
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleVisibilityChange = async (asset: MediaAsset, newVisibility: MediaVisibility) => {
    try {
      const updated = await updateVisibility(asset.id, newVisibility);
      setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update visibility");
    }
  };

  const handleView = async (asset: MediaAsset) => {
    try {
      const { url } = await presignDownload(asset.s3_key);
      window.open(url, "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to generate view URL");
    }
  };

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">Media Library</h1>
      <section className="admin-section">
        <h2 className="admin-section__title">Upload Media</h2>

        <div
          className={`admin-dropzone${isDragActive ? " admin-dropzone--active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {selectedFile ? (
            <span className="admin-dropzone__filename">{selectedFile.name}</span>
          ) : (
            <span>Drag &amp; drop a video file here, or click to browse</span>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        <div className="admin-upload-controls">
          <label className="admin-label">
            Visibility:&nbsp;
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as MediaVisibility)}
            >
              {visibilityOptions.map((option) => (
                <option key={option} value={option}>
                  {VISIBILITY_OPTION_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <button
            className="admin-button admin-button--primary"
            disabled={!selectedFile || uploadStatus === "uploading"}
            onClick={() => void handleUpload()}
          >
            Upload
          </button>

          {uploadStatus === "uploading" && (
            <span className="admin-upload-progress">Uploading… {uploadProgress}%</span>
          )}
          {uploadStatus === "done" && (
            <span className="admin-upload-success">Upload complete!</span>
          )}
          {uploadError && <span className="admin-upload-error">{uploadError}</span>}
        </div>
      </section>
      <section className="admin-section">
        <h2 className="admin-section__title">
          Media Assets
          <button className="admin-button admin-button--small" onClick={() => void loadAssets()}>
            Refresh
          </button>
        </h2>

        {loadError && <div className="admin-error">{loadError}</div>}

        {assets.length === 0 && !loadError ? (
          <p className="admin-empty">No media assets found.</p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Key / Filename</th>
                  <th>Type</th>
                  <th>Visibility</th>
                  <th>Owner</th>
                  <th>Uploaded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id} className={asset.is_system ? "admin-table__row--system" : ""}>
                    <td className="admin-table__key" title={asset.s3_key}>
                      {asset.s3_key.split("/").pop() || asset.s3_key}
                    </td>
                    <td>{asset.media_type}</td>
                    <td>
                      <select
                        value={asset.visibility}
                        onChange={(e) =>
                          void handleVisibilityChange(asset, e.target.value as MediaVisibility)
                        }
                      >
                        {visibilityOptions.map((option) => (
                          <option key={option} value={option}>
                            {VISIBILITY_OPTION_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{asset.owner_user_id ?? "—"}</td>
                    <td>{new Date(asset.created_at).toLocaleDateString()}</td>
                    <td className="admin-table__actions">
                      <button
                        className="admin-button admin-button--small"
                        onClick={() => void handleView(asset)}
                      >
                        View
                      </button>
                      <button
                        className="admin-button admin-button--small admin-button--danger"
                        onClick={() => void handleDelete(asset)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
