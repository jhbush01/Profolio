import type { APIRoute } from 'astro';
import { withRepo } from '../../lib/server/handler';

export const prerender = false;

/**
 * Removes the account and everything in it.
 *
 * Distinct from DELETE /api/vault, which clears the content but leaves the
 * account standing. This one leaves nothing: no files, no rows, no record that
 * the address ever signed in. Signing in again creates a fresh empty account.
 */
export const DELETE: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    await repo.deleteAccount();
    return Response.json({ ok: true });
  });
