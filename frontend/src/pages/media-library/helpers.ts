import type { MediaAsset } from "../../services/media";
import type { MediaRow } from "./types";

export function assetToRow(asset: MediaAsset, previewUrl?: string): MediaRow {
  const fileName = asset.asset_name ?? asset.s3_key.split("/").pop() ?? asset.s3_key;
  return {
    id: asset.id,
    fileName,
    type: asset.media_type,
    uploaded: new Date(asset.created_at).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    previewUrl: previewUrl ?? null,
    asset,
  };
}
