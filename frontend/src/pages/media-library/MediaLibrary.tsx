import { useCallback, useEffect, useRef, useState } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcTable } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/table/table.js";
import { ObcTextInputField } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/text-input-field/text-input-field";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { DropdownButtonType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/dropdown-button/dropdown-button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { ObcTableCellType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/table/table.js";
import type { ObcTableRow } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/table/table.js";
import { html } from "lit";
import "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-arrow-top-right";
import { ObiDelete } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-delete";
import { ObiEditGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-edit-google";
import { useAuth } from "../../hooks/useAuth";
import {
  type MediaAsset,
  type MediaAnalysisResult,
  type MediaVisibility,
  deleteMediaAsset,
  getMediaAnalysisResult,
  listMediaAssets,
  presignDownload,
  renameMediaAsset,
  updateVisibility,
  uploadFileToS3Multipart,
} from "../../services/media";
import { listStreams, stopStream } from "../../services/streams";
import { removePersistedStreamIds } from "../../hooks/stream-tabs/storage";
import { MediaLibraryModal } from "./MediaLibraryModal";
import { MediaLibraryActions } from "./MediaLibraryActions";
import { MediaLibraryPreview } from "./MediaLibraryPreview";
import { assetToRow } from "./helpers";
import { VISIBILITY_OPTIONS } from "./types";
import type { MediaLibraryModalMode } from "./types";
import "./MediaLibrary.css";

export default function MediaLibrary() {
  const { session, isSessionPending, authBridgeStatus, authBridgeError, retryAuthBridge, isAdmin } =
    useAuth();
  const storageScope = session?.user?.id ?? "anon";

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState("");
  const [activeModal, setActiveModal] = useState<MediaLibraryModalMode>(null);
  const [editedFileName, setEditedFileName] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [analysisResults, setAnalysisResults] = useState<
    Record<string, MediaAnalysisResult | null>
  >({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortUploadRef = useRef<(() => void) | null>(null);

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

  const visibilityOptions = isAdmin
    ? VISIBILITY_OPTIONS
    : VISIBILITY_OPTIONS.filter((o) => o.value !== "public");
  const mediaRows = assets.map((a) => assetToRow(a, previewUrls[a.id]));
  const selectedRow = mediaRows.find((r) => r.id === selectedRowId) ?? mediaRows[0] ?? null;
  const selectedAsset =
    assets.find((asset) => asset.id === selectedRow?.id) ?? selectedRow?.asset ?? null;
  const selectedAnalysisResult =
    selectedAsset && selectedAsset.analysis?.status === "completed"
      ? (analysisResults[selectedAsset.id] ?? null)
      : null;

  const loadAssets = useCallback(async () => {
    try {
      const data = await listMediaAssets();
      setAssets(data);
      setLoadError(null);
      if (data.length > 0) {
        setSelectedRowId((current) => current || data[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load assets");
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

  useEffect(() => {
    if (!selectedAsset) {
      return;
    }
    const status = selectedAsset.analysis?.status;
    if (status !== "queued" && status !== "processing") {
      return;
    }
    const intervalId = window.setInterval(() => {
      void loadAssets();
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [loadAssets, selectedAsset]);

  useEffect(() => {
    if (!selectedAsset || selectedAsset.analysis?.status !== "completed") {
      return;
    }
    let cancelled = false;
    void getMediaAnalysisResult(selectedAsset.id)
      .then((result) => {
        if (!cancelled) {
          setAnalysisResults((prev) => ({ ...prev, [selectedAsset.id]: result }));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setActionError(err instanceof Error ? err.message : "Failed to load analysis result");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.analysis?.completed_at, selectedAsset?.analysis?.status, selectedAsset?.id]);

  useEffect(() => {
    if (!selectedAsset?.analysis) {
      return;
    }
    console.info("Uploaded video analysis status", {
      assetId: selectedAsset.id,
      status: selectedAsset.analysis.status,
      error: selectedAsset.analysis.error_message,
    });
  }, [selectedAsset?.analysis?.error_message, selectedAsset?.analysis?.status, selectedAsset?.id]);

  // ── Loading / auth states ──────────────────────────────────────────────────

  if (isSessionPending || authBridgeStatus === "loading") {
    return (
      <section className="media-library-page">
        <div className="media-library-page__header">
          <h1 className="media-library-page__title">Media library</h1>
          <p className="media-library-page__subtitle">Loading…</p>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="media-library-page">
        <div className="media-library-page__header">
          <h1 className="media-library-page__title">Media library</h1>
          <p className="media-library-page__subtitle">Sign in to view your media library.</p>
        </div>
      </section>
    );
  }

  if (authBridgeStatus === "error") {
    return (
      <section className="media-library-page">
        <div className="media-library-page__header">
          <h1 className="media-library-page__title">Media library</h1>
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

    if (!previewUrls[rowId]) {
      const row = mediaRows.find((r) => r.id === rowId);
      if (row && row.type === "video") {
        void presignDownload(row.asset.s3_key)
          .then(({ url }) => {
            setPreviewUrls((prev) => ({ ...prev, [rowId]: url }));
          })
          .catch((err) => {
            setActionError(err instanceof Error ? err.message : "Failed to load preview");
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
      setActionError(err instanceof Error ? err.message : "Failed to generate view URL");
    }
  };

  const handleVisibilityChange = async (rowId: string, visibilityValue: string) => {
    const row = mediaRows.find((r) => r.id === rowId);
    if (!row) return;
    try {
      const updated = await updateVisibility(row.asset.id, visibilityValue as MediaVisibility);
      setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update visibility");
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
      setAnalysisResults((prev) => {
        const next = { ...prev };
        delete next[selectedRow.asset.id];
        return next;
      });
      const remaining = assets.filter((a) => a.id !== selectedRow.asset.id);
      setSelectedRowId(remaining[0]?.id ?? "");
      setActiveModal(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleDeleteModalOpen = (rowId: string) => {
    selectRow(rowId);
    setActiveModal("delete");
  };

  const handleEditModalOpen = () => {
    if (!selectedRow) return;
    setEditedFileName(selectedRow.fileName);
    setActiveModal("edit");
  };

  const handleModalClose = () => {
    setActiveModal(null);
  };

  const handleEditSave = async () => {
    if (!selectedRow || !editedFileName.trim()) return;
    try {
      const updated = await renameMediaAsset(selectedRow.asset.id, editedFileName.trim());
      setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setActiveModal(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rename failed");
    }
  };

  const MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024; // 300 MB

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

    void uploadFileToS3Multipart(
      file,
      "private",
      (pct) => setUploadProgress(pct),
      (abortFn) => {
        abortUploadRef.current = abortFn;
      },
      undefined,
      "analysis"
    )
      .then(() => {
        abortUploadRef.current = null;
        setUploadStatus("done");
        void loadAssets();
      })
      .catch((err) => {
        abortUploadRef.current = null;
        setUploadStatus("error");
        setActionError(err instanceof Error ? err.message : "Upload failed");
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

  // ── Table config ──────────────────────────────────────────────────────────

  const columns = [
    { label: "File name", key: "fileName", dividerRight: true },
    { label: "Type", key: "type", dividerRight: true },
    { label: "Uploaded", key: "uploaded", dividerRight: true },
    {
      label: "Visibility",
      key: "visibility",
      renderCell: (_value: unknown, _row: unknown, rowId: string) => {
        const mediaRow = mediaRows.find((r) => r.id === rowId);
        return html`<obc-dropdown-button
          .options=${visibilityOptions}
          .value=${mediaRow?.visibilityValue ?? "private"}
          .type=${DropdownButtonType.label}
          @click=${(e: Event) => e.stopPropagation()}
          @change=${(e: CustomEvent<{ value: string }>) => {
            e.stopPropagation();
            void handleVisibilityChange(rowId, e.detail.value);
          }}
        ></obc-dropdown-button>`;
      },
    },
    { label: "", key: "open" },
    {
      label: "",
      key: "delete",
      renderCell: (_value: unknown, _row: unknown, rowId: string) => {
        return html`<obc-icon-button
          variant=${IconButtonVariant.flat}
          aria-label="Delete media item"
          @click=${(e: Event) => {
            e.stopPropagation();
            handleDeleteModalOpen(rowId);
          }}
          ><obi-delete></obi-delete
        ></obc-icon-button>`;
      },
    },
  ];

  const tableData: ObcTableRow[] = mediaRows.map((row) => ({
    id: row.id,
    selected: row.id === (selectedRow?.id ?? ""),
    fileName: { type: ObcTableCellType.Regular, text: row.fileName, noWrap: true },
    type: { type: ObcTableCellType.Regular, text: row.type },
    uploaded: { type: ObcTableCellType.Regular, text: row.uploaded },
    visibility: { type: ObcTableCellType.Regular, text: row.visibilityValue },
    open: {
      type: ObcTableCellType.Button,
      text: "Open",
      icon: html`<obi-arrow-top-right></obi-arrow-top-right>`,
    },
    delete: { type: ObcTableCellType.Regular },
  }));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="media-library-page">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />

      <div className="media-library-page__header">
        <h1 className="media-library-page__title">Media library</h1>
        <p className="media-library-page__subtitle">
          Manage your own uploads and who can see what.
          {uploadStatus === "uploading" && ` — Uploading… ${uploadProgress}%`}
          {uploadStatus === "done" && " — Upload complete!"}
          {uploadStatus === "error" && " — Upload failed."}
          {loadError && ` — ${loadError}`}
          {actionError && ` — ${actionError}`}
        </p>
      </div>

      <MediaLibraryActions
        onBrowse={handleBrowse}
        onDrop={handleDrop}
        isDragActive={isDragActive}
        setIsDragActive={setIsDragActive}
      />

      <div className="media-library-page__content">
        <div className="media-library-page__left-column">
          <div className="media-library-page__table-panel">
            {mediaRows.length === 0 ? (
              <div className="media-library-page__table-empty">No media assets found.</div>
            ) : (
              <ObcTable
                data={tableData}
                columns={columns}
                onRowClick={(e: CustomEvent<{ row: ObcTableRow }>) => selectRow(e.detail.row.id)}
                onCellButtonClick={(e: CustomEvent<{ rowId: string; columnKey: string }>) => {
                  if (e.detail.columnKey === "open") void handleOpenRow(e.detail.rowId);
                }}
              />
            )}
          </div>

          <div className="media-library-page__action-container">
            <ObcButton
              variant={ButtonVariant.normal}
              showLeadingIcon
              disabled={!selectedRow}
              onClick={handleEditModalOpen}
            >
              <span slot="leading-icon">
                <ObiEditGoogle />
              </span>
              Edit file name
            </ObcButton>
          </div>
        </div>

        <MediaLibraryPreview
          row={selectedRow}
          previewError={previewError}
          onPreviewError={() => setPreviewError(true)}
          analysisResult={selectedAnalysisResult}
        />
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
              <ObcButton variant={ButtonVariant.raised} onClick={() => void handleEditSave()}>
                Save
              </ObcButton>
            </>
          }
        >
          <div
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleEditSave();
            }}
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
          </div>
        </MediaLibraryModal>
      ) : null}

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
