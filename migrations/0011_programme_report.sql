-- The written half of a portfolio.
--
-- A portfolio is not a pile of artefacts. It is artefacts plus what you say
-- about them, and until now there was nowhere in the app to write that: a
-- caption per file and a context statement per project, and nothing else.
--
-- Stored as JSON keyed by the template's own section names, the same shape and
-- for the same reason as programmes.context: a template declares its sections,
-- so adding a template never touches the schema.
--
-- NOT re-runnable: SQLite has no ADD COLUMN IF NOT EXISTS. A second run fails
-- with "duplicate column name", which is harmless — nothing is written.

ALTER TABLE programmes ADD COLUMN report TEXT;
