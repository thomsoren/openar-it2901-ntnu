import { useEffect, useRef, useState } from "react";
import { ObcAlertFrame } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-frame/alert-frame";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { ObcProgressBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-bar/progress-bar";
import { ObcRichButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/rich-button/rich-button";
import { ObiCloseGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-close-google";
import { ObiFileDownloadGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-file-download-google";
import { ObiUpIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-up-iec";
import {
  ObcAlertFrameStatus,
  ObcAlertFrameType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-frame/alert-frame";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import {
  ProgressBarMode,
  ProgressBarType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-bar/progress-bar";
import { RichButtonDirection } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/rich-button/rich-button";
import AccessDenied from "../components/auth/AccessDenied";
import { apiFetch } from "../lib/api-client";
import type { BackendUser } from "../types/auth";
import "./Upload.css";

type UploadStatus = "idle" | "uploading" | "success" | "error";

type UploadProps = {
  currentUser: BackendUser;
};

type SelectedFile = {
  file: File;
  addedAt: Date;
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

const formatDate = (date: Date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString("en-GB", { hour12: false });
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
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const uploading = uploadStatus === "uploading";
  const canUpload = currentUser.is_admin;
  const activeFile = files[activeIndex] ?? null;
  const activeRawFile = activeFile?.file ?? null;
  const hasFiles = files.length > 0;

  useEffect(() => {
    if (!activeRawFile) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(activeRawFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [activeRawFile]);

  const resetUploadState = () => {
    setUploadStatus("idle");
    setUploadProgress(0);
    setUploadMessage(null);
  };

  const addFile = (newFile: File) => {
    resetUploadState();

    if (!newFile.type.startsWith("video/")) {
      setUploadStatus("error");
      setUploadMessage("Please select a valid video file.");
      return;
    }

    setFiles((prev) => [...prev, { file: newFile, addedAt: new Date() }]);
    setActiveIndex(files.length);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (activeIndex >= files.length - 1) {
      setActiveIndex(Math.max(0, files.length - 2));
    } else if (index < activeIndex) {
      setActiveIndex((prev) => prev - 1);
    }
    resetUploadState();
  };

  const closePreview = () => {
    setFiles([]);
    setActiveIndex(0);
    resetUploadState();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePickFile = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    if (selectedFile) {
      addFile(selectedFile);
    }
    if (event.target) {
      event.target.value = "";
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (uploading) return;

    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    if (droppedFile) {
      addFile(droppedFile);
    }
  };

  const uploadFile = async () => {
    if (!activeFile || !canUpload) return;

    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadMessage(null);

    const { file } = activeFile;

    try {
      const presignResponse = await apiFetch("/api/storage/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`S3 upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Network error during file upload")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

        xhr.open("PUT", payload.url);
        Object.entries(payload.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
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

  const dragProps = {
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!isDragActive) setIsDragActive(true);
    },
    onDragLeave: () => setIsDragActive(false),
    onDrop: handleDrop,
  };

  const dropzoneClasses = [
    "upload-page__dropzone",
    isDragActive ? "upload-page__dropzone--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const dropzone = (
    <div className={dropzoneClasses} {...dragProps}>
      <div className="upload-page__dropzone-content">
        <div className="upload-page__dropzone-icon">
          <ObiFileDownloadGoogle />
        </div>
        <div className="upload-page__dropzone-text">Drag and drop file here</div>
      </div>
    </div>
  );

  const browseButton = (
    <ObcRichButton
      className="upload-page__rich-button"
      label="Browse files"
      description="Supported file formats are .mp4, .mov, .webm"
      direction={RichButtonDirection.Horizontal}
      hasTrailingIcon
      fullWidth
      disabled={uploading}
      onRichButtonClick={handlePickFile}
    >
      <ObiUpIec slot="trailing-icon" />
    </ObcRichButton>
  );

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="video/*"
      className="upload-page__native-file-input"
      onChange={handleFileSelection}
    />
  );

  /* ── State 1: No files selected ── */
  if (!hasFiles) {
    return (
      <div className="upload-page">
        {fileInput}
        <div className="upload-page__empty">
          <div className="upload-page__header">
            <div className="upload-page__title">Upload video file</div>
            <div className="upload-page__subtitle">
              Select, preview and upload video file to S3 using a pre-signed URL
            </div>
          </div>

          {dropzone}
          {browseButton}

          <ObcRichButton
            className="upload-page__rich-button"
            label="Connect to live stream"
            description="Connect to a live RTSP video stream"
            direction={RichButtonDirection.Horizontal}
            hasTrailingIcon
            fullWidth
            disabled
          >
            <ObiUpIec slot="trailing-icon" />
          </ObcRichButton>

          {uploadMessage && (
            <ObcAlertFrame
              type={ObcAlertFrameType.Regular}
              status={ObcAlertFrameStatus.Alarm}
              className="upload-page__alert"
            >
              <div>{uploadMessage}</div>
            </ObcAlertFrame>
          )}
        </div>
      </div>
    );
  }

  /* ── State 2: Files selected — preview modal ── */
  return (
    <div className="upload-page">
      {fileInput}
      <div className="upload-page__preview-container">
        <div className="upload-page__header">
          <div className="upload-page__title">Upload video file</div>
          <div className="upload-page__subtitle">
            Select, preview and upload video file to S3 using a pre-signed URL
          </div>
        </div>

        <div className="upload-page__modal">
          {/* Title bar */}
          <div className="upload-page__modal-titlebar">
            <div className="upload-page__modal-title">Preview before upload</div>
            <ObcIconButton variant={IconButtonVariant.flat} onClick={closePreview}>
              <ObiCloseGoogle />
            </ObcIconButton>
          </div>

          {/* Split content */}
          <div className="upload-page__modal-content">
            {/* Left panel — file list */}
            <div className="upload-page__left-panel">
              <div className="upload-page__file-list">
                {files.map((entry, index) => (
                  <div
                    key={`${entry.file.name}-${index}`}
                    className={[
                      "upload-page__attachment-item",
                      index === activeIndex ? "upload-page__attachment-item--selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setActiveIndex(index)}
                  >
                    {/* TODO: Replace with <obc-attachment-list-item> when available */}
                    <div className="upload-page__attachment-label">{entry.file.name}</div>
                    <div className="upload-page__attachment-meta">
                      <span className="upload-page__attachment-date">
                        {formatDate(entry.addedAt)}
                      </span>
                      <span className="upload-page__attachment-time">
                        {formatTime(entry.addedAt)}
                      </span>
                    </div>
                    <div className="upload-page__attachment-actions">
                      <span className="upload-page__attachment-size">
                        {formatFileSize(entry.file.size)}
                      </span>
                      {index === activeIndex && (
                        <ObcIconButton
                          variant={IconButtonVariant.flat}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(index);
                          }}
                        >
                          <ObiCloseGoogle />
                        </ObcIconButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom controls */}
              <div className="upload-page__left-panel-controls">
                {dropzone}
                {browseButton}
              </div>
            </div>

            {/* Right panel — video preview */}
            <div className="upload-page__right-panel">
              {previewUrl ? (
                <video
                  className="upload-page__video-preview"
                  controls
                  preload="metadata"
                  src={previewUrl}
                >
                  Your browser does not support the video preview element.
                </video>
              ) : null}
            </div>
          </div>

          {/* Footer */}
          {uploading && (
            <div className="upload-page__progress">
              <ObcProgressBar
                type={ProgressBarType.linear}
                mode={ProgressBarMode.determinate}
                value={uploadProgress}
                showValue
                showUnit
              />
            </div>
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

          <div className="upload-page__modal-footer">
            <ObcButton
              variant={ButtonVariant.raised}
              disabled={!activeFile || uploading}
              onClick={() => void uploadFile()}
            >
              Upload
            </ObcButton>
          </div>
        </div>
      </div>
    </div>
  );
}
