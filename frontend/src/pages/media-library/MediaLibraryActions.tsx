import { ObcRichButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/rich-button/rich-button";
import { RichButtonDirection } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/rich-button/rich-button";
import { ObiFileDownloadGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-file-download-google";
import { ObiLink } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-link";
import { ObiUpIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-up-iec";

interface MediaLibraryActionsProps {
  onBrowse: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragActive: boolean;
  setIsDragActive: (active: boolean) => void;
}

export function MediaLibraryActions({
  onBrowse,
  onDrop,
  isDragActive,
  setIsDragActive,
}: MediaLibraryActionsProps) {
  return (
    <div className="media-library-page__actions">
      <div className="media-library-page__action-slot">
        <ObcRichButton
          className="media-library-rich-button"
          label="Connect live stream"
          description="Connect livestream camera"
          direction={RichButtonDirection.Horizontal}
          hasTrailingIcon
          fullHeight
          fullWidth
          disabled
        >
          <ObiLink slot="trailing-icon" />
        </ObcRichButton>
      </div>

      <div className="media-library-page__action-slot">
        <ObcRichButton
          className="media-library-rich-button"
          label="Browse files"
          description="Supported formats: .mp4, .mov"
          direction={RichButtonDirection.Horizontal}
          hasTrailingIcon
          fullHeight
          fullWidth
          onClick={onBrowse}
        >
          <ObiUpIec slot="trailing-icon" />
        </ObcRichButton>
      </div>

      <div className="media-library-page__action-slot">
        <div
          className={`media-library-dropzone${isDragActive ? " media-library-dropzone--active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={onDrop}
        >
          <div className="media-library-dropzone__content">
            <div className="media-library-dropzone__title">Drag and drop</div>
            <div className="media-library-dropzone__description">Drop a video file here</div>
          </div>
          <div className="media-library-dropzone__icon">
            <ObiFileDownloadGoogle />
          </div>
        </div>
      </div>
    </div>
  );
}
