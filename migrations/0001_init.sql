-- Portfolio storage: metadata in D1, document bytes in R2.
--
-- Every row carries `owner` (the verified Cloudflare Access email) even though
-- the app is currently single-user, so opening it up to real accounts later is
-- a policy change rather than a schema migration.

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS folders_owner_idx  ON folders(owner);
CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(parent_id);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
  mime       TEXT NOT NULL DEFAULT '',
  size       INTEGER NOT NULL DEFAULT 0,
  caption    TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Key of the object in the R2 bucket.
  r2_key     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS documents_owner_idx  ON documents(owner);
CREATE INDEX IF NOT EXISTS documents_folder_idx ON documents(folder_id);

CREATE TABLE IF NOT EXISTS profiles (
  owner   TEXT PRIMARY KEY,
  name    TEXT NOT NULL DEFAULT '',
  title   TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT ''
);
