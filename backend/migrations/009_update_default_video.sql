-- Use a dedicated video for the default (real-time CV) stream.
-- Previously both 'video' and 'fusion_video' pointed to the same fvessel.mp4
-- key, which caused media-library deduplication to hide one of them and
-- prevented both streams from being configured independently.
--
-- 'fusion_video' keeps fvessel/segment-001/fvessel.mp4 (fusion mock).
-- 'video' is updated to the MVI1481VIS recording for real-time CV.

UPDATE media_assets
SET s3_key    = 'videos/private/default-group/HuWS2pHe8cZeuro8llQ2bGOdacTv4GsJ/manual/MVI1481VIS.mp4',
    updated_at = NOW()
WHERE asset_name = 'video';
