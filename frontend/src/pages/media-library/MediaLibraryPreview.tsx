import type { MediaLibraryPreviewProps } from "./types";

export function MediaLibraryPreview({
  row,
  previewError,
  onPreviewError,
}: MediaLibraryPreviewProps) {
  return (
    <aside className="media-library-page__preview-panel" aria-label="Selected media preview">
      <div className="media-library-preview__frame">
        {row?.previewUrl && !previewError ? (
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
    </aside>
  );
}
