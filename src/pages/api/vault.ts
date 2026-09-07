import type { APIRoute } from 'astro';
import { withRepo } from '../../lib/server/handler';

export const prerender = false;

/** Everything the builder needs in one round trip. */
export const GET: APIRoute = ({ request }) =>
  withRepo(request, async (repo, email) =>
    Response.json({
      signedInAs: email,
      profile: await repo.profile(),
      folders: await repo.folders(),
      documents: await repo.documents(),
    }),
  );

/** Deletes everything belonging to the caller. */
export const DELETE: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    await repo.clearAll();
    return Response.json({ ok: true });
  });
