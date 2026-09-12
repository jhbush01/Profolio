-- A picture for a ProFolio.
--
-- The key is stored rather than derived, for the same reason documents.r2_key
-- is read back rather than recomputed: an object whose key is calculated at
-- read time is an object that becomes unreachable the moment the calculation
-- changes.
--
-- avatar_updated_at doubles as a cache-buster. The image is served from one
-- stable URL, so without a changing query string a replaced picture would keep
-- showing the old one until the browser felt like asking again.
--
-- NOT re-runnable: SQLite has no ADD COLUMN IF NOT EXISTS. A second run fails
-- with "duplicate column name", which is harmless — nothing is written.

ALTER TABLE profiles ADD COLUMN avatar_key TEXT;
ALTER TABLE profiles ADD COLUMN avatar_mime TEXT;
ALTER TABLE profiles ADD COLUMN avatar_updated_at INTEGER;
