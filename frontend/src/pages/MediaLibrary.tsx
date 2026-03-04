import { type ReactNode, useState } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcDropdownButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/dropdown-button/dropdown-button";
import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { ObcRichButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/rich-button/rich-button";
import { ObcTextInputField } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/text-input-field/text-input-field";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { DropdownButtonType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/dropdown-button/dropdown-button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { RichButtonDirection } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/rich-button/rich-button";
import { ObiFileDownloadGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-file-download-google";
import { ObiCloseGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-close-google";
import { ObiArrowTopRight } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-arrow-top-right";
import { ObiDelete } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-delete";
import { ObiEditGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-edit-google";
import { ObiLink } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-link";
import { ObiWidgetAddGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-widget-add-google";
import { API_CONFIG } from "../config/video";
import "./MediaLibrary.css";

interface MediaRow {
  id: string;
  fileName: string;
  type: string;
  uploaded: string;
  visibilityValue: string;
  previewUrl: string | null;
  previewDescription: string;
}

interface MediaLibraryModalProps {
  title: string;
  labelledBy: string;
  icon: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}

interface MediaLibraryTableProps {
  rows: MediaRow[];
  selectedRowId: string;
  onSelectRow: (rowId: string) => void;
  onVisibilityChange: (rowId: string, visibilityValue: string) => void;
  onOpenRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
}

interface MediaLibraryPreviewProps {
  row: MediaRow | null;
  previewError: boolean;
  onPreviewError: () => void;
}

type MediaLibraryModalMode = "edit" | "delete" | null;

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "group", label: "Group" },
  { value: "public", label: "Public" },
];

const INITIAL_MEDIA_ROWS: MediaRow[] = [
  {
    id: "row-1",
    fileName: "Pirbadet-edited.mp4",
    uploaded: "03/03/2026",
    type: "Stream",
    visibilityValue: "private",
    previewUrl: `${API_CONFIG.BASE_URL}/api/video/stream`,
    previewDescription: "Pirbadet demo video stored in the S3 bucket.",
  },
  {
    id: "row-2",
    fileName: "Pirbadet.ndjson",
    uploaded: "03/03/2026",
    type: "AIS",
    visibilityValue: "private",
    previewUrl: null,
    previewDescription: "AIS logs do not have a direct video preview.",
  },
];

const DEFAULT_ROW_ID = INITIAL_MEDIA_ROWS[0]?.id ?? "";

const handleOpenMedia = (rowId: string) => {
  void rowId; // TODO: Hook up open action to media preview/details API flow.
};

const handleDeleteMedia = (rowId: string) => {
  void rowId; // TODO: Hook up delete action to media delete API flow.
};

const handleVisibilityChange = (rowId: string, visibilityValue: string) => {
  void rowId;
  void visibilityValue; // TODO: Hook up visibility change to media visibility API flow.
};

function updateRowVisibility(rows: MediaRow[], rowId: string, visibilityValue: string): MediaRow[] {
  return rows.map((row) => (row.id === rowId ? { ...row, visibilityValue } : row));
}

function updateRowFileName(rows: MediaRow[], rowId: string, fileName: string): MediaRow[] {
  return rows.map((row) => (row.id === rowId ? { ...row, fileName } : row));
}

function removeRow(rows: MediaRow[], rowId: string): MediaRow[] {
  return rows.filter((row) => row.id !== rowId);
}

function getNextSelectedRowId(rows: MediaRow[]): string {
  return rows[0]?.id ?? "";
}

function MediaLibraryModal({
  title,
  labelledBy,
  icon,
  closeLabel,
  onClose,
  children,
  actions,
}: MediaLibraryModalProps) {
  return (
    <div className="media-library-page__modal-layer" role="presentation">
      <div className="media-library-page__modal-backdrop" />
      <div
        className="media-library-page__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <div className="media-library-page__modal-header">
          <div className="media-library-page__modal-title-wrap">
            {icon}
            <h2 id={labelledBy} className="media-library-page__modal-title">
              {title}
            </h2>
          </div>
          <ObcIconButton
            className="media-library-page__modal-close"
            variant={IconButtonVariant.flat}
            aria-label={closeLabel}
            onClick={onClose}
          >
            <ObiCloseGoogle />
          </ObcIconButton>
        </div>
        <div className="media-library-page__modal-divider" />
        <div className="media-library-page__modal-content">{children}</div>
        <div className="media-library-page__modal-footer">{actions}</div>
      </div>
    </div>
  );
}

function MediaLibraryActions() {
  return (
    <div className="media-library-page__actions">
      <div className="media-library-page__action-slot">
        <ObcRichButton
          className="media-library-rich-button"
          label="Connect live stream"
          description="something here two lines?"
          direction={RichButtonDirection.Horizontal}
          hasTrailingIcon
          fullHeight
          fullWidth
        >
          <ObiLink slot="trailing-icon" />
        </ObcRichButton>
      </div>

      <div className="media-library-page__action-slot">
        <ObcRichButton
          className="media-library-rich-button"
          label="Browse files"
          description="Supported formats are .mp4, .mov and sd"
          direction={RichButtonDirection.Horizontal}
          hasTrailingIcon
          fullHeight
          fullWidth
        >
          <ObiWidgetAddGoogle slot="trailing-icon" />
        </ObcRichButton>
      </div>

      <div className="media-library-page__action-slot">
        <div className="media-library-dropzone">
          <div className="media-library-dropzone__content">
            <div className="media-library-dropzone__title">Drag and drop</div>
            <div className="media-library-dropzone__description">Link, file etc. sdsd</div>
          </div>
          <div className="media-library-dropzone__icon">
            <ObiFileDownloadGoogle />
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaLibraryTable({
  rows,
  selectedRowId,
  onSelectRow,
  onVisibilityChange,
  onOpenRow,
  onDeleteRow,
}: MediaLibraryTableProps) {
  return (
    <div className="media-library-page__table-panel">
      <div className="media-library-table-shell">
        <div className="media-library-table-header">
          <div className="media-library-table-cell media-library-table-cell--file media-library-table-header__cell media-library-table-header__cell--divider">
            File name
          </div>
          <div className="media-library-table-cell media-library-table-cell--type media-library-table-header__cell media-library-table-header__cell--divider">
            Type
          </div>
          <div className="media-library-table-cell media-library-table-cell--uploaded media-library-table-header__cell media-library-table-header__cell--divider">
            Uploaded
          </div>
          <div className="media-library-table-cell media-library-table-cell--visibility media-library-table-header__cell">
            Visibility
          </div>
          <div className="media-library-table-cell media-library-table-cell--open" />
          <div className="media-library-table-cell media-library-table-cell--delete" />
        </div>

        <div className="media-library-table-body">
          {rows.map((row) => {
            const isSelected = row.id === selectedRowId;

            return (
              <div
                key={row.id}
                className={`media-library-table-row${isSelected ? " media-library-table-row--selected" : ""}`}
              >
                <button
                  type="button"
                  className="media-library-table-row__selection"
                  aria-pressed={isSelected}
                  onClick={() => onSelectRow(row.id)}
                >
                  <div className="media-library-table-cell media-library-table-cell--file">
                    {row.fileName}
                  </div>
                  <div className="media-library-table-cell media-library-table-cell--type">
                    {row.type}
                  </div>
                  <div className="media-library-table-cell media-library-table-cell--uploaded">
                    {row.uploaded}
                  </div>
                </button>

                <div className="media-library-table-cell media-library-table-cell--visibility">
                  <ObcDropdownButton
                    className="media-library-table__visibility"
                    options={VISIBILITY_OPTIONS}
                    value={row.visibilityValue}
                    type={DropdownButtonType.label}
                    onChange={(event) => {
                      onVisibilityChange(row.id, event.detail.value);
                    }}
                  />
                </div>

                <div className="media-library-table-cell media-library-table-cell--open">
                  <ObcButton
                    className="media-library-table__open-button"
                    variant={ButtonVariant.flat}
                    showLeadingIcon
                    onClick={() => onOpenRow(row.id)}
                  >
                    <span slot="leading-icon">
                      <ObiArrowTopRight />
                    </span>
                    Open
                  </ObcButton>
                </div>

                <div className="media-library-table-cell media-library-table-cell--delete">
                  <ObcIconButton
                    className="media-library-table__delete-button"
                    variant={IconButtonVariant.flat}
                    aria-label="Delete media item"
                    onClick={() => onDeleteRow(row.id)}
                  >
                    <span>
                      <ObiDelete />
                    </span>
                  </ObcIconButton>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MediaLibraryPreview({ row, previewError, onPreviewError }: MediaLibraryPreviewProps) {
  return (
    <aside className="media-library-page__preview-panel" aria-label="Selected media preview">
      <section className="media-library-preview">
        <div className="media-library-preview__header">
          <div className="media-library-preview__title-wrap">
            <h2 className="media-library-preview__title">{row?.fileName ?? "Preview"}</h2>
            <p className="media-library-preview__subtitle">
              {row?.previewDescription ?? "No preview available."}
            </p>
          </div>
        </div>

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
                ? "Preview unavailable. Check that the backend can read the Pirbadet object from S3."
                : "No video preview for this media item."}
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}

export default function MediaLibrary() {
  const [selectedRowId, setSelectedRowId] = useState(DEFAULT_ROW_ID);
  const [mediaRows, setMediaRows] = useState(INITIAL_MEDIA_ROWS);
  const [activeModal, setActiveModal] = useState<MediaLibraryModalMode>(null);
  const [editedFileName, setEditedFileName] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const selectedRow = mediaRows.find((row) => row.id === selectedRowId) ?? mediaRows[0] ?? null;

  const selectRow = (rowId: string) => {
    setSelectedRowId(rowId);
    setPreviewError(false);
  };

  const handleRowVisibilityUpdate = (rowId: string, visibilityValue: string) => {
    handleVisibilityChange(rowId, visibilityValue);
    setMediaRows((currentRows) => updateRowVisibility(currentRows, rowId, visibilityValue));
  };

  const handleEditModalOpen = () => {
    if (!selectedRow) {
      return;
    }

    setEditedFileName(selectedRow.fileName);
    setActiveModal("edit");
  };

  const handleDeleteModalOpen = (rowId: string) => {
    selectRow(rowId);
    setActiveModal("delete");
  };

  const handleModalClose = () => {
    setActiveModal(null);
  };

  const handleEditSave = () => {
    if (!selectedRow) {
      return;
    }

    const nextFileName = editedFileName.trim() || selectedRow.fileName;
    setMediaRows((currentRows) => updateRowFileName(currentRows, selectedRow.id, nextFileName));
    setActiveModal(null);
  };

  const handleDeleteConfirm = () => {
    if (!selectedRow) {
      return;
    }

    handleDeleteMedia(selectedRow.id);
    const nextRows = removeRow(mediaRows, selectedRow.id);
    setMediaRows(nextRows);
    selectRow(getNextSelectedRowId(nextRows));
    setActiveModal(null);
  };

  return (
    <section className="media-library-page">
      <div className="media-library-page__header">
        <h1 className="media-library-page__title">Media Library</h1>
        <p className="media-library-page__subtitle">Something</p>
      </div>

      <div className="media-library-page__workspace">
        <div className="media-library-page__content">
          <div className="media-library-page__left-column">
            <MediaLibraryActions />

            <MediaLibraryTable
              rows={mediaRows}
              selectedRowId={selectedRowId}
              onSelectRow={selectRow}
              onVisibilityChange={handleRowVisibilityUpdate}
              onOpenRow={handleOpenMedia}
              onDeleteRow={handleDeleteModalOpen}
            />

            <ObcButton
              className="media-library-page__edit-button"
              variant={ButtonVariant.normal}
              showLeadingIcon
              onClick={handleEditModalOpen}
            >
              <span slot="leading-icon">
                <ObiEditGoogle />
              </span>
              Edit file name
            </ObcButton>
          </div>

          <MediaLibraryPreview
            row={selectedRow}
            previewError={previewError}
            onPreviewError={() => setPreviewError(true)}
          />
        </div>
      </div>

      {activeModal === "edit" ? (
        <MediaLibraryModal
          title="Edit file name"
          labelledBy="media-library-edit-title"
          icon={<ObiEditGoogle />}
          closeLabel="Close edit file name dialog"
          onClose={handleModalClose}
          actions={
            <>
              <ObcButton variant={ButtonVariant.normal} onClick={handleModalClose}>
                Cancel
              </ObcButton>
              <ObcButton variant={ButtonVariant.raised} onClick={handleEditSave}>
                Save
              </ObcButton>
            </>
          }
        >
          <ObcTextInputField
            label=""
            placeholder="File name"
            value={editedFileName}
            onInput={(event) => {
              const target = event.target as HTMLInputElement;
              setEditedFileName(target.value);
            }}
          />
        </MediaLibraryModal>
      ) : null}

      {activeModal === "delete" && selectedRow ? (
        <MediaLibraryModal
          title="Delete media item"
          labelledBy="media-library-delete-title"
          icon={<ObiDelete />}
          closeLabel="Close delete confirmation dialog"
          onClose={handleModalClose}
          actions={
            <>
              <ObcButton variant={ButtonVariant.normal} onClick={handleModalClose}>
                Cancel
              </ObcButton>
              <ObcButton variant={ButtonVariant.raised} onClick={handleDeleteConfirm}>
                Delete
              </ObcButton>
            </>
          }
        >
          <p className="media-library-page__modal-message">
            Are you sure you want to delete <strong>{selectedRow.fileName}</strong>?
          </p>
        </MediaLibraryModal>
      ) : null}
    </section>
  );
}
