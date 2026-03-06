import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
import { useAuth } from "../hooks/useAuth";
import {
  type MediaAsset,
  type MediaVisibility,
  deleteMediaAsset,
  listMediaAssets,
  presignDownload,
  updateVisibility,
  uploadFileToS3Multipart,
} from "../services/media";
import { listStreams, stopStream } from "../services/streams";
import { removePersistedStreamIds } from "../hooks/stream-tabs/storage";
import "./MediaLibrary.css";

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaRow {
  id: string;
  fileName: string;
  type: string;
  uploaded: string;
  visibilityValue: string;
  previewUrl: string | null;
  previewDescription: string;
  asset: MediaAsset;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function assetToRow(asset: MediaAsset): MediaRow {
  const fileName = asset.s3_key.split("/").pop() || asset.s3_key;
  const isVideo = asset.media_type === "video";
  return {
    id: asset.id,
    fileName,
    type: asset.media_type,
    uploaded: new Date(asset.created_at).toLocaleDateString(),
    visibilityValue: asset.visibility,
    previewUrl: null,
    previewDescription: isVideo
      ? "Select to preview this video."
      : `${asset.media_type} files do not have a direct video preview.`,
    asset,
  };
}

// ── Sub-components ───────────────────────────────────────────────────────────

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

function MediaLibraryActions({
  onBrowse,
  onDrop,
  isDragActive,
  setIsDragActive,
}: {
  onBrowse: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragActive: boolean;
  setIsDragActive: (active: boolean) => void;
}) {
  return (
    <div className="media-library-page__actions">
      <div className="media-library-page__action-slot">
        <ObcRichButton
          className="media-library-rich-button"
          label="Connect live stream"
          description="Start a new live stream using your own media"
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
          description="Supported formats: .mp4, .mov"
          direction={RichButtonDirection.Horizontal}
          hasTrailingIcon
          fullHeight
          fullWidth
          onClick={onBrowse}
        >
          <ObiWidgetAddGoogle slot="trailing-icon" />
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
          {rows.length === 0 && (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--media-library-text-secondary)",
              }}
            >
              No media assets found.
            </div>
          )}
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
                ? "Preview unavailable. The video may not be accessible."
                : "Select a video asset to preview."}
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MediaLibrary() {
  const { session, isSessionPending, authBridgeStatus, authBridgeError, retryAuthBridge } =
    useAuth();
  const storageScope = session?.user?.id ?? "anon";

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState("");
  const [activeModal, setActiveModal] = useState<MediaLibraryModalMode>(null);
  const [editedFileName, setEditedFileName] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortUploadRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      abortUploadRef.current?.();
    };
  }, []);

  const mediaRows = assets.map(assetToRow);
  const selectedRow = mediaRows.find((r) => r.id === selectedRowId) ?? mediaRows[0] ?? null;

  const loadAssets = useCallback(async () => {
    try {
      const data = await listMediaAssets();
      setAssets(data);
      setLoadError(null);
      if (data.length > 0 && !selectedRowId) {
        setSelectedRowId(data[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load assets");
    }
  }, [selectedRowId]);

  useEffect(() => {
    if (!session || authBridgeStatus !== "ready") return;
    const timeoutId = window.setTimeout(() => {
      void loadAssets();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [session, authBridgeStatus, loadAssets]);

  // ── Loading / auth states ──────────────────────────────────────────────────

  if (isSessionPending || authBridgeStatus === "loading") {
    return (
      <section className="media-library-page">
        <div className="media-library-page__header">
          <h1 className="media-library-page__title">Media Library</h1>
          <p className="media-library-page__subtitle">Loading…</p>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="media-library-page">
        <div className="media-library-page__header">
          <h1 className="media-library-page__title">Media Library</h1>
          <p className="media-library-page__subtitle">Sign in to view your media library.</p>
        </div>
      </section>
    );
  }

  if (authBridgeStatus === "error") {
    return (
      <section className="media-library-page">
        <div className="media-library-page__header">
          <h1 className="media-library-page__title">Media Library</h1>
          <p className="media-library-page__subtitle">
            {authBridgeError || "Authentication bridge failed."}
          </p>
          <ObcButton variant={ButtonVariant.normal} onClick={retryAuthBridge}>
            Retry
          </ObcButton>
        </div>
      </section>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  const selectRow = (rowId: string) => {
    setSelectedRowId(rowId);
    setPreviewError(false);
  };

  const handleOpenRow = async (rowId: string) => {
    const row = mediaRows.find((r) => r.id === rowId);
    if (!row) return;
    try {
      const { url } = await presignDownload(row.asset.s3_key);
      window.open(url, "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to generate view URL");
    }
  };

  const handleVisibilityChange = async (rowId: string, visibilityValue: string) => {
    const row = mediaRows.find((r) => r.id === rowId);
    if (!row) return;
    try {
      const updated = await updateVisibility(row.asset.id, visibilityValue as MediaVisibility);
      setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update visibility");
    }
  };

  const streamSourceUsesAssetKey = (sourceUrl: string, assetKey: string): boolean => {
    const normalizedKey = assetKey.replace(/^\/+/, "");
    if (!normalizedKey) return false;
    if (sourceUrl.startsWith(`s3://${normalizedKey}`)) return true;
    try {
      const parsed = new URL(sourceUrl);
      const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
      return path.endsWith(normalizedKey) || path.includes(`/${normalizedKey}`);
    } catch {
      return sourceUrl.includes(normalizedKey);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedRow) return;
    try {
      const streams = await listStreams().catch(() => []);
      await deleteMediaAsset(selectedRow.asset.id);
      const affectedStreamIds = streams
        .filter((stream) => streamSourceUsesAssetKey(stream.source_url, selectedRow.asset.s3_key))
        .map((stream) => stream.stream_id);
      if (affectedStreamIds.length > 0) {
        await Promise.all(
          affectedStreamIds.map(async (streamId) => {
            try {
              await stopStream(streamId);
            } catch {
              // Ignore stop failures during cleanup.
            }
          })
        );
        removePersistedStreamIds(affectedStreamIds, storageScope);
      }
      setAssets((prev) => prev.filter((a) => a.id !== selectedRow.asset.id));
      const remaining = assets.filter((a) => a.id !== selectedRow.asset.id);
      setSelectedRowId(remaining[0]?.id ?? "");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
    setActiveModal(null);
  };

  const handleEditModalOpen = () => {
    if (!selectedRow) return;
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
    // TODO: Wire up rename API when available.
    setActiveModal(null);
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("video/")) return;
    setUploadStatus("uploading");
    setUploadProgress(0);

    void uploadFileToS3Multipart(
      file,
      "private",
      (pct) => setUploadProgress(pct),
      (abortFn) => {
        abortUploadRef.current = abortFn;
      }
    )
      .then(() => {
        abortUploadRef.current = null;
        setUploadStatus("done");
        void loadAssets();
      })
      .catch(() => {
        abortUploadRef.current = null;
        setUploadStatus("error");
      });
  };

  const handleBrowse = () => fileInputRef.current?.click();

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    if (e.target) e.target.value = "";
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="media-library-page">
      <div className="media-library-page__header">
        <h1 className="media-library-page__title">Media Library</h1>
        <p className="media-library-page__subtitle">
          Manage your media assets
          {uploadStatus === "uploading" && ` — Uploading… ${uploadProgress}%`}
          {uploadStatus === "done" && " — Upload complete!"}
          {uploadStatus === "error" && " — Upload failed."}
          {loadError && ` — ${loadError}`}
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      <div className="media-library-page__workspace">
        <div className="media-library-page__content">
          <div className="media-library-page__left-column">
            <MediaLibraryActions
              onBrowse={handleBrowse}
              onDrop={handleDrop}
              isDragActive={isDragActive}
              setIsDragActive={setIsDragActive}
            />

            <MediaLibraryTable
              rows={mediaRows}
              selectedRowId={selectedRow?.id ?? ""}
              onSelectRow={selectRow}
              onVisibilityChange={(rowId, val) => void handleVisibilityChange(rowId, val)}
              onOpenRow={(rowId) => void handleOpenRow(rowId)}
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
              <ObcButton variant={ButtonVariant.raised} onClick={() => void handleDeleteConfirm()}>
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
