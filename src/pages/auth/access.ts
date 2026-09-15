import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { errorResponse, requireIdentity } from '../../lib/server/access';
import { resolveAccount } from '../../lib/server/accounts';
import { createSession } from '../../lib/server/sessions';

export const prerender = false;

/**
 * The one path Cloudflare Access still guards, and the bridge between the two
 * ways in.
 *
 * Once password sign-in exists, Access cannot keep gating the whole app: it
 * intercepts before any of this code runs, so a password user would never reach
 * a page to sign in on. The arrangement is the other way round — Access guards
 * this single path, everything else is guarded by ProFolio's own session — and
 * this route is where an Access login becomes one of those sessions.
 *
 * So a Google user and a password user end up holding the same kind of cookie,
 * and every route downstream stops caring which they are.
 *
 * A redirect rather than JSON: this is reached by a person clicking a link, and
 * what they want next is the app.
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const bindings = env as Env & { ACCESS_DEV_BYPASS?: string };
    // requireIdentity, not authenticate: arriving here with only a ProFolio
    // session must not mint a second one. This path means "I have just proved
    // myself to Access", and nothing else.
    const token = await requireIdentity(request, bindings);
    const who = await resolveAccount(bindings.DB, { ...token, method: 'access' });
    const cookie = await createSession(bindings.DB, who.accountId, 'access');

    return new Response(null, {
      status: 303,
      headers: { Location: '/', 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
