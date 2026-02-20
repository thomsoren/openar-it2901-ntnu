import { useRef, useState } from "react";
import { ObcAlertFrame } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-frame/alert-frame";
import { ObcAttachmentListItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/attachment-list-item/attachment-list-item";
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
  const [previewError, setPreviewError] = useState(false);

  const uploading = uploadStatus === "uploading";
  const canUpload = currentUser.is_admin;
  const activeFile = files[activeIndex] ?? null;
  const hasFiles = files.length > 0;

  const setPreviewFromFile = (file: File | null) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewError(false);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

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
    setPreviewFromFile(newFile);
  };

  const removeFile = (index: number) => {
    const remaining = files.filter((_, i) => i !== index);
    setFiles(remaining);

    let nextIndex: number;
    if (activeIndex >= files.length - 1) {
      nextIndex = Math.max(0, files.length - 2);
    } else if (index < activeIndex) {
      nextIndex = activeIndex - 1;
    } else {
      nextIndex = activeIndex;
    }
    setActiveIndex(nextIndex);
    setPreviewFromFile(remaining[nextIndex]?.file ?? null);
    resetUploadState();
  };

  const closePreview = () => {
    setPreviewFromFile(null);
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
              Select, preview and upload video file, and watch your video with AR overlay.
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
            Select, preview and upload video file, and watch your video with AR overlay.
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
                  <ObcAttachmentListItem
                    key={`${entry.file.name}-${index}`}
                    label={entry.file.name}
                    date={formatDate(entry.addedAt)}
                    time={formatTime(entry.addedAt)}
                    hasTimeDate
                    hasTrailingAction
                    amplified={index === activeIndex}
                    showDivider={index < files.length - 1}
                    onAttachmentItemClick={() => {
                      setActiveIndex(index);
                      setPreviewFromFile(entry.file);
                    }}
                  >
                    <ObcIconButton
                      slot="trailing-action"
                      variant={IconButtonVariant.flat}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                    >
                      <ObiCloseGoogle />
                    </ObcIconButton>
                  </ObcAttachmentListItem>
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
              {previewUrl && !previewError ? (
                <video
                  className="upload-page__video-preview"
                  controls
                  src={previewUrl}
                  onError={() => setPreviewError(true)}
                />
              ) : null}
              {previewError ? (
                <div className="upload-page__preview-error">
                  Preview unavailable — this video format is not supported by your browser. You can
                  still upload the file.
                </div>
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
