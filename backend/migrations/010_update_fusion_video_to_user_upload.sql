-- Use the user-uploaded fvessel video for Mock data tab.
-- S3 key from: videos/private/default-group/.../manual/2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4

UPDATE media_assets
SET s3_key = 'videos/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4',
    updated_at = NOW()
WHERE asset_name = 'fusion_video';
