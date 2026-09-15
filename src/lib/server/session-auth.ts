/**
 * ProFolio's own session, as a link in the authentication chain.
 *
 * Separate from sessions.ts so that file can stay about storing and revoking
 * sessions, and separate from identity.ts so that file does not need a D1
 * binding to describe the chain.
 *
 * Last in the chain, deliberately. See identity.ts.
 */
import { sessionIdentity } from './sessions';
import type { Authenticator } from './identity';

export const sessionAuthenticator: Authenticator = {
  name: 'session',
  async verify(request, env) {
    const bindings = env as { DB?: D1Database };
    if (!bindings.DB) return null;

    // An unknown or expired cookie resolves to null rather than throwing, and
    // this is the one place that is right: nothing follows this entry, so there
    // is nothing weaker to fall through to, and the caller gets the same 401
    // either way. Throwing here would only replace "sign in again" with a
    // scarier sentence saying the same thing.
    const identity = await sessionIdentity(bindings.DB, request);
    if (!identity) return null;

    return {
      email: identity.email,
      subject: null,
      method: identity.method,
      accountId: identity.accountId,
      setCookie: identity.refreshedCookie,
    };
  },
};
