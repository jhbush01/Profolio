-- A cover image for a project.
--
-- Same three columns the profile picture uses, for the same reasons: the key
-- so the object can be found and deleted, the mime so it can be served back
-- without sniffing, and the timestamp so a replacement appears immediately
-- despite any cache.
--
-- Nullable with no default: a project without a picture is the normal case,
-- and the card falls back to the template's own colour.

ALTER TABLE programmes ADD COLUMN image_key TEXT;
ALTER TABLE programmes ADD COLUMN image_mime TEXT;
ALTER TABLE programmes ADD COLUMN image_updated_at INTEGER;
