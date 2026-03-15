-- Add fusion flag and AIS data path to media_assets.
-- fusion=true means the asset has pre-fused AIS NDJSON available at ais_data_path.

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS fusion BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS ais_data_path VARCHAR(1024);

-- Mark the Gunnerus fusion video with its corresponding AIS NDJSON S3 key.
UPDATE media_assets
SET
    fusion = TRUE,
    ais_data_path = 'ais-data/gunnerus_clip_projected_new.ndjson',
    updated_at = NOW()
WHERE asset_name = 'fusion_video_gunnerus';
