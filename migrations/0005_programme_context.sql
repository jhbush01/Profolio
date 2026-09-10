-- Context for a programme: where the practice happened.
--
-- Stored as JSON against the programme, not as columns, because which fields
-- are relevant is a property of the template. A placement wants sector, year
-- level and class size; a professional-development year wants almost none of
-- that. Adding a template with different context fields must not migrate the
-- database.
ALTER TABLE programmes ADD COLUMN context TEXT;
