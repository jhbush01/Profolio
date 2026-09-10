-- Programmes: a selectable template plus a date window.
--
-- Rows, not a setting. A practitioner accumulates programmes over a career —
-- a final placement, then professional development years, then a renewal
-- period — and each keeps its own window and checklist.
--
-- Deliberately NO foreign key from documents to programmes. A programme is a
-- lens over the vault, so one artefact can count toward several programmes
-- without being copied or moved. See docs/PRODUCT.md.
CREATE TABLE IF NOT EXISTS programmes (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  -- Which template this was created from; resolved against the code registry.
  template   TEXT NOT NULL,
  -- User-facing name, e.g. "Final placement, Sienna Catholic College".
  name       TEXT NOT NULL,
  -- Window, as ISO date strings (YYYY-MM-DD). Null until the user sets them.
  starts_on  TEXT,
  ends_on    TEXT,
  created_at INTEGER NOT NULL,
  -- Kept rather than deleted, so a finished placement stays readable.
  archived   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS programmes_owner_idx ON programmes(owner);
