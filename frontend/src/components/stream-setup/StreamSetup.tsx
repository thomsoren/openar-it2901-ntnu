import { useEffect, useRef, useState } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcRichButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/rich-button/rich-button";
import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { ObcAttachmentListItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/attachment-list-item/attachment-list-item";
import { ObcAlertFrame } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-frame/alert-frame";
import { ObcProgressBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-bar/progress-bar";
import { ObiFileDownloadGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-file-download-google";
import { ObiUpIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-up-iec";
import { ObiCloseGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-close-google";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { RichButtonDirection } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/rich-button/rich-button";
import {
  ObcAlertFrameStatus,
  ObcAlertFrameType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-frame/alert-frame";
import {
  ProgressBarMode,
  ProgressBarType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-bar/progress-bar";
import { apiFetch } from "../../lib/api-client";
import { readApiError } from "../../utils/api-helpers";
import "./StreamSetup.css";

type StreamSetupProps = {
  tabId: string;
  onStreamReady: (streamId: string) => void;
};

type SetupStatus = "idle" | "uploading" | "starting" | "error";

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

export default function StreamSetup({ tabId, onStreamReady }: StreamSetupProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const busy = status === "uploading" || status === "starting";
  const hasFiles = files.length > 0;
  const activeFile = files[activeIndex] ?? null;

  const setPreviewFromFile = (file: File | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const newUrl = file ? URL.createObjectURL(file) : null;
    previewUrlRef.current = newUrl;
    setPreviewError(false);
    setPreviewUrl(newUrl);
  };

  const reset = () => {
    setStatus("idle");
    setUploadProgress(0);
    setMessage(null);
    setPreviewFromFile(null);
    setFiles([]);
    setActiveIndex(0);
  };

  const startStreamWithSource = async (source?: string) => {
    setStatus("starting");
    setMessage(null);
    try {
      const body: { source_url?: string; loop: boolean } = { loop: true };
      if (source) {
        body.source_url = source;
      }
      const response = await apiFetch(`/api/streams/${encodeURIComponent(tabId)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok && response.status !== 409) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail || "Failed to start stream");
      }
      onStreamReady(tabId);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Failed to start stream");
    }
  };

  const handleUpload = async (file: File) => {
    setStatus("uploading");
    setUploadProgress(0);
    setMessage(null);

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
        throw new Error(await readApiError(presignResponse, "Failed to generate upload URL"));
      }

      const payload = (await presignResponse.json()) as {
        url: string;
        headers?: Record<string, string>;
      };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });
        xhr.addEventListener("error", () => {
          xhrRef.current = null;
          reject(new Error("Network error during upload"));
        });
        xhr.addEventListener("abort", () => {
          xhrRef.current = null;
          reject(new Error("Upload aborted"));
        });
        xhr.open("PUT", payload.url);
        Object.entries(payload.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.send(file);
      });

      setUploadProgress(100);
      await startStreamWithSource(payload.url);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const addFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setStatus("error");
      setMessage("Please select a valid video file.");
      return;
    }
    setFiles((prev) => {
      setActiveIndex(prev.length);
      return [...prev, { file, addedAt: new Date() }];
    });
    setPreviewFromFile(file);
    setStatus("idle");
    setMessage(null);
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
    setStatus("idle");
    setMessage(null);
  };

  const handlePickFile = () => {
    if (busy) return;
    fileInputRef.current?.click();
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file) addFile(file);
    if (event.target) event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) addFile(file);
  };

  const handleUseDefault = () => {
    void startStreamWithSource();
  };

  const dragProps = {
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!isDragActive) setIsDragActive(true);
    },
    onDragLeave: () => setIsDragActive(false),
    onDrop: handleDrop,
  };

  const dropzoneClasses = [
    "stream-setup__dropzone",
    isDragActive ? "stream-setup__dropzone--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="video/*"
      className="stream-setup__native-file-input"
      onChange={handleFileSelection}
    />
  );

  const dropzone = (
    <div className={dropzoneClasses} {...dragProps}>
      <div className="stream-setup__dropzone-content">
        <div className="stream-setup__dropzone-icon">
          <ObiFileDownloadGoogle />
        </div>
        <div className="stream-setup__dropzone-text">Drag and drop file here</div>
      </div>
    </div>
  );

  const browseButton = (
    <ObcRichButton
      className="stream-setup__rich-button"
      label="Browse files"
      description="Supported formats: .mp4, .mov, .webm"
      direction={RichButtonDirection.Horizontal}
      hasTrailingIcon
      fullWidth
      disabled={busy}
      onRichButtonClick={handlePickFile}
    >
      <ObiUpIec slot="trailing-icon" />
    </ObcRichButton>
  );

  /* ── File selected — preview modal ── */
  if (hasFiles) {
    return (
      <div className="stream-setup stream-setup--preview">
        {fileInput}
        <div className="stream-setup__preview-container">
          <div className="stream-setup__header">
            <div className="stream-setup__title">Upload video file</div>
            <div className="stream-setup__subtitle">
              Select, preview and upload video file to S3 using a pre-signed URL
            </div>
          </div>

          <div className="stream-setup__modal">
            {/* Title bar */}
            <div className="stream-setup__modal-titlebar">
              <div className="stream-setup__modal-title">Preview before upload</div>
              <ObcIconButton variant={IconButtonVariant.flat} onClick={reset}>
                <ObiCloseGoogle />
              </ObcIconButton>
            </div>

            {/* Split content */}
            <div className="stream-setup__modal-content">
              {/* Left panel — file list */}
              <div className="stream-setup__left-panel">
                <div className="stream-setup__file-list">
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
                <div className="stream-setup__left-panel-controls">
                  {dropzone}
                  {browseButton}
                </div>
              </div>

              {/* Right panel — video preview */}
              <div className="stream-setup__right-panel">
                {previewUrl && !previewError ? (
                  <video
                    className="stream-setup__video-preview"
                    controls
                    src={previewUrl}
                    onError={() => setPreviewError(true)}
                  />
                ) : previewError ? (
                  <div className="stream-setup__preview-error">
                    Preview unavailable — this video format is not supported by your browser. You
                    can still upload the file.
                  </div>
                ) : (
                  <div className="stream-setup__preview-placeholder">Select video to preview</div>
                )}
              </div>
            </div>

            {/* Footer */}
            {status === "uploading" && (
              <div className="stream-setup__modal-progress">
                <ObcProgressBar
                  type={ProgressBarType.linear}
                  mode={ProgressBarMode.determinate}
                  value={uploadProgress}
                  showValue
                  showUnit
                />
              </div>
            )}

            {message && (
              <ObcAlertFrame
                type={ObcAlertFrameType.Regular}
                status={
                  status === "error" ? ObcAlertFrameStatus.Alarm : ObcAlertFrameStatus.Caution
                }
                className="stream-setup__alert"
              >
                <div>{message}</div>
              </ObcAlertFrame>
            )}

            {status === "starting" && (
              <div className="stream-setup__status">Starting stream...</div>
            )}

            <div className="stream-setup__modal-footer">
              <ObcButton
                variant={ButtonVariant.raised}
                disabled={!activeFile || busy}
                onClick={() => activeFile && void handleUpload(activeFile.file)}
              >
                Upload
              </ObcButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── No files — initial setup view ── */
  return (
    <div className="stream-setup">
      {fileInput}

      <div className="stream-setup__content">
        <div className="stream-setup__header">
          <div className="stream-setup__title">Add video source</div>
          <div className="stream-setup__subtitle">
            Upload a video file or connect to a livestream.
          </div>
        </div>

        {dropzone}
        {browseButton}

        {/* Divider */}
        <div className="stream-setup__divider">
          <span>or</span>
        </div>

        {/* Connect to livestream */}
        <ObcRichButton
          className="stream-setup__rich-button"
          label="Connect to livestream"
          description="Start with the built-in demo video"
          direction={RichButtonDirection.Horizontal}
          hasTrailingIcon
          fullWidth
          disabled={busy}
          onRichButtonClick={handleUseDefault}
        >
          <ObiUpIec slot="trailing-icon" />
        </ObcRichButton>

        {status === "starting" && <div className="stream-setup__status">Starting stream...</div>}

        {message && (
          <ObcAlertFrame
            type={ObcAlertFrameType.Regular}
            status={status === "error" ? ObcAlertFrameStatus.Alarm : ObcAlertFrameStatus.Caution}
            className="stream-setup__alert"
          >
            <div>{message}</div>
          </ObcAlertFrame>
        )}
      </div>
    </div>
  );
}
