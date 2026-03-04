-- Use demovideomock.mp4 for Fusion Video / Mock data tab.
-- S3 key: videos/private/default-group/.../manual/demovideomock.mp4

UPDATE media_assets
SET s3_key = 'videos/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/demovideomock.mp4',
    updated_at = NOW()
WHERE asset_name = 'fusion_video';
