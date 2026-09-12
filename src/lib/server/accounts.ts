/**
 * Turns a verified Access token into the account that owns rows.
 *
 * Every table's `owner` column holds an account id issued here, never an email
 * address. Email is a label people change; an account id is ours and does not.
 * The indirection is what lets someone switch identity provider, change
 * surname, or move from a university address to a personal one and still find
 * their evidence where they left it.
 *
 * Resolution order, for a token carrying a subject and an email:
 *
 *   1. A subject we have seen before wins outright.
 *   2. Otherwise an account already reachable by that email adopts the new
 *      subject. This is the path that carries the existing single-user data
 *      across, and the path that survives a change of identity provider.
 *   3. Otherwise it is a new account, and both identities are recorded.
 *
 * Step 2 trusts the identity provider's email claim, which means a *recycled*
 * address — an institution reissuing a graduate's address to someone new —
 * would hand the new holder the old account. That is the accepted trade for
 * surviving an IdP change; the alternative locks people out far more often
 * than addresses get recycled. Revisit it if this is ever used somewhere that
 * recycles addresses quickly.
 */
import type { TokenIdentity } from './access';

/** The owner of rows: an internal id, plus the token details for display. */
export interface Identity {
  /** Opaque account id. This is the value in every `owner` column. */
  accountId: string;
  /** Verified email, for showing who is signed in. Never an ownership key. */
  email: string;
}

interface IdentityRow {
  account_id: string;
}

/** 32 hex characters, matching the ids the 0007 migration generates. */
function newAccountId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function lookup(db: D1Database, kind: string, value: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT account_id FROM account_identities WHERE kind = ?1 AND value = ?2`)
    .bind(kind, value)
    .first<IdentityRow>();
  return row?.account_id ?? null;
}

/**
 * `INSERT OR IGNORE`, so two requests arriving together cannot both claim the
 * same identity — the loser's insert is dropped rather than throwing, and the
 * caller re-reads to find whichever account won.
 */
async function link(db: D1Database, accountId: string, kind: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO account_identities (account_id, kind, value, linked_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(accountId, kind, value, Date.now())
    .run();
}

export async function resolveAccount(db: D1Database, token: TokenIdentity): Promise<Identity> {
  if (token.subject) {
    const bySubject = await lookup(db, 'subject', token.subject);
    if (bySubject) return { accountId: bySubject, email: token.email };
  }

  const byEmail = await lookup(db, 'email', token.email);
  if (byEmail) {
    // Remember the subject so the next sign-in takes the cheaper path above,
    // and so this account keeps working if the email later changes.
    if (token.subject) await link(db, byEmail, 'subject', token.subject);
    return { accountId: byEmail, email: token.email };
  }

  const accountId = newAccountId();
  await db
    .prepare(`INSERT INTO accounts (id, created_at) VALUES (?1, ?2)`)
    .bind(accountId, Date.now())
    .run();
  await link(db, accountId, 'email', token.email);
  if (token.subject) await link(db, accountId, 'subject', token.subject);

  // Re-read rather than trusting the insert: under a race the OR IGNORE above
  // may have been the one dropped, and the other request's account is the real
  // one. Returning the freshly generated id there would strand this session's
  // uploads under an account nothing else resolves to.
  const settled =
    (token.subject ? await lookup(db, 'subject', token.subject) : null) ??
    (await lookup(db, 'email', token.email));
  return { accountId: settled ?? accountId, email: token.email };
}
