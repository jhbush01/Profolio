-- Teaching philosophy and contact details.
--
-- Both belong to the person rather than to any one project, so they sit on
-- profiles beside the cover details they print next to.
--
-- Contact details are stored as separate columns rather than one blob, because
-- the export needs to lay them out and a JSON blob would have to be parsed and
-- trusted on every read.
--
-- NOT re-runnable: SQLite has no ADD COLUMN IF NOT EXISTS. A second run fails
-- with "duplicate column name", which is harmless — nothing is written.

ALTER TABLE profiles ADD COLUMN philosophy TEXT;
ALTER TABLE profiles ADD COLUMN contact_email TEXT;
ALTER TABLE profiles ADD COLUMN contact_phone TEXT;
ALTER TABLE profiles ADD COLUMN contact_location TEXT;
ALTER TABLE profiles ADD COLUMN contact_links TEXT;
