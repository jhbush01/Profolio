-- Records that a user has acknowledged the de-identification requirement
-- before their first upload. Stored rather than kept in browser storage
-- because it is a compliance record: it must survive a device change and be
-- auditable.
ALTER TABLE profiles ADD COLUMN deid_ack_at INTEGER;
