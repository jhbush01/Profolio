/**
 * Creating and using an email-and-password login.
 *
 * THE RULE THAT MAKES THIS SAFE, and the one to read before changing anything
 * here: a password sign-up NEVER adopts an existing account.
 *
 * Every other identity in `account_identities` arrived from a provider that
 * verified the address before asserting it, which is why `resolveAccount` may
 * hand a matching email an account that already exists. A password sign-up
 * asserts nothing — anyone can type anyone's address into a form. If sign-up
 * adopted by email, registering with a colleague's address would hand over
 * their students' work. So sign-up always creates a new account, and attaching
 * a password to an account that already exists happens from inside it, signed
 * in, in `setPassword`.
 *
 * A pleasant consequence: no email-verification gate is needed for this to be
 * safe. A password account is reachable only by whoever set the password.
 */
import { HttpError, AuthError } from './access';
import { createSession, destroyAllSessions } from './sessions';
import {
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
  type StoredPassword,
} from './passwords';

/** Failed attempts on one account before it stops answering, and for how long. */
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Failed attempts from one address, across all accounts, per window. */
const IP_LIMIT = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;

interface PasswordRow {
  account_id: string;
  email: string;
  password_hash: string;
  salt: string;
  algorithm: string;
  iterations: number;
  failed_count: number;
  locked_until: number | null;
}

function stored(row: PasswordRow): StoredPassword {
  return {
    hash: row.password_hash,
    salt: row.salt,
    algorithm: row.algorithm,
    iterations: row.iterations,
  };
}

/**
 * Good enough to reject a typo, and nothing more.
 *
 * Deliberately not RFC 5322. An over-clever pattern's failure mode is refusing
 * a real address somebody actually has, which is worse than accepting one that
 * bounces.
 */
export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

function clientAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/**
 * Throttling by source address, so guessing one password on each of a thousand
 * accounts is limited as well as guessing a thousand passwords on one.
 *
 * Rows older than the window are deleted on the way past, which is also the
 * whole retention policy for the table.
 */
async function ipThrottle(db: D1Database, request: Request): Promise<void> {
  const ip = clientAddress(request);
  if (ip === 'unknown') return;
  const since = Date.now() - IP_WINDOW_MS;
  await db.prepare(`DELETE FROM sign_in_attempts WHERE attempted_at < ?1`).bind(since).run();
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM sign_in_attempts WHERE ip = ?1 AND attempted_at >= ?2`)
    .bind(ip, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= IP_LIMIT) {
    throw new HttpError(429, 'Too many sign-in attempts from this connection. Try again shortly.');
  }
}

async function recordFailure(db: D1Database, request: Request): Promise<void> {
  const ip = clientAddress(request);
  if (ip === 'unknown') return;
  await db
    .prepare(`INSERT INTO sign_in_attempts (ip, attempted_at) VALUES (?1, ?2)`)
    .bind(ip, Date.now())
    .run();
}

/**
 * Creates an account with a password, and a session for it.
 *
 * Returns the Set-Cookie value. The caller sends it; nothing here writes a
 * response, so the same function serves a form post and a future API client.
 */
export async function signUpWithPassword(
  db: D1Database,
  request: Request,
  emailInput: unknown,
  password: unknown,
): Promise<{ cookie: string; accountId: string }> {
  // Throttled on the same counter as sign-in. Unlimited account creation from
  // one address is how an open sign-up form becomes somebody else's storage.
  await ipThrottle(db, request);

  const email = normaliseEmail(emailInput);
  if (!email) throw new HttpError(400, 'That does not look like an email address.');
  if (typeof password !== 'string') throw new HttpError(400, 'A password is required.');

  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);

  const taken = await db
    .prepare(`SELECT 1 FROM account_passwords WHERE email = ?1`)
    .bind(email)
    .first();
  if (taken) {
    // Says the address is in use, which is unavoidable on a sign-up form: a
    // form that accepted a duplicate silently would be worse for the person
    // than for the attacker, who can learn the same thing from the sign-in
    // form no matter how this one is worded.
    throw new HttpError(
      409,
      'There is already a password login for that address. Sign in with it instead.',
    );
  }

  // Hashing before the account row exists, so a slow or failing derive cannot
  // leave an account with no password attached to it.
  const hashed = await hashPassword(password);

  const accountId = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const now = Date.now();

  await db.batch([
    db.prepare(`INSERT INTO accounts (id, created_at, last_seen_at) VALUES (?1, ?2, ?2)`).bind(accountId, now),
    db
      .prepare(
        `INSERT INTO account_passwords
           (account_id, email, password_hash, salt, algorithm, iterations, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      )
      .bind(accountId, email, hashed.hash, hashed.salt, hashed.algorithm, hashed.iterations, now),
    // Linked under its own kind, NOT under 'email'. The 'email' kind is the one
    // resolveAccount adopts by, and a self-asserted address must never join it.
    db
      .prepare(
        `INSERT INTO account_identities (account_id, kind, value, linked_at)
         VALUES (?1, 'password', ?2, ?3)`,
      )
      .bind(accountId, email, now),
  ]);

  return { cookie: await createSession(db, accountId, 'password'), accountId };
}

