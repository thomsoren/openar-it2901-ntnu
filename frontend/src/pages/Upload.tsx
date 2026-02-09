import { useState } from "react";
import { API_CONFIG } from "../config/video";

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setUploadStatus("idle");
      setErrorMessage("");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setUploadStatus("idle");
      setErrorMessage("");
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setUploadStatus("uploading");
    setUploadProgress(0);
    setErrorMessage("");

    try {
      // Step 1: Get pre-signed URL from backend
      const presignResponse = await fetch(`${API_CONFIG.BASE_URL}/api/storage/presign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: `video/${file.name}`,
          method: "PUT",
          content_type: file.type || "video/mp4",
          expires_in: 3600, // 1 hour
        }),
      });

      if (!presignResponse.ok) {
        const error = await presignResponse.json();
        throw new Error(error.detail || "Failed to generate upload URL");
      }

      const { url, headers: uploadHeaders } = await presignResponse.json();

      // Step 2: Upload directly to S3 using pre-signed URL
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percentComplete);
        }
      });

      // Handle upload completion
      await new Promise<void>((resolve, reject) => {
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => {
          reject(new Error("Network error during upload"));
        });

        xhr.addEventListener("abort", () => {
          reject(new Error("Upload aborted"));
        });

        xhr.open("PUT", url);

        // Set headers from pre-signed URL response
        if (uploadHeaders) {
          Object.entries(uploadHeaders).forEach(([key, value]) => {
            xhr.setRequestHeader(key, value as string);
          });
        }

        xhr.send(file);
      });

      setUploadStatus("success");
      setUploadProgress(100);
    } catch (error) {
      console.error("Upload error:", error);
      setUploadStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  return (
    <div className="upload-page">
      <div className="upload-container">
        <h1 className="upload-title">Upload Video to S3</h1>
        <p className="upload-subtitle">Upload large video files directly to our S3 storage</p>

        {/* Drag and Drop Area */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`upload-dropzone ${isDragging ? "dragging" : ""}`}
        >
          <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="upload-text-primary">Drag and drop your video file here</p>
          <p className="upload-text-secondary">or</p>
          <label className="upload-button-label">
            <span className="upload-button">Browse Files</span>
            <input
              type="file"
              onChange={handleFileSelect}
              accept="video/*"
              className="upload-input-hidden"
            />
          </label>
        </div>

        {/* Selected File Info */}
        {file && (
          <div className="file-info">
            <h3 className="file-info-title">Selected File:</h3>
            <p className="file-info-name">{file.name}</p>
            <p className="file-info-size">{formatFileSize(file.size)}</p>
          </div>
        )}

        {/* Upload Progress */}
        {uploadStatus === "uploading" && (
          <div className="upload-progress-container">
            <div className="upload-progress-header">
              <span className="upload-progress-label">Uploading...</span>
              <span className="upload-progress-percent">{uploadProgress}%</span>
            </div>
            <div className="upload-progress-bar-bg">
              <div
                className="upload-progress-bar-fill"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {uploadStatus === "success" && (
          <div className="upload-message upload-success">
            <svg
              className="upload-message-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p>Upload successful! File is now available in S3.</p>
          </div>
        )}

        {/* Error Message */}
        {uploadStatus === "error" && (
          <div className="upload-message upload-error">
            <svg
              className="upload-message-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="upload-error-title">Upload failed</p>
              <p className="upload-error-message">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Upload Button */}
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="upload-submit-button"
        >
          {uploading ? (
            <>
              <svg className="upload-spinner" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Uploading...
            </>
          ) : (
            <>
              <svg
                className="upload-button-icon"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              Upload to S3
            </>
          )}
        </button>

        {/* Info Box */}
        <div className="upload-info-box">
          <h4 className="upload-info-title">Note:</h4>
          <ul className="upload-info-list">
            <li>Files will be uploaded to the video/ folder in the S3 bucket</li>
            <li>Large files (40GB+) are supported</li>
            <li>Upload happens directly to S3 from your browser</li>
            <li>Files are accessible after deployment</li>
          </ul>
        </div>
      </div>

      <style>{`
        .upload-page {
          min-height: 100vh;
          padding: 2rem 1rem;
          background: linear-gradient(to bottom right, #eff6ff, #dbeafe);
        }

        .upload-container {
          max-width: 48rem;
          margin: 0 auto;
          background: white;
          border-radius: 0.5rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
          padding: 2rem;
        }

        .upload-title {
          font-size: 1.875rem;
          font-weight: bold;
          color: #111827;
          margin-bottom: 0.5rem;
        }

        .upload-subtitle {
          color: #6b7280;
          margin-bottom: 2rem;
        }

        .upload-dropzone {
          border: 2px dashed #d1d5db;
          border-radius: 0.5rem;
          padding: 3rem;
          text-align: center;
          transition: all 0.2s;
          background: #f9fafb;
        }

        .upload-dropzone.dragging {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .upload-icon {
          width: 3rem;
          height: 3rem;
          margin: 0 auto 1rem;
          color: #9ca3af;
        }

        .upload-dropzone.dragging .upload-icon {
          color: #3b82f6;
        }

        .upload-text-primary {
          font-size: 1.125rem;
          font-weight: 500;
          color: #374151;
          margin-bottom: 0.5rem;
        }

        .upload-text-secondary {
          font-size: 0.875rem;
          color: #6b7280;
          margin-bottom: 1rem;
        }

        .upload-button-label {
          display: inline-block;
        }

        .upload-button {
          display: inline-block;
          padding: 0.5rem 1rem;
          background: #3b82f6;
          color: white;
          border-radius: 0.375rem;
          cursor: pointer;
          transition: background 0.2s;
        }

        .upload-button:hover {
          background: #2563eb;
        }

        .upload-input-hidden {
          display: none;
        }

        .file-info {
          margin-top: 1.5rem;
          padding: 1rem;
          background: #f9fafb;
          border-radius: 0.5rem;
        }

        .file-info-title {
          font-weight: 600;
          color: #111827;
          margin-bottom: 0.5rem;
        }

        .file-info-name {
          color: #374151;
        }

        .file-info-size {
          font-size: 0.875rem;
          color: #6b7280;
        }

        .upload-progress-container {
          margin-top: 1.5rem;
        }

        .upload-progress-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.5rem;
        }

        .upload-progress-label,
        .upload-progress-percent {
          font-size: 0.875rem;
          font-weight: 500;
          color: #374151;
        }

        .upload-progress-bar-bg {
          width: 100%;
          background: #e5e7eb;
          border-radius: 9999px;
          height: 0.625rem;
        }

        .upload-progress-bar-fill {
          background: #3b82f6;
          height: 0.625rem;
          border-radius: 9999px;
          transition: width 0.3s;
        }

        .upload-message {
          margin-top: 1.5rem;
          padding: 1rem;
          border-radius: 0.5rem;
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }

        .upload-success {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
        }

        .upload-error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #991b1b;
        }

        .upload-message-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
          margin-top: 0.125rem;
        }

        .upload-error-title {
          font-weight: 500;
        }

        .upload-error-message {
          font-size: 0.875rem;
          margin-top: 0.25rem;
        }

        .upload-submit-button {
          margin-top: 1.5rem;
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: 0.375rem;
          font-weight: 500;
          transition: background 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background: #3b82f6;
          color: white;
          border: none;
          cursor: pointer;
        }

        .upload-submit-button:hover:not(:disabled) {
          background: #2563eb;
        }

        .upload-submit-button:disabled {
          background: #d1d5db;
          color: #6b7280;
          cursor: not-allowed;
        }

        .upload-spinner {
          width: 1.25rem;
          height: 1.25rem;
          animation: spin 1s linear infinite;
        }

        .upload-button-icon {
          width: 1.25rem;
          height: 1.25rem;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        .upload-info-box {
          margin-top: 2rem;
          padding: 1rem;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 0.5rem;
        }

        .upload-info-title {
          font-weight: 600;
          color: #1e3a8a;
          margin-bottom: 0.5rem;
        }

        .upload-info-list {
          font-size: 0.875rem;
          color: #1e40af;
          list-style: none;
          padding: 0;
        }

        .upload-info-list li {
          margin-bottom: 0.25rem;
        }
      `}</style>
    </div>
  );
}
