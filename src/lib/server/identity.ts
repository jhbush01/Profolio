/**
 * Proving who is asking, whatever they proved it with.
 *
 * Two ways in.
 *
 * CLOUDFLARE ACCESS gates the app at the edge and hands the Worker a signed
 * JWT. Google, Microsoft, GitHub, LinkedIn and a one-time email code are all
 * this one path — they are login methods configured in a dashboard, and this
 * code cannot tell them apart beyond the label it shows the user.
 *
 * A PROFOLIO SESSION, for someone who signed up with an email address and a
 * password this app stores. See sessions.ts and password-auth.ts.
 *
 * Routes ask `authenticate()` and never either of those directly. Nothing
 * downstream knows or cares which one answered: `resolveAccount` turns the
 * result into an account id, and rows have been owned by that id since
 * migration 0007, which is why adding the second way in needed no change to a
 * single query.
 *
 * THE ORDER OF THE CHAIN IS A SECURITY PROPERTY, in two ways.
 *
 * First: an authenticator returns null only when the request carries no
 * credential OF ITS KIND, and throws when it carries one that is bad. Return
 * null for a bad credential and the chain quietly becomes "use the weakest
 * thing on the request".
 *
 * Second: Access comes first because it is the stronger proof. A request
 * carrying both an Access token and a session cookie resolves through Access,
 * so a stolen or stale session can never displace a good token. Nothing follows
 * the session entry, so a session that fails to verify falls through to a 401
 * rather than to anything weaker.
 */
import { accessAuthenticator, AuthError } from './access';
import { sessionAuthenticator } from './session-auth';

/** What an authenticator proves. Not an owner: see accounts.ts. */
export interface VerifiedIdentity {
  /** Verified email claim. Used for display and for linking an account. */
  email: string;
  /**
   * The account, when the authenticator already knows it rather than having to
   * resolve an identity into one. Set by the session authenticator, where the
   * id came out of our own session row — never from anything the caller sent.
   * `resolveAccount` short-circuits on it.
   */
  accountId?: string;
  /**
   * A cookie the response must carry: a session being extended, so that one in
   * daily use never expires under someone. Applied by withRepo.
   */
  setCookie?: string;
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

/** In order, and the order matters. See the note at the top of this file. */
const AUTHENTICATORS: Authenticator[] = [accessAuthenticator, sessionAuthenticator];

/** The caller's verified identity, or throws AuthError. */
export async function authenticate(request: Request, env: unknown): Promise<VerifiedIdentity> {
  for (const authenticator of AUTHENTICATORS) {
    const identity = await authenticator.verify(request, env);
    if (identity) return identity;
  }
  throw new AuthError(401, 'Not signed in');
}
