-- Enforce a single canonical Fusion AIS asset mapping (no alias fallback).
-- Source of truth is media_assets in Postgres and S3 key under openar/.

DELETE FROM media_assets
WHERE asset_name = 'fusion_ais';

UPDATE media_assets
SET
  s3_key = 'ais-data/fusion-trondheim/Pirbadet.ndjson',
  media_type = 'data',
  visibility = 'public',
  is_system = true,
  updated_at = NOW()
WHERE asset_name = 'fusion_ais_pirbadet';

INSERT INTO media_assets (
  id,
  asset_name,
  s3_key,
  media_type,
  visibility,
  is_system,
  created_at,
  updated_at
)
VALUES (
  'b8b8a53f-0285-4629-8b44-e1971306f0b7',
  'fusion_ais_pirbadet',
  'ais-data/fusion-trondheim/Pirbadet.ndjson',
  'data',
  'public',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (asset_name) DO UPDATE
SET
  s3_key = EXCLUDED.s3_key,
  media_type = EXCLUDED.media_type,
  visibility = EXCLUDED.visibility,
  is_system = EXCLUDED.is_system,
  updated_at = NOW();
