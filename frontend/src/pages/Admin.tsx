import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import {
  type MediaAsset,
  deleteMediaAsset,
  listMediaAssets,
  presignDownload,
  presignUpload,
  updateVisibility,
  uploadFileToS3,
} from "../services/media";
import "./Admin.css";

type UploadStatus = "idle" | "uploading" | "done" | "error";

export default function Admin() {
  const { session, isSessionPending, authBridgeStatus, authBridgeError, retryAuthBridge, isAdmin } =
    useAuth();

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<"private" | "group" | "public">("private");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

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
      const { url, headers } = await presignUpload(
        selectedFile.name,
        selectedFile.type,
        visibility
      );
      await uploadFileToS3(url, headers, selectedFile, setUploadProgress, (xhr) => {
        xhrRef.current = xhr;
      });
      xhrRef.current = null;
      setUploadProgress(100);
      setUploadStatus("done");
      setSelectedFile(null);
      await loadAssets();
    } catch (err) {
      xhrRef.current = null;
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    if (!window.confirm(`Delete "${asset.s3_key}"?`)) return;
    try {
      await deleteMediaAsset(asset.id);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleVisibilityChange = async (
    asset: MediaAsset,
    newVisibility: "private" | "group" | "public"
  ) => {
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

      {/* Upload section */}
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
              onChange={(e) => setVisibility(e.target.value as "private" | "group" | "public")}
            >
              <option value="private">Private</option>
              <option value="group">Group</option>
              {isAdmin && <option value="public">Public</option>}
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

      {/* Media library table */}
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
                          void handleVisibilityChange(
                            asset,
                            e.target.value as "private" | "group" | "public"
                          )
                        }
                      >
                        <option value="private">Private</option>
                        <option value="group">Group</option>
                        {isAdmin && <option value="public">Public</option>}
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
