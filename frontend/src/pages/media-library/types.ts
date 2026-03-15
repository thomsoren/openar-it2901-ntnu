import type { ReactNode } from "react";
import type { MediaAnalysisResult, MediaAsset } from "../../services/media";

export interface MediaRow {
  id: string;
  fileName: string;
  type: string;
  uploaded: string;
  visibilityValue: string;
  previewUrl: string | null;
  previewDescription: string;
  asset: MediaAsset;
}

export interface MediaLibraryModalProps {
  title: string;
  labelledBy: string;
  icon: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}

export interface MediaLibraryPreviewProps {
  row: MediaRow | null;
  previewError: boolean;
  onPreviewError: () => void;
  analysisResult: MediaAnalysisResult | null;
}

export type MediaLibraryModalMode = "edit" | "delete" | null;

export const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "group", label: "Group" },
  { value: "public", label: "Public" },
];
