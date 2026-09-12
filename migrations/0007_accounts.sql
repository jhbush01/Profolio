-- Accounts: a stable internal owner id, instead of the email address.
--
-- Until now `owner` on every table was the email from the Access token, and R2
-- keys were `<email>/<document-id>`. Email is not a stable identifier: people
-- change surname, move from a student address to a personal one, and switching
-- the Access identity provider can change what the token carries. Any of those
-- silently becomes a different account with none of the evidence in it.
--
-- So every row is rekeyed onto an opaque account id, and the identities that
-- can resolve to it (an IdP subject, an email address) live in their own table.
-- Existing R2 objects keep their old `<email>/...` keys: documents.r2_key was
-- always stored and is now read back rather than recomputed, so nothing in the
-- bucket has to move.
--
-- Re-runnable. Owners already migrated are skipped by the NOT IN (SELECT id
-- FROM accounts) guard, so running this twice changes nothing.

CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- One row per way of arriving at an account. `kind` is 'subject' (the IdP's
-- subject claim) or 'email'. The primary key means one identity resolves to at
-- most one account, while an account may collect several as people change
-- address or sign in through a new provider.
CREATE TABLE IF NOT EXISTS account_identities (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL,
  linked_at  INTEGER NOT NULL,
  PRIMARY KEY (kind, value)
);

CREATE INDEX IF NOT EXISTS idx_account_identities_account
  ON account_identities(account_id);

-- Scratch mapping from the old email owner to its new account id. Dropped at
-- the end; dropped at the start too, in case an earlier run stopped halfway.
DROP TABLE IF EXISTS _owner_map;
CREATE TABLE _owner_map (
  email      TEXT PRIMARY KEY,
  account_id TEXT NOT NULL
);

INSERT OR IGNORE INTO _owner_map (email, account_id)
SELECT owner, lower(hex(randomblob(16)))
  FROM (
    SELECT owner FROM profiles
    UNION SELECT owner FROM documents
    UNION SELECT owner FROM folders
    UNION SELECT owner FROM programmes
    UNION SELECT owner FROM document_programmes
  )
 WHERE owner IS NOT NULL
   AND owner <> ''
   -- The guard that makes this re-runnable: an owner that is already an
   -- account id has been migrated, and must not be mapped a second time.
   AND owner NOT IN (SELECT id FROM accounts);

INSERT OR IGNORE INTO accounts (id, created_at)
SELECT account_id, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM _owner_map;

INSERT OR IGNORE INTO account_identities (account_id, kind, value, linked_at)
SELECT account_id, 'email', email, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM _owner_map;

UPDATE profiles SET owner = (SELECT account_id FROM _owner_map WHERE email = profiles.owner)
 WHERE owner IN (SELECT email FROM _owner_map);

UPDATE documents SET owner = (SELECT account_id FROM _owner_map WHERE email = documents.owner)
 WHERE owner IN (SELECT email FROM _owner_map);

UPDATE folders SET owner = (SELECT account_id FROM _owner_map WHERE email = folders.owner)
 WHERE owner IN (SELECT email FROM _owner_map);

UPDATE programmes SET owner = (SELECT account_id FROM _owner_map WHERE email = programmes.owner)
 WHERE owner IN (SELECT email FROM _owner_map);

UPDATE document_programmes
   SET owner = (SELECT account_id FROM _owner_map WHERE email = document_programmes.owner)
 WHERE owner IN (SELECT email FROM _owner_map);

DROP TABLE _owner_map;
