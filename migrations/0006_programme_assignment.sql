-- Evidence is assigned to a programme, not inferred from it.
--
-- This supersedes the note in 0004 and the matching passage in docs/PRODUCT.md.
-- Predicate matching alone had a defect that only shows up at submission time:
-- the output was not stable. A record captured in 2029 that happened to match a
-- placement's checklist silently changed what that placement contained — and an
-- export of a portfolio someone already handed in must not move.
--
-- So membership is explicit and user-set. Predicates are still used, but only to
-- SUGGEST ("3 records match this checklist but are not in it"); nothing joins a
-- programme without the user saying so.
--
-- Still many-to-many, which was the part worth keeping: a first aid certificate
-- is evidence for a placement AND for that year's professional development, and
-- must not have to be uploaded twice.
CREATE TABLE IF NOT EXISTS document_programmes (
  document_id  TEXT NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
  programme_id TEXT NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  -- Denormalised from both parents so every query can filter on owner alone,
  -- the same guarantee every other table gives.
  owner        TEXT NOT NULL,
  assigned_at  INTEGER NOT NULL,
  PRIMARY KEY (document_id, programme_id)
);

CREATE INDEX IF NOT EXISTS document_programmes_owner_idx     ON document_programmes(owner);
CREATE INDEX IF NOT EXISTS document_programmes_programme_idx ON document_programmes(programme_id);

-- Closing freezes what a programme holds: nothing joins or leaves while
-- closed_at is set, so an export made years later matches the one submitted.
-- Reopening is deliberately recorded rather than silent — it is the moment a
-- handed-in portfolio stops matching its export.
ALTER TABLE programmes ADD COLUMN closed_at   INTEGER;
ALTER TABLE programmes ADD COLUMN reopened_at INTEGER;
