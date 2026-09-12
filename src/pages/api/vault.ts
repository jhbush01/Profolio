import type { APIRoute } from 'astro';
import { withRepo } from '../../lib/server/handler';
import { MAX_ACCOUNT_BYTES } from '../../lib/server/repo';

export const prerender = false;

/** Everything the builder needs in one round trip. */
export const GET: APIRoute = ({ request }) =>
  withRepo(request, async (repo, email) =>
    Response.json({
      signedInAs: email,
      deidAcknowledged: (await repo.deidAcknowledgedAt()) !== null,
      profile: await repo.profile(),
      folders: await repo.folders(),
      documents: await repo.documents(),
      // So the builder can show how much room is left rather than discovering
      // the cap as a failed upload.
      storage: { usedBytes: await repo.storageUsed(), limitBytes: MAX_ACCOUNT_BYTES },
    }),
  );

/** Deletes everything belonging to the caller. */
export const DELETE: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    await repo.clearAll();
    return Response.json({ ok: true });
  });
