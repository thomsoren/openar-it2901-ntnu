-- Fix fusion video assets that have API URLs stored as s3_key instead of real S3 paths.
-- Run this if fusion stream fails with "API URL stored as S3 key".

-- Reset fusion_video to default S3 path when s3_key looks like an API URL
UPDATE media_assets
SET s3_key = 'fvessel/segment-001/2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4',
    updated_at = NOW()
WHERE asset_name = 'fusion_video'
  AND (s3_key LIKE 'http%' OR s3_key LIKE '%/api/%' OR s3_key LIKE '%api.demo%');

-- Reset fusion_video_pirbadet if it exists and has wrong key
-- Adjust the path below to match your actual Pirbadet video in S3
UPDATE media_assets
SET s3_key = 'fvessel/segment-001/2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4',
    updated_at = NOW()
WHERE asset_name = 'fusion_video_pirbadet'
  AND (s3_key LIKE 'http%' OR s3_key LIKE '%/api/%' OR s3_key LIKE '%api.demo%');
