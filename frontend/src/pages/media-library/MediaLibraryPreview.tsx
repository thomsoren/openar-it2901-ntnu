import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { ObiDelete } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-delete";
import { ObiContentCopyGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-content-copy-google";
import type { MediaLibraryPreviewProps } from "./types";
import "./MediaLibraryPreview.css";

export function MediaLibraryPreview({
  row,
  previewError,
  onPreviewError,
  onDelete,
}: MediaLibraryPreviewProps) {
  const handleCopySource = () => {
    if (!row) return;
    const source = row.asset.s3_key;
    void navigator.clipboard.writeText(source);
  };

  return (
    <aside className="media-library-page__preview-panel" aria-label="Selected media preview">
      <div className="media-preview-card">
        <div className="media-preview-card__thumbnail">
          <div className="media-preview-card__thumbnail-inner">
            {row?.previewUrl && !previewError ? (
              <video
                key={row.previewUrl}
                className="media-preview-card__video"
                src={row.previewUrl}
                controls
                preload="metadata"
                onError={onPreviewError}
              />
            ) : (
              <div className="media-preview-card__empty">
                {previewError
                  ? "Preview unavailable."
                  : "Select a video asset to preview."}
              </div>
            )}
          </div>
        </div>

        {row && (
          <div className="media-preview-card__body">
            <p className="media-preview-card__title">{row.fileName}</p>

            <div className="media-preview-card__metadata">
              <div className="media-preview-card__metadata-row">
                <div className="media-preview-card__metadata-item">
                  <p className="media-preview-card__metadata-label">Type</p>
                  <p className="media-preview-card__metadata-value">
                    {row.asset.media_type === "video" ? "Video file" : row.asset.media_type}
                  </p>
                </div>
                <div className="media-preview-card__metadata-item">
                  <p className="media-preview-card__metadata-label">Status</p>
                  <p className="media-preview-card__metadata-value">
                    {row.asset.transcode_status === "completed" ? "Ready" : (row.asset.transcode_status ?? "Unknown")}
                  </p>
                </div>
              </div>

              <div className="media-preview-card__metadata-row">
                <div className="media-preview-card__metadata-item">
                  <p className="media-preview-card__metadata-label">Visibility</p>
                  <p className="media-preview-card__metadata-value">{row.asset.visibility}</p>
                </div>
                <div className="media-preview-card__metadata-item">
                  <p className="media-preview-card__metadata-label">Uploaded</p>
                  <p className="media-preview-card__metadata-value">{row.uploaded}</p>
                </div>
              </div>

              <div className="media-preview-card__source-row">
                <div className="media-preview-card__source-text">
                  <div className="media-preview-card__metadata-item">
                    <p className="media-preview-card__metadata-label">Source</p>
                    <p className="media-preview-card__metadata-value">{row.asset.s3_key}</p>
                  </div>
                </div>
                <ObcIconButton
                  variant={IconButtonVariant.flat}
                  onClick={handleCopySource}
                  aria-label="Copy source path"
                >
                  <ObiContentCopyGoogle />
                </ObcIconButton>
              </div>
            </div>

            <div className="media-preview-card__actions">
              <ObcButton
                variant={ButtonVariant.normal}
                showLeadingIcon
                onClick={onDelete}
              >
                <span slot="leading-icon">
                  <ObiDelete />
                </span>
                Remove
              </ObcButton>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
