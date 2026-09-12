import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { errorResponse, requireIdentity } from '../../lib/server/access';

export const prerender = false;

/**
 * Who is signed in, for the account menu in the top bar.
 *
 * Deliberately does not go through withRepo: the menu appears on every page,
 * and displaying an address needs the token, not an account lookup. Two D1
 * reads per page view to render text the token already carries would be a
 * waste on a binding that bills by the row.
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const token = await requireIdentity(request, env as Env & { ACCESS_DEV_BYPASS?: string });
    return Response.json(
      { email: token.email },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
};
