import { useEffect, useRef, useState } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { useVideoTransform } from "../../hooks/useVideoTransform";
import type { DetectedVessel } from "../../types/detection";
import type { MediaAnalysisResult } from "../../services/media";
import type { MediaLibraryPreviewProps } from "./types";

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function AnalysisOverlay({
  videoUrl,
  analysisResult,
  previewError,
  onPreviewError,
}: {
  videoUrl: string;
  analysisResult: MediaAnalysisResult;
  previewError: boolean;
  onPreviewError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);

  const fps = analysisResult.fps && analysisResult.fps > 0 ? analysisResult.fps : 25;
  const vessels = (analysisResult.frames[String(currentFrameIndex)] ?? []) as DetectedVessel[];

  const transform = useVideoTransform(
    videoRef,
    containerRef,
    "contain",
    analysisResult.video_width ?? undefined,
    analysisResult.video_height ?? undefined,
    videoUrl
  );

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    if (!video) {
      return;
    }

    let animationFrameId: number | null = null;
    let videoFrameHandle: number | null = null;

    const updateFromTime = (mediaTime: number) => {
      const nextFrameIndex = Math.max(0, Math.round(mediaTime * fps));
      setCurrentFrameIndex((prev) => (prev === nextFrameIndex ? prev : nextFrameIndex));
    };

    const tick = () => {
      updateFromTime(video.currentTime || 0);
      animationFrameId = window.requestAnimationFrame(tick);
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      const onVideoFrame = (_now: number, metadata: { mediaTime: number }) => {
        updateFromTime(metadata.mediaTime);
        videoFrameHandle = video.requestVideoFrameCallback?.(onVideoFrame) ?? null;
      };
      videoFrameHandle = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      animationFrameId = window.requestAnimationFrame(tick);
    }

    return () => {
      if (videoFrameHandle !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(videoFrameHandle);
      }
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [fps]);

  return (
    <div ref={containerRef} className="media-library-preview__analysis-shell">
      <video
        ref={videoRef}
        key={videoUrl}
        className="media-library-preview__video"
        src={videoUrl}
        controls
        preload="metadata"
        onError={onPreviewError}
      />
      {!previewError && (
        <div className="media-library-preview__boxes" aria-hidden>
          {vessels.map((item, index) => {
            const detection = item.detection;
            const sourceWidth = transform.sourceWidth || analysisResult.video_width || 1;
            const sourceHeight = transform.sourceHeight || analysisResult.video_height || 1;
            const left =
              ((detection.x - detection.width / 2) / sourceWidth) * transform.videoWidth +
              transform.offsetX;
            const top =
              ((detection.y - detection.height / 2) / sourceHeight) * transform.videoHeight +
              transform.offsetY;
            const width = (detection.width / sourceWidth) * transform.videoWidth;
            const height = (detection.height / sourceHeight) * transform.videoHeight;
            const key = detection.track_id ?? `${currentFrameIndex}-${index}`;

            return (
              <div
                key={key}
                className="media-library-preview__box"
                style={{
                  left,
                  top,
                  width,
                  height,
                }}
                title={item.vessel?.name || detection.class_name || "Detection"}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

const ANALYSIS_STATUS_LABELS: Record<string, string> = {
  queued: "Queued for processing",
  processing: "Processing in IDUN",
  completed: "Analysis complete",
  failed: "Analysis failed",
};

export function MediaLibraryPreview({
  row,
  previewError,
  onPreviewError,
  analysis,
  analysisResult,
  isRetrying,
  onRetry,
}: MediaLibraryPreviewProps) {
  const showCompletedPreview =
    row?.previewUrl && analysis?.status === "completed" && analysisResult && !previewError;

  return (
    <aside className="media-library-page__preview-panel" aria-label="Selected media preview">
      <div className="media-library-preview__frame">
        {showCompletedPreview ? (
          <AnalysisOverlay
            videoUrl={row.previewUrl}
            analysisResult={analysisResult}
            previewError={previewError}
            onPreviewError={onPreviewError}
          />
        ) : row?.previewUrl && !previewError ? (
          <video
            key={row.previewUrl}
            className="media-library-preview__video"
            src={row.previewUrl}
            controls
            preload="metadata"
            onError={onPreviewError}
          />
        ) : (
          <div className="media-library-preview__empty">
            {previewError
              ? "Preview unavailable. The video may not be accessible."
              : "Select a video asset to preview."}
          </div>
        )}
      </div>

      {row?.asset.media_type === "video" && analysis ? (
        <div className="media-library-preview__status-panel">
          <div
            className={`media-library-status-badge media-library-status-badge--${analysis.status}`}
          >
            {ANALYSIS_STATUS_LABELS[analysis.status] ?? analysis.status}
          </div>
          {analysis.error_message ? (
            <p className="media-library-preview__status-text">{analysis.error_message}</p>
          ) : null}
          {analysis.status === "failed" ? (
            <ObcButton variant={ButtonVariant.normal} disabled={isRetrying} onClick={onRetry}>
              {isRetrying ? "Retrying..." : "Retry analysis"}
            </ObcButton>
          ) : null}
          {analysis.status !== "completed" ? (
            <p className="media-library-preview__status-text">
              Detections will be shown here when processing completes.
            </p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
