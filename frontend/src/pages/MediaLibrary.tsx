import { useState } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-arrow-top-right.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/icons/icon-delete.js";
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
import { ObiEditGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-edit-google";
import { ObiLink } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-link";
import { ObiWidgetAddGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-widget-add-google";
import "./MediaLibrary.css";

interface MediaRow {
  id: string;
  fileName: string;
  type: string;
  uploaded: string;
  visibilityValue: string;
}

const handleOpenMedia = () => {
  // TODO: Hook up open action to media preview/details API flow.
};

const handleDeleteMedia = () => {
  // TODO: Hook up delete action to media delete API flow.
};

const handleVisibilityChange = () => {
  // TODO: Hook up visibility change to media visibility API flow.
};

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "group", label: "Group" },
  { value: "public", label: "Public" },
];

const INITIAL_MEDIA_ROWS: MediaRow[] = [
  ["Stream", "private"],
  ["AIS", "private"],
].map(([typeLabel, visibilityValue], index) => ({
  id: `row-${index + 1}`,
  fileName: "File name",
  uploaded: "dd/mm/yyyy",
  type: typeLabel,
  visibilityValue,
}));

function MediaLibrary() {
  const [selectedRowId, setSelectedRowId] = useState("row-2");
  const [mediaRows, setMediaRows] = useState(INITIAL_MEDIA_ROWS);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editedFileName, setEditedFileName] = useState("");
  const selectedRow = mediaRows.find((row) => row.id === selectedRowId) ?? mediaRows[0];

  const handleVisibilityUpdate = (rowId: string, visibilityValue: string) => {
    // TODO: Hook up visibility change to media visibility API flow.
    handleVisibilityChange();
    setMediaRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, visibilityValue } : row))
    );
  };

  const openEditModal = () => {
    if (!selectedRow) return;
    setEditedFileName(selectedRow.fileName);
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
  };

  const saveEditedFileName = () => {
    if (!selectedRow) return;
    // TODO: Hook up edit file name action to media rename API flow.
    setMediaRows((currentRows) =>
      currentRows.map((row) =>
        row.id === selectedRow.id
          ? { ...row, fileName: editedFileName.trim() || row.fileName }
          : row
      )
    );
    setIsEditModalOpen(false);
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
                  {mediaRows.map((row) => {
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
                          onClick={() => setSelectedRowId(row.id)}
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
                              handleVisibilityUpdate(row.id, event.detail.value);
                            }}
                          />
                        </div>
                        <div className="media-library-table-cell media-library-table-cell--open">
                          <ObcButton
                            className="media-library-table__open-button"
                            variant={ButtonVariant.flat}
                            showLeadingIcon
                            onClick={() => handleOpenMedia()}
                          >
                            <span slot="leading-icon">
                              <obi-arrow-top-right></obi-arrow-top-right>
                            </span>
                            Open
                          </ObcButton>
                        </div>
                        <div className="media-library-table-cell media-library-table-cell--delete">
                          <ObcIconButton
                            className="media-library-table__delete-button"
                            variant={IconButtonVariant.flat}
                            aria-label="Delete media item"
                            onClick={() => handleDeleteMedia()}
                          >
                            <span>
                              <obi-delete></obi-delete>
                            </span>
                          </ObcIconButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <ObcButton
              className="media-library-page__edit-button"
              variant={ButtonVariant.normal}
              showLeadingIcon
              onClick={openEditModal}
            >
              <span slot="leading-icon">
                <ObiEditGoogle />
              </span>
              Edit file name
            </ObcButton>
          </div>
        </div>
      </div>

      {isEditModalOpen ? (
        <div className="media-library-page__modal-layer" role="presentation">
          <div className="media-library-page__modal-backdrop" />
          <div
            className="media-library-page__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-library-edit-title"
          >
            <div className="media-library-page__modal-header">
              <div className="media-library-page__modal-title-wrap">
                <ObiEditGoogle />
                <h2 id="media-library-edit-title" className="media-library-page__modal-title">
                  Edit file name
                </h2>
              </div>
              <ObcIconButton
                className="media-library-page__modal-close"
                variant={IconButtonVariant.flat}
                aria-label="Close edit file name dialog"
                onClick={closeEditModal}
              >
                <ObiCloseGoogle />
              </ObcIconButton>
            </div>
            <div className="media-library-page__modal-divider" />
            <div className="media-library-page__modal-content">
              <ObcTextInputField
                label=""
                placeholder="File name"
                value={editedFileName}
                onInput={(event) => {
                  const target = event.target as HTMLInputElement;
                  setEditedFileName(target.value);
                }}
              />
            </div>
            <div className="media-library-page__modal-footer">
              <ObcButton variant={ButtonVariant.normal} onClick={closeEditModal}>
                Cancel
              </ObcButton>
              <ObcButton variant={ButtonVariant.raised} onClick={saveEditedFileName}>
                Save
              </ObcButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default MediaLibrary;
