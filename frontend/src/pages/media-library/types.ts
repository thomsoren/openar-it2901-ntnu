import type { ReactNode } from "react";
import type { MediaAsset } from "../../services/media";

export interface MediaRow {
  id: string;
  fileName: string;
  type: string;
  uploaded: string;
  previewUrl: string | null;
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
  onDelete?: () => void;
}
