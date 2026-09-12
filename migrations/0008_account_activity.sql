-- Last sign-in, per account.
--
-- Needed before any retention rule can exist: you cannot delete dormant
-- accounts without knowing which ones are dormant. Recorded from today so the
-- clock starts now rather than pretending to know about past sessions.
--
-- Disclosed in the privacy policy, because it is a record of when a person
-- used the service.
--
-- NOT re-runnable: SQLite has no ADD COLUMN IF NOT EXISTS. Running it twice
-- fails with "duplicate column name", which is harmless — nothing is written.

ALTER TABLE accounts ADD COLUMN last_seen_at INTEGER;
