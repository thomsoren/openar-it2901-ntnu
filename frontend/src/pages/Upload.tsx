import { useEffect, useRef, useState } from "react";
import { ObcAlertFrame } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-frame/alert-frame";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/card/card";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import { ObcProgressBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-bar/progress-bar";
import { ObcProgressButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-button/progress-button";
import {
  ObcAlertFrameStatus,
  ObcAlertFrameType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-frame/alert-frame";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { ObcElevatedCardSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/elevated-card/elevated-card";
import {
  ProgressBarMode,
  ProgressBarType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-bar/progress-bar";
import {
  ButtonStyle,
  ProgressButtonType,
  ProgressMode,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-button/progress-button";
import AccessDenied from "../components/auth/AccessDenied";
import { apiFetch } from "../lib/api-client";
import type { BackendUser } from "../types/auth";
import "./Upload.css";

type UploadStatus = "idle" | "uploading" | "success" | "error";

type UploadProps = {
  currentUser: BackendUser;
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) {
    return "0 bytes";
  }

  const units = ["bytes", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
};

const readErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail || fallback;
  } catch {
    return fallback;
  }
};

export default function Upload({ currentUser }: UploadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const uploading = uploadStatus === "uploading";

  const canUpload = currentUser.is_admin;

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const resetUploadState = () => {
    setUploadStatus("idle");
    setUploadProgress(0);
    setUploadMessage(null);
  };

  const clearSelectedFile = () => {
    setFile(null);
    resetUploadState();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePickFile = () => {
    if (uploading) {
      return;
    }
    fileInputRef.current?.click();
  };

  const setSelectedFile = (selectedFile: File | null) => {
    resetUploadState();

    if (!selectedFile) {
      setFile(null);
      return;
    }

    if (!selectedFile.type.startsWith("video/")) {
      setFile(null);
      setUploadStatus("error");
      setUploadMessage("Please select a valid video file.");
      return;
    }

    setFile(selectedFile);
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setSelectedFile(selectedFile);

    if (selectedFile && !selectedFile.type.startsWith("video/")) {
      event.target.value = "";
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    if (uploading) {
      return;
    }

    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    setSelectedFile(droppedFile);
  };

  const uploadFile = async () => {
    if (!file || !canUpload) {
      return;
    }

    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadMessage(null);

    try {
      const presignResponse = await apiFetch("/api/storage/presign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: `video/${file.name}`,
          method: "PUT",
          content_type: file.type || "video/mp4",
          expires_in: 3600,
        }),
      });

      if (!presignResponse.ok) {
        throw new Error(await readErrorMessage(presignResponse, "Failed to generate upload URL"));
      }

      const payload = (await presignResponse.json()) as {
        url: string;
        headers?: Record<string, string>;
      };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(progress);
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`S3 upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => {
          reject(new Error("Network error during file upload"));
        });

        xhr.addEventListener("abort", () => {
          reject(new Error("Upload aborted"));
        });

        xhr.open("PUT", payload.url);

        Object.entries(payload.headers || {}).forEach(([headerName, headerValue]) => {
          xhr.setRequestHeader(headerName, headerValue);
        });

        xhr.send(file);
      });

      setUploadStatus("success");
      setUploadProgress(100);
      setUploadMessage("Upload completed successfully.");
    } catch (error) {
      setUploadStatus("error");
      setUploadMessage(error instanceof Error ? error.message : "Upload failed");
    }
  };

  if (!canUpload) {
    return <AccessDenied message="Only admin users can upload files in this sprint." />;
  }

  return (
    <div className="upload-page">
      <ObcElevatedCard
        notClickable
        size={ObcElevatedCardSize.MultiLine}
        className="upload-page__card"
      >
        <div slot="label" className="upload-page__title">
          Upload video file
        </div>
        <div slot="description" className="upload-page__description">
          Select, preview and upload a video file to S3 using a pre-signed URL
        </div>
      </ObcElevatedCard>

      <ObcCard className="upload-page__content-card">
        <div slot="title">File selection</div>
        <div className="upload-page__body">
          <div
            className={[
              "upload-page__dropzone",
              isDragActive ? "upload-page__dropzone--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onDragOver={(event) => {
              event.preventDefault();
              if (!isDragActive) {
                setIsDragActive(true);
              }
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={handleDrop}
          >
            <div className="upload-page__dropzone-title">
              {file ? "Video selected" : "Drop video file here"}
            </div>
            <div className="upload-page__dropzone-subtitle">
              {file
                ? "Preview in the panel below, then upload when ready."
                : "Or use Select video file. Supported: MP4, MOV, WEBM and other video formats."}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="upload-page__native-file-input"
              onChange={handleFileSelection}
            />

            <div className="upload-page__dropzone-actions">
              <ObcButton
                variant={ButtonVariant.raised}
                disabled={uploading}
                onClick={handlePickFile}
              >
                Select video file
              </ObcButton>
              <ObcButton
                variant={ButtonVariant.flat}
                disabled={uploading || !file}
                onClick={clearSelectedFile}
              >
                Delete selected
              </ObcButton>
              <ObcProgressButton
                type={ProgressButtonType.Linear}
                mode={ProgressMode.Indeterminate}
                buttonStyle={ButtonStyle.Raised}
                label={uploading ? "Uploading..." : "Upload file"}
                showProgress={uploading}
                disabled={!file || uploading}
                onClick={() => void uploadFile()}
              />
            </div>
          </div>

          {file && (
            <div className="upload-page__file-info">
              <div className="upload-page__file-name">{file.name}</div>
              <div>{formatFileSize(file.size)}</div>
              <div>{file.type || "video/unknown"}</div>
            </div>
          )}

          {uploading && (
            <ObcProgressBar
              type={ProgressBarType.linear}
              mode={ProgressBarMode.determinate}
              value={uploadProgress}
              showValue
              showUnit
            />
          )}

          {uploadMessage && (
            <ObcAlertFrame
              type={ObcAlertFrameType.Regular}
              status={
                uploadStatus === "success" ? ObcAlertFrameStatus.Caution : ObcAlertFrameStatus.Alarm
              }
              className="upload-page__alert"
            >
              <div>{uploadMessage}</div>
            </ObcAlertFrame>
          )}
        </div>
      </ObcCard>

      <ObcCard className="upload-page__content-card">
        <div slot="title">Preview</div>
        {previewUrl ? (
          <div className="upload-page__preview">
            <video
              className="upload-page__preview-video"
              controls
              preload="metadata"
              src={previewUrl}
            >
              Your browser does not support the video preview element.
            </video>
          </div>
        ) : (
          <div className="upload-page__preview-empty">No video selected yet.</div>
        )}
      </ObcCard>
    </div>
  );
}
