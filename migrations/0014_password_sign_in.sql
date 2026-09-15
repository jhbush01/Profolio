-- Signing in with an email address and a password this app holds.
--
-- Everything before this trusted Cloudflare Access to know who someone is. This
-- is the first credential ProFolio stores itself, so the rules it is built on
-- are worth stating where they cannot be lost.
--
-- A PASSWORD SIGN-UP NEVER ADOPTS AN EXISTING ACCOUNT. Every other identity in
-- account_identities came from a provider that verified the address before
-- asserting it, which is why resolveAccount may hand a matching email an
-- existing account. A password sign-up asserts nothing: anyone can type
-- somebody else's address into a form. If it adopted by email, registering with
-- a colleague's address would hand over their children's work. So a password
-- sign-up always creates a NEW account, and attaching a password to an account
-- that already exists is done from inside it, while signed in.
--
-- That also means this table needs no email-verification gate to be safe. A
-- password account is only ever reachable by the person who set the password.
--
-- The hash parameters are stored per row rather than assumed, so the cost can
-- be raised later and each password upgraded the next time it is used — an
-- iteration count baked into code is one nobody can ever change.
CREATE TABLE IF NOT EXISTS account_passwords (
  account_id     TEXT    PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- The address as typed, lowercased. Also in account_identities under the
  -- 'password' kind; kept here so sign-in is one indexed read.
  email          TEXT    NOT NULL UNIQUE,
  -- Derived key and salt, base64. Never the password.
  password_hash  TEXT    NOT NULL,
  salt           TEXT    NOT NULL,
  algorithm      TEXT    NOT NULL,
  iterations     INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  -- Throttling. Reset on a correct password, so a legitimate sign-in clears it.
  failed_count   INTEGER NOT NULL DEFAULT 0,
  locked_until   INTEGER
);

-- Server-side sessions, so signing out actually ends the session.
--
-- A self-contained signed token cannot be revoked before it expires: "sign out
-- everywhere" would be a lie, and so would deleting an account. A row is the
-- whole point.
--
-- The cookie carries a random token; only its SHA-256 lives here. A leaked
-- database backup is then a list of hashes rather than a drawer of live
-- sessions, which is the same reason the password column is a hash.
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash   TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- How the session began: 'password', or an identity provider by way of
  -- Access. Display and support only, never an authorisation input.
  method       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions(account_id);
CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx  ON account_sessions(expires_at);

-- Failed sign-ins per source address, so guessing many different accounts from
-- one place is throttled as well as guessing one account many times. Rows are
-- short-lived and swept on write; there is no background job to rely on.
CREATE TABLE IF NOT EXISTS sign_in_attempts (
  ip          TEXT    NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sign_in_attempts_ip_idx ON sign_in_attempts(ip, attempted_at);
