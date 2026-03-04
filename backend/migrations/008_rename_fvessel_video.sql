-- Consolidate duplicate video assets to a single canonical key.
-- hurtigruta-demo.mp4 and 2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4
-- are the same video; both renamed to fvessel/segment-001/fvessel.mp4.
--
-- Also drops the unnecessary UNIQUE constraint on s3_key so multiple
-- named assets can reference the same physical file.

ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_s3_key_key;

UPDATE media_assets
SET s3_key = 'fvessel/segment-001/fvessel.mp4', updated_at = NOW()
WHERE asset_name IN ('video', 'fusion_video');
