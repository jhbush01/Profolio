/**
 * Proving who is asking, whatever they proved it with.
 *
 * Today there is exactly one way in: Cloudflare Access, which gates the app at
 * the edge and hands the Worker a signed JWT. That is deliberate — Access
 * supports Google, Microsoft, GitHub and a one-time email code as identity
 * providers, so "sign in with Google" and "sign in with any email address" are
 * settings in a dashboard rather than a credential database in this repo. An
 * app holding de-identified children's work is better off never storing a
 * password than storing one carefully.
 *
 * This file exists because that may not stay true. If ProFolio is ever sold to
 * a school that cannot use Access, it will need its own sign-in, and the way to
 * be ready for that is NOT to write it now — it is to make sure adding it later
 * is one new module rather than an edit to every route.
 *
 * So: routes ask `authenticate()`. They do not know what proved the caller, and
 * nothing downstream does either — `resolveAccount` turns whatever comes back
 * into an account id, and rows have been owned by that id since migration 0007.
 * A password authenticator would slot into AUTHENTICATORS below, record its
 * identity in `account_identities` under a new `kind`, and require no schema
 * change and no data migration.
 *
 * THE ORDER OF THE CHAIN IS A SECURITY PROPERTY. An authenticator returns null
 * only when the request carries no credential OF ITS KIND, and throws when it
 * carries one that is bad. If a bad Access token returned null instead, the
 * request would fall through to whatever authenticator came next — which is how
 * a chain quietly becomes "use the weakest thing on the request".
 */
import { accessAuthenticator, AuthError } from './access';

/** What an authenticator proves. Not an owner: see accounts.ts. */
export interface VerifiedIdentity {
  /** Verified email claim. Used for display and for linking an account. */
  email: string;
  /** A stable provider-side id, when there is one. */
  subject: string | null;
  /**
   * Which authenticator proved this, for display and support. Never an
   * authorisation input: nothing may be permitted because of how you signed in.
   */
  method: string;
}

export interface Authenticator {
  name: string;
  /**
   * Resolves an identity, or null when this request carries no credential this
   * authenticator handles.
   *
   * Throws AuthError when a credential IS present and fails. Never return null
   * for a bad credential — see the note above about the chain.
   */
  verify(request: Request, env: unknown): Promise<VerifiedIdentity | null>;
}

/**
 * In order. One entry today, and the single place a second one gets added.
 */
const AUTHENTICATORS: Authenticator[] = [accessAuthenticator];

/** The caller's verified identity, or throws AuthError. */
export async function authenticate(request: Request, env: unknown): Promise<VerifiedIdentity> {
  for (const authenticator of AUTHENTICATORS) {
    const identity = await authenticator.verify(request, env);
    if (identity) return identity;
  }
  throw new AuthError(401, 'Not signed in');
}