/** Checks a password and starts a session. */
export async function signInWithPassword(
  db: D1Database,
  request: Request,
  emailInput: unknown,
  password: unknown,
): Promise<{ cookie: string; accountId: string }> {
  await ipThrottle(db, request);

  const email = normaliseEmail(emailInput);
  const row =
    email === null
      ? null
      : await db
          .prepare(
            `SELECT account_id, email, password_hash, salt, algorithm, iterations,
                    failed_count, locked_until
               FROM account_passwords WHERE email = ?1`,
          )
          .bind(email)
          .first<PasswordRow>();

  // One message for "no such address" and "wrong password", because two
  // messages are a way to ask this app which of your colleagues have accounts.
  const refuse = () => new AuthError(401, 'That email address and password do not match.');

  if (!row) {
    await recordFailure(db, request);
    // A derive against a throwaway salt, so a missing address does not answer
    // faster than a wrong password and turn timing into an account list.
    await verifyPassword(typeof password === 'string' ? password : '', {
      hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
      algorithm: 'PBKDF2-SHA256',
      iterations: 210_000,
    });
    throw refuse();
  }

  const now = Date.now();
  if (row.locked_until !== null && row.locked_until > now) {
    const minutes = Math.max(1, Math.ceil((row.locked_until - now) / 60_000));
    throw new HttpError(
      429,
      `Too many attempts on this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  const correct =
    typeof password === 'string' && (await verifyPassword(password, stored(row)));

  if (!correct) {
    await recordFailure(db, request);
    const failures = row.failed_count + 1;
    await db
      .prepare(
        `UPDATE account_passwords SET failed_count = ?2, locked_until = ?3 WHERE account_id = ?1`,
      )
      .bind(row.account_id, failures, failures >= LOCK_AFTER ? now + LOCK_MS : null)
      .run();
    throw refuse();
  }

  // Correct: clear the counter, and quietly re-hash if the cost has been raised
  // since this password was set. The one moment the plaintext is in hand is the
  // only moment an upgrade is possible.
  const upgrade = needsRehash(stored(row)) ? await hashPassword(password as string) : null;
  await db
    .prepare(
      upgrade
        ? `UPDATE account_passwords
              SET failed_count = 0, locked_until = NULL,
                  password_hash = ?2, salt = ?3, algorithm = ?4, iterations = ?5, updated_at = ?6
            WHERE account_id = ?1`
        : `UPDATE account_passwords SET failed_count = 0, locked_until = NULL WHERE account_id = ?1`,
    )
    .bind(
      ...(upgrade
        ? [row.account_id, upgrade.hash, upgrade.salt, upgrade.algorithm, upgrade.iterations, now]
        : [row.account_id]),
    )
    .run();

  return { cookie: await createSession(db, row.account_id, 'password'), accountId: row.account_id };
}

/**
 * Sets or replaces the password on the account already signed in.
 *
 * This is the only way an account that arrived through Access gains a password,
 * and the reason sign-up never needs to adopt one. Changing an existing
 * password requires the current one, so a borrowed unlocked laptop cannot be
 * used to lock the owner out of their own evidence.
 *
 * Every other session is ended on success. A password change that leaves the
 * sessions it was changed because of still running has done nothing.
 */
export async function setPassword(
  db: D1Database,
  accountId: string,
  email: string,
  current: unknown,
  next: unknown,
): Promise<void> {
  if (typeof next !== 'string') throw new HttpError(400, 'A password is required.');
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);

  const existing = await db
    .prepare(
      `SELECT account_id, email, password_hash, salt, algorithm, iterations,
              failed_count, locked_until
         FROM account_passwords WHERE account_id = ?1`,
    )
    .bind(accountId)
    .first<PasswordRow>();

  if (existing) {
    const ok = typeof current === 'string' && (await verifyPassword(current, stored(existing)));
    if (!ok) throw new AuthError(401, 'That is not your current password.');
  }

  const address = normaliseEmail(email);
  if (!address) throw new HttpError(400, 'This account has no usable email address to sign in with.');

  // A different account already signs in with this address. Refusing is the
  // only safe answer: the alternative is two accounts answering to one login.
  const clash = await db
    .prepare(`SELECT account_id FROM account_passwords WHERE email = ?1 AND account_id <> ?2`)
    .bind(address, accountId)
    .first();
  if (clash) {
    throw new HttpError(409, 'Another account already signs in with that address.');
  }

  const hashed = await hashPassword(next);
  const now = Date.now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO account_passwords
           (account_id, email, password_hash, salt, algorithm, iterations, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT (account_id) DO UPDATE SET
           email = excluded.email,
           password_hash = excluded.password_hash,
           salt = excluded.salt,
           algorithm = excluded.algorithm,
           iterations = excluded.iterations,
           updated_at = excluded.updated_at,
           failed_count = 0,
           locked_until = NULL`,
      )
      .bind(accountId, address, hashed.hash, hashed.salt, hashed.algorithm, hashed.iterations, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO account_identities (account_id, kind, value, linked_at)
         VALUES (?1, 'password', ?2, ?3)`,
      )
      .bind(accountId, address, now),
  ]);

  await destroyAllSessions(db, accountId);
}

/** Whether this account can sign in with a password, for the account page. */
export async function hasPassword(db: D1Database, accountId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT email FROM account_passwords WHERE account_id = ?1`)
    .bind(accountId)
    .first<{ email: string }>();
  return row?.email ?? null;
}
