-- Seed Pirbadet fusion assets used by AR Fusion tab.
-- Source of truth is media_assets (Postgres), not env/local file paths.
-- This migration is idempotent and handles pre-existing rows by unique s3_key.

-- If asset names already exist, normalize them to expected keys.
UPDATE media_assets
SET
  s3_key = 'videos/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/Pirbadet-edited.mp4',
  media_type = 'video',
  visibility = 'public',
  is_system = true,
  updated_at = NOW()
WHERE asset_name = 'fusion_video_pirbadet';

UPDATE media_assets
SET
  s3_key = 'ais/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/Pirbadet.ndjson',
  media_type = 'data',
  visibility = 'public',
  is_system = true,
  updated_at = NOW()
WHERE asset_name = 'fusion_ais_pirbadet';

-- Upsert by unique s3_key so existing rows are reused and renamed as needed.
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
VALUES
  (
    '9c884cf4-8b91-4f84-9d17-9472d67f5a7f',
    'fusion_video_pirbadet',
    'videos/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/Pirbadet-edited.mp4',
    'video',
    'public',
    true,
    NOW(),
    NOW()
  ),
  (
    'b8b8a53f-0285-4629-8b44-e1971306f0b7',
    'fusion_ais_pirbadet',
    'ais/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/Pirbadet.ndjson',
    'data',
    'public',
    true,
    NOW(),
    NOW()
  )
ON CONFLICT (s3_key) DO UPDATE
SET
  asset_name = EXCLUDED.asset_name,
  media_type = EXCLUDED.media_type,
  visibility = EXCLUDED.visibility,
  is_system = EXCLUDED.is_system,
  updated_at = NOW();
