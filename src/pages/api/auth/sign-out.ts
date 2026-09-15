import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { clearedCookie, destroySession, sessionCookieFrom } from '../../../lib/server/sessions';

export const prerender = false;

/**
 * Ends a ProFolio session.
 *
 * The row goes, not just the cookie: a session that survives sign-out on the
 * server is a session somebody else can still be holding. Always 200, even with
 * no session to end — signing out is not a place to report errors.
 *
 * Access sessions are not ended here. Those belong to Cloudflare and are
 * cleared at /cdn-cgi/access/logout, which the account menu sends people to
 * when that is how they signed in.
 */
export const POST: APIRoute = async ({ request }) => {
  const token = sessionCookieFrom(request);
  if (token) {
    try {
      await destroySession((env as Env).DB, token);
    } catch {
      // The cookie is cleared regardless. A failure to delete the row must not
      // leave the browser believing it is still signed in.
    }
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearedCookie(), 'Cache-Control': 'no-store' },
  });
};
