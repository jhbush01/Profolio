import type { APIRoute } from 'astro';
import { withRepo } from '../../../../lib/server/handler';

export const prerender = false;

/**
 * A project's cover image.
 *
 * `no-store` with `Vary: Cookie`, for the same reason the profile picture is:
 * one URL per project is shared by nobody, but the response still depends on
 * who is asking, and a cache that can cross accounts is not worth one saved
 * request. See src/pages/api/profile/avatar.ts.
 */
export const GET: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const found = await repo.programmeImageBody(params.id!);
    if (!found) return Response.json({ error: 'No picture set' }, { status: 404 });
    return new Response(found.body, {
      headers: {
        'Content-Type': found.mime,
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  });

/** multipart/form-data carrying one `file`. */
export const PUT: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'No image supplied' }, { status: 400 });
    }
    return Response.json({ imageUpdatedAt: await repo.saveProgrammeImage(params.id!, file) });
  });

export const DELETE: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    await repo.deleteProgrammeImage(params.id!);
    return Response.json({ ok: true });
  });
