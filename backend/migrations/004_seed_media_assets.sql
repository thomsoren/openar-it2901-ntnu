-- Seed default media assets for development
-- These are system assets that should be available on all instances

INSERT INTO media_assets (id, asset_name, s3_key, media_type, visibility, is_system, created_at, updated_at)
VALUES
  -- Demo video
  ('da068ed7-faad-4cb1-ab05-fbe5d3c19d66', 'video', 'video/hurtigruta-demo.mp4', 'video', 'public', true, NOW(), NOW()),

  -- FVessel fusion video
  ('b5e92a25-66b3-4bca-aeb8-353304d7ff8a', 'fusion_video', 'fvessel/segment-001/2022_05_10_19_22_05_2022_05_10_19_25_04_b.mp4', 'video', 'public', true, NOW(), NOW()),

  -- Background image for components
  ('853a2d31-4721-480d-a849-c6ddc1517b89', 'components_background', 'image/oceanbackground.png', 'image', 'public', true, NOW(), NOW()),

  -- Detection JSON data
  ('c5754719-7851-4073-8390-88a3fbf55a4e', 'detections', 'detection/detections_yolo.json', 'data', 'public', true, NOW(), NOW()),

  -- Ground truth fusion data
  ('e8bf3012-757e-45ed-b1ca-ea0b482958eb', 'gt_fusion', 'fvessel/segment-001/Video-01_gt_fusion.txt', 'data', 'public', true, NOW(), NOW()),

  -- AIS CSV data
  ('ce202b91-030c-4886-a520-56f34a39235a', 'ais', 'fvessel/segment-001/ais.csv', 'data', 'public', true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
