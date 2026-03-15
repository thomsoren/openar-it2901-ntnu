import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { html } from "lit";
import { ref as litRef } from "lit/directives/ref.js";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcTable } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/table/table.js";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { ObcTableCellType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/table/table.js";
import { CheckboxStatus } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/checkbox/checkbox";
import type { ObcTableRow, ObcTableCellDataRegular, ObcTableColumn, ObcTableCellData } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/table/table.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-bar/progress-bar.js";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/tag/tag.js";
import { ObiDelete } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-delete";
import { ObiFileDownloadGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-file-download-google";
import { useAuth } from "../../hooks/useAuth";
import {
  type MediaAsset,
  deleteMediaAsset,
  listMediaAssets,
  presignDownload,
  uploadFileToS3Multipart,
} from "../../services/media";
import { explainFetchError } from "../../utils/api-helpers";
import { listStreams, stopStream } from "../../services/streams";
import { removePersistedStreamIds } from "../../hooks/stream-tabs/storage";
import { MediaLibraryModal } from "./MediaLibraryModal";
import { MediaLibraryActions } from "./MediaLibraryActions";
import { MediaLibraryPreview } from "./MediaLibraryPreview";
import { assetToRow } from "./helpers";
import "./MediaLibrary.css";

const MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024; // 300 MB
const UPLOAD_ROW_ID = "__uploading__";

export default function MediaLibrary({ embedded = false }: { embedded?: boolean }) {
  const { session, isSessionPending, authBridgeStatus, authBridgeError, retryAuthBridge } =
    useAuth();
  const storageScope = session?.user?.id ?? "anon";
  const pageClassName = embedded ? "media-library-page media-library-page--embedded" : "media-library-page";

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState("");
  const [activeModal, setActiveModal] = useState<"delete" | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState("");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortUploadRef = useRef<(() => void) | null>(null);
  const uploadProgressRef = useRef(0);

  useEffect(() => {
    return () => {
      abortUploadRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!actionError) return;
    const id = window.setTimeout(() => setActionError(null), 5000);
    return () => window.clearTimeout(id);
  }, [actionError]);

  const mediaRows = useMemo(() => assets.map((a) => assetToRow(a, previewUrls[a.id])), [assets, previewUrls]);
  const selectedRow = mediaRows.find((r) => r.id === selectedRowId) ?? mediaRows[0] ?? null;

  const loadAssets = useCallback(async () => {
    try {
      const data = await listMediaAssets();
      setAssets(data);
      setLoading(false);
      setLoadError(null);
      if (data.length > 0) {
        setSelectedRowId((current) => current || data[0].id);
      }
    } catch (err) {
      setLoading(false);
      setLoadError(explainFetchError(err, "Failed to load assets"));
    }
  }, []);

  useEffect(() => {
    if (!session || authBridgeStatus !== "ready") return;
    const timeoutId = window.setTimeout(() => {
      void loadAssets();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [session, authBridgeStatus, loadAssets]);

  const columns = useMemo((): ObcTableColumn[] => {
    const textCompare = (a: ObcTableCellData, b: ObcTableCellData) =>
      ((a as ObcTableCellDataRegular).text?.toString() ?? "").localeCompare(
        (b as ObcTableCellDataRegular).text?.toString() ?? ""
      );
    return [
      {
        label: "File name",
        key: "fileName",
        sortable: true as const,
        compareFunction: textCompare,
        renderCell: (value: ObcTableCellData, row: ObcTableRow) => {
          const text = (value as ObcTableCellDataRegular).text ?? "";
          if (row.isSystem) {
            return html`<span style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px"><span>${text}</span><obc-tag label="Demo" color="indigo"></obc-tag></span>`;
          }
          return html`<span>${text}</span>`;
        },
      },
      {
        label: "Type",
        key: "type",
        sortable: true as const,
        compareFunction: textCompare,
        renderCell: (_value: ObcTableCellData, row: ObcTableRow) => {
          if (row.id !== UPLOAD_ROW_ID) return html`<span>${(_value as ObcTableCellDataRegular).text}</span>`;
          return html`<obc-progress-bar
            ${litRef((el) => {
              if (!el) return;
              const cell = el.closest(".grid-cell");
              const row = cell?.parentElement;
              if (!cell || !row) return;
              const rowRect = row.getBoundingClientRect();
              const cellRect = cell.getBoundingClientRect();
              const width = rowRect.right - cellRect.left;
              (el as HTMLElement).style.width = `${width}px`;
              (el as HTMLElement).style.position = "absolute";
              (el as HTMLElement).style.left = "0";
            })}
            type="linear"
            mode="determinate"
            .value=${uploadProgressRef.current}
            showValue
            showUnit
          ></obc-progress-bar>`;
        },
      },
      { label: "Live detection", key: "liveDetection" },
      { label: "Has AIS data", key: "hasAisData" },
      { label: "Uploaded", key: "uploaded", sortable: true as const, compareFunction: textCompare },
      { label: "In toolbar", key: "inToolbar" },
    ];
  }, []);

  const tableData: ObcTableRow[] = useMemo(() => {
    const rows: ObcTableRow[] = mediaRows.map((row) => ({
      id: row.id,
      selected: row.id === selectedRowId,
      isSystem: row.asset.is_system,
      fileName: { type: ObcTableCellType.Regular, text: row.fileName, noWrap: true },
      type: { type: ObcTableCellType.Regular, text: row.type },
      liveDetection: { type: ObcTableCellType.Regular, align: "center" as const },
      hasAisData: { type: ObcTableCellType.Regular, align: "center" as const },
      uploaded: { type: ObcTableCellType.Regular, text: row.uploaded },
      inToolbar: { type: ObcTableCellType.Checkbox, status: CheckboxStatus.checked },
    }));
    if (uploadStatus === "uploading") {
      rows.unshift({
        id: UPLOAD_ROW_ID,
        selected: false,
        fileName: { type: ObcTableCellType.Regular, text: `${uploadFileName} (${uploadProgress}%)`, noWrap: true },
        type: { type: ObcTableCellType.Regular, text: "", cssPart: "upload-progress-cell" },
      });
    }
    return rows;
  }, [mediaRows, selectedRowId, uploadStatus, uploadFileName, uploadProgress]);

  // ── Loading / auth states ──────────────────────────────────────────────────

  if (isSessionPending || authBridgeStatus === "loading") {
    return (
      <section className={pageClassName}>
        {!embedded && (
          <div className="media-library-page__header">
            <h1 className="media-library-page__title">Media library</h1>
            <p className="media-library-page__subtitle">Loading…</p>
          </div>
        )}
        {embedded && <p className="media-library-page__subtitle">Loading…</p>}
      </section>
    );
  }

  if (!session) {
    return (
      <section className={pageClassName}>
        {!embedded && (
          <div className="media-library-page__header">
            <h1 className="media-library-page__title">Media library</h1>
            <p className="media-library-page__subtitle">Sign in to view your media library.</p>
          </div>
        )}
        {embedded && <p className="media-library-page__subtitle">Sign in to view your media library.</p>}
      </section>
    );
  }

  if (authBridgeStatus === "error") {
    return (
      <section className={pageClassName}>
        {!embedded && (
          <div className="media-library-page__header">
            <h1 className="media-library-page__title">Media library</h1>
            <p className="media-library-page__subtitle">
              {authBridgeError || "Authentication bridge failed."}
            </p>
          </div>
        )}
        {embedded && (
          <p className="media-library-page__subtitle">
            {authBridgeError || "Authentication bridge failed."}
          </p>
        )}
        <ObcButton variant={ButtonVariant.normal} onClick={retryAuthBridge}>
          Retry
        </ObcButton>
      </section>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  const selectRow = (rowId: string) => {
    setSelectedRowId(rowId);
    setPreviewError(false);

    if (!previewUrls[rowId]) {
      const row = mediaRows.find((r) => r.id === rowId);
      if (row && row.type === "video") {
        void presignDownload(row.asset.transcoded_s3_key ?? row.asset.s3_key)
          .then(({ url }) => {
            setPreviewUrls((prev) => ({ ...prev, [rowId]: url }));
          })
          .catch((err) => {
            setActionError(explainFetchError(err, "Failed to load preview"));
          });
      }
    }
  };

  const handleOpenRow = async (rowId: string) => {
    const row = mediaRows.find((r) => r.id === rowId);
    if (!row) return;
    try {
      const { url } = await presignDownload(row.asset.s3_key);
      window.open(url, "_blank");
    } catch (err) {
      setActionError(explainFetchError(err, "Failed to generate view URL"));
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
      setActiveModal(null);
    } catch (err) {
      setActionError(explainFetchError(err, "Delete failed"));
    }
  };

  const handleModalClose = () => {
    setActiveModal(null);
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("video/")) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setActionError(
        `File is ${(file.size / 1024 / 1024).toFixed(0)} MB. Maximum allowed is 300 MB.`
      );
      return;
    }
    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadFileName(file.name);

    void uploadFileToS3Multipart(
      file,
      "private",
      (pct) => {
        uploadProgressRef.current = pct;
        setUploadProgress(pct);
      },
      (abortFn) => {
        abortUploadRef.current = abortFn;
      }
    )
      .then(() => {
        abortUploadRef.current = null;
        setUploadStatus("done");
        setUploadFileName("");
        void loadAssets();
      })
      .catch((err) => {
        abortUploadRef.current = null;
        setUploadStatus("error");
        setUploadFileName("");
        setActionError(explainFetchError(err, "Upload failed"));
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
    <section className={pageClassName}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      {!embedded && (
        <div className="media-library-page__header">
          <h1 className="media-library-page__title">Media library</h1>
          <p className="media-library-page__subtitle">
            Manage your own uploads and who can see what.
            {uploadStatus === "done" && " — Upload complete!"}
            {uploadStatus === "error" && " — Upload failed."}
            {loadError && ` — ${loadError}`}
            {actionError && ` — ${actionError}`}
          </p>
        </div>
      )}

      {embedded && (uploadStatus === "done" || uploadStatus === "error" || loadError || actionError) && (
        <p className="media-library-page__subtitle">
          {uploadStatus === "done" && "Upload complete!"}
          {uploadStatus === "error" && "Upload failed."}
          {loadError && loadError}
          {actionError && actionError}
        </p>
      )}

      <div className="media-library-page__content">
        <div className="media-library-page__left-column">
          <MediaLibraryActions
            onBrowse={handleBrowse}
            onDrop={handleDrop}
            isDragActive={isDragActive}
            setIsDragActive={setIsDragActive}
          />

          {!loading && mediaRows.length === 0 ? (
            <div className="media-library-page__empty-state">
              <div className="media-library-page__empty-icon">
                <ObiFileDownloadGoogle />
              </div>
              <div className="media-library-page__empty-text">
                <p className="media-library-page__empty-title">Library is empty</p>
                <p className="media-library-page__empty-subtitle">Connect stream or upload file</p>
              </div>
            </div>
          ) : (
            <div className="media-library-page__table-panel">
              <ObcTable
                data={tableData}
                columns={columns}
                striped
                onRowClick={(e: CustomEvent<{ row: ObcTableRow }>) => {
                  if (e.detail.row.id !== UPLOAD_ROW_ID) selectRow(e.detail.row.id);
                }}
                onCellButtonClick={(e: CustomEvent<{ rowId: string; columnKey: string }>) => {
                  if (e.detail.columnKey === "open") void handleOpenRow(e.detail.rowId);
                }}
              />
            </div>
          )}
        </div>

        <MediaLibraryPreview
          row={selectedRow}
          previewError={previewError}
          onPreviewError={() => setPreviewError(true)}
          onDelete={() => selectedRow && setActiveModal("delete")}
        />
      </div>

      {activeModal === "delete" && selectedRow ? (
        <MediaLibraryModal
          title="Delete"
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
          <p className="media-library-page__modal-heading">Are you sure?</p>
          <p className="media-library-page__modal-message">{selectedRow.fileName}</p>
        </MediaLibraryModal>
      ) : null}
    </section>
  );
}
