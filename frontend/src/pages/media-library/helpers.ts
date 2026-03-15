import type { MediaAsset } from "../../services/media";
import type { MediaRow } from "./types";

export function assetToRow(asset: MediaAsset, previewUrl?: string): MediaRow {
  const fileName = asset.asset_name ?? asset.s3_key.split("/").pop() ?? asset.s3_key;
  const isVideo = asset.media_type === "video";
  return {
    id: asset.id,
    fileName,
    type: asset.media_type,
    uploaded: new Date(asset.created_at).toLocaleDateString(),
    visibilityValue: asset.visibility,
    analysisStatus: asset.analysis?.status ?? null,
    previewUrl: previewUrl ?? null,
    previewDescription: isVideo
      ? "Select to preview this video."
      : `${asset.media_type} files do not have a direct video preview.`,
    asset,
  };
}
