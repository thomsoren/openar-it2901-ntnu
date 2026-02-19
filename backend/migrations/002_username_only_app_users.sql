-- Migrate existing app_users to username-centric authz model.
-- Run this after 001 in environments with an existing table.

ALTER TABLE app_users
  ALTER COLUMN email DROP NOT NULL;

UPDATE app_users
SET username = CONCAT('user_', SUBSTRING(id FROM 1 FOR 12))
WHERE username IS NULL OR BTRIM(username) = '';

ALTER TABLE app_users
  ALTER COLUMN username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username);
