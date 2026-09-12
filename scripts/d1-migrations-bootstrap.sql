-- One-time bootstrap so `wrangler d1 migrations apply` is usable on a database
-- whose migrations were applied by hand.
--
-- Wrangler tracks applied migrations in a `d1_migrations` table. This database
-- never had one, because every migration so far was pasted into the Cloudflare
-- dashboard console. Running `wrangler d1 migrations apply` against it without
-- this would try to replay 0001 to 0007 from the start, and the ALTER TABLE
-- statements in 0003, 0004, 0005 and 0006 would fail on columns that already
-- exist. SQLite has no ADD COLUMN IF NOT EXISTS, so they cannot be made
-- idempotent in SQL.
--
-- Run this ONCE, AFTER 0007_accounts.sql has been applied, against each
-- database (remote and any local copy). It records every migration up to 0007
-- as already applied. From then on `npm run db:migrate:remote` is the way to
-- apply new ones.
--
-- Safe to run twice: INSERT OR IGNORE on a UNIQUE name.
--
-- If `wrangler d1 migrations list` later disagrees about what is applied, the
-- real table definition is wrangler's, not this one; check its shape with
--   SELECT sql FROM sqlite_master WHERE name = 'd1_migrations';
-- and reconcile the names rather than dropping the table.

CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_init.sql'),
  ('0002_deid_ack.sql'),
  ('0003_evidence_dimensions.sql'),
  ('0004_programmes.sql'),
  ('0005_programme_context.sql'),
  ('0006_programme_assignment.sql'),
  ('0007_accounts.sql');
