CREATE TABLE IF NOT EXISTS editor_assets (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
  image TEXT NOT NULL,
  thumbnail TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  name TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS editor_assets_recent ON editor_assets (created_at DESC, hash);

CREATE TABLE IF NOT EXISTS editor_asset_aliases (
  image TEXT PRIMARY KEY,
  hash TEXT NOT NULL REFERENCES editor_assets(hash)
);
