import type { APIRoute } from 'astro';
import { withRepo } from '../../lib/server/handler';

export const prerender = false;

/**
 * Records that the signed-in user has acknowledged the de-identification
 * requirement. Uploads are refused until this exists.
 */
export const PUT: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const at = await repo.acknowledgeDeid();
    return Response.json({ ok: true, acknowledgedAt: at });
  });
