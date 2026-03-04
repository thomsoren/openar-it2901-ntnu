CREATE TABLE IF NOT EXISTS media_assets (
    id VARCHAR(255) PRIMARY KEY,
    asset_name VARCHAR(120) UNIQUE,
    s3_key VARCHAR(1024) NOT NULL UNIQUE,
    media_type VARCHAR(40) NOT NULL DEFAULT 'video',
    visibility VARCHAR(20) NOT NULL DEFAULT 'private',
    owner_user_id TEXT NULL REFERENCES "user"(id) ON DELETE SET NULL,
    group_id VARCHAR(120),
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT media_assets_visibility_check CHECK (visibility IN ('private', 'group', 'public'))
);

CREATE INDEX IF NOT EXISTS ix_media_assets_asset_name ON media_assets (asset_name);
CREATE INDEX IF NOT EXISTS ix_media_assets_s3_key ON media_assets (s3_key);
CREATE INDEX IF NOT EXISTS ix_media_assets_owner_user_id ON media_assets (owner_user_id);
CREATE INDEX IF NOT EXISTS ix_media_assets_group_id ON media_assets (group_id);
