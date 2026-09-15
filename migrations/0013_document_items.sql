-- Which checklist item a record answers is set by the user, not guessed.
--
-- This is 0006's lesson applied one level down, and it should have been applied
-- there. 0006 stopped inferring which PROJECT a record belongs to, because
-- inference made a submitted portfolio's contents unstable. But which ITEM
-- inside that project it answers was still inferred, every render, from the
-- record's dimensions — and inference at that resolution is not merely unstable,
-- it is usually wrong.
--
-- It cannot be fixed by writing better predicates. A marked summative script is
-- honestly an individual's work sample, honestly assessed, honestly not
-- self-designed, and so it honestly satisfies "focus student work across the
-- sequence", "marked summative work" and "record of moderation" all at once. The
-- dimensions do not carry the distinction, because the distinction is what the
-- person meant by uploading it. Only they know. So ask them, and remember.
--
-- A row here means "this record answers this item, because I said so". The
-- predicates survive as the DEFAULT for a record nobody has placed yet, which is
-- what makes uploading thirty files still feel like less work than filing thirty
-- files. The moment any row exists for a (document, programme) pair, that pair's
-- placement is entirely explicit and the predicates stop applying to it.
--
-- item_id is a template identifier, not a foreign key: checklist items are code,
-- not rows. A template that drops an item leaves placements pointing at nothing,
-- which resolves to "in the project, under no item" — the same place an
-- unmatched record already goes, and not an error.
--
-- The empty string is the deliberate nowhere. Without it, "I have decided this
-- belongs under no item" and "I have decided nothing" are the same absence of
-- rows, and the app would go on guessing at a record whose owner has already
-- told it not to.
CREATE TABLE IF NOT EXISTS document_items (
  document_id  TEXT    NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
  programme_id TEXT    NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  item_id      TEXT    NOT NULL,
  -- Denormalised from both parents, so every query filters on owner alone.
  owner        TEXT    NOT NULL,
  assigned_at  INTEGER NOT NULL,
  PRIMARY KEY (document_id, programme_id, item_id)
);

CREATE INDEX IF NOT EXISTS document_items_owner_idx     ON document_items(owner);
CREATE INDEX IF NOT EXISTS document_items_programme_idx ON document_items(programme_id);
