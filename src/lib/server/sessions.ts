/**
 * ProFolio's own sessions, for people who did not arrive through Access.
 *
 * A row in D1 rather than a self-signed token, because a token that verifies
 * itself cannot be withdrawn before it expires — "sign out" would clear the
 * cookie on one device and leave the session live everywhere else, and deleting
 * an account would leave its sessions working. Revocation is the feature.
 *
 * The cookie carries a random token; only its SHA-256 is stored. A leaked
 * database backup is then a list of hashes rather than a drawer of live
 * sessions, for the same reason the password column is a hash.
 */
import type { VerifiedIdentity } from './identity';

const COOKIE = 'pf_session';
const TOKEN_BYTES = 32;

/** How long a session lasts without being used. */
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale `last_seen_at` may get before a read writes it back, and how close
 * to expiry a session gets before being extended. One write per day of use
 * rather than one per request, on a binding that bills by the row.
 */
const REFRESH_MS = 24 * 60 * 60 * 1000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

export function sessionCookieFrom(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  return /(?:^|;\s*)pf_session=([^;]+)/.exec(cookie)?.[1] ?? null;
}

/**
 * Secure, HttpOnly, SameSite=Lax.
 *
 * HttpOnly so a script cannot read it; Secure so it never crosses plain HTTP;
 * Lax rather than Strict so that following a link into ProFolio from an email
 * or a bookmark does not land on a signed-out page, while a cross-site POST
 * still arrives without it. Astro's CSRF origin check is the second lock on
 * that door.
 */
function cookieHeader(token: string, maxAgeSeconds: number): string {
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Issues a session and returns the Set-Cookie value for it. */
export async function createSession(
  db: D1Database,
  accountId: string,
  method: string,
): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO account_sessions
         (token_hash, account_id, created_at, expires_at, last_seen_at, method)
       VALUES (?1, ?2, ?3, ?4, ?3, ?5)`,
    )
    .bind(await hashToken(token), accountId, now, now + LIFETIME_MS, method)
    .run();
  return cookieHeader(token, Math.floor(LIFETIME_MS / 1000));
}

export interface SessionRecord {
  accountId: string;
  method: string;
  /** Set when the session was extended and the cookie should be re-sent. */
  refreshedCookie?: string;
}

/**
 * Looks a session up. Returns null when the token is unknown or expired —
 * both of which mean "sign in again", not "something went wrong".
 *
 * An expired row is deleted on the way past. That plus the account cascade is
 * the whole retention story for this table; there is no sweeper to forget to
 * schedule.
 */
export async function readSession(db: D1Database, token: string): Promise<SessionRecord | null> {
  const tokenHash = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT account_id, expires_at, last_seen_at, method
         FROM account_sessions WHERE token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<{ account_id: string; expires_at: number; last_seen_at: number; method: string }>();
  if (!row) return null;

  const now = Date.now();
  if (row.expires_at <= now) {
    await db.prepare(`DELETE FROM account_sessions WHERE token_hash = ?1`).bind(tokenHash).run();
    return null;
  }

  const record: SessionRecord = { accountId: row.account_id, method: row.method };

  if (now - row.last_seen_at > REFRESH_MS) {
    await db
      .prepare(
        `UPDATE account_sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1`,
      )
      .bind(tokenHash, now, now + LIFETIME_MS)
      .run();
    // Re-sent so a session in daily use never expires out from under someone,
    // while one abandoned on a staffroom machine still dies on schedule.
    record.refreshedCookie = cookieHeader(token, Math.floor(LIFETIME_MS / 1000));
  }

  return record;
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare(`DELETE FROM account_sessions WHERE token_hash = ?1`)
    .bind(await hashToken(token))
    .run();
}

/** Every session for an account. Used on password change and account deletion. */
export async function destroyAllSessions(db: D1Database, accountId: string): Promise<void> {
  await db.prepare(`DELETE FROM account_sessions WHERE account_id = ?1`).bind(accountId).run();
}

/**
 * The session as an authenticator. Second in the chain, behind Access.
 *
 * Deliberately behind it: Access is the stronger proof and the one that exists
 * today, so a request carrying both resolves through Access and a bad session
 * can never displace a good token. Nothing follows this entry, so a session
 * that fails to verify cannot fall through to anything weaker.
 */
export async function sessionIdentity(
  db: D1Database,
  request: Request,
): Promise<(VerifiedIdentity & { accountId: string; refreshedCookie?: string }) | null> {
  const token = sessionCookieFrom(request);
  if (!token) return null;

  const session = await readSession(db, token);
  if (!session) return null;

  // The address is for display. Ownership is the account id, which came from
  // the session row and never from anything the caller sent.
  const row = await db
    .prepare(`SELECT value FROM account_identities WHERE account_id = ?1 AND kind = 'password'`)
    .bind(session.accountId)
    .first<{ value: string }>();
  const fallback = await db
    .prepare(
      `SELECT value FROM account_identities
        WHERE account_id = ?1 AND kind = 'email' ORDER BY linked_at LIMIT 1`,
    )
    .bind(session.accountId)
    .first<{ value: string }>();

  return {
    email: row?.value ?? fallback?.value ?? '',
    subject: null,
    method: session.method,
    accountId: session.accountId,
    refreshedCookie: session.refreshedCookie,
  };
}
