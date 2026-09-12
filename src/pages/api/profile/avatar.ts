import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

/**
 * The profile picture: one object, one owner, one URL.
 *
 * GET is cacheable in the viewer's own browser but nowhere shared — it is a
 * picture of a person, so `private`. Callers append the stored timestamp as a
 * query string, which is what makes a replacement appear at once despite that
 * cache.
 */
export const GET: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const found = await repo.avatarBody();
    if (!found) return Response.json({ error: 'No picture set' }, { status: 404 });
    return new Response(found.body, {
      headers: {
        'Content-Type': found.mime,
        'Cache-Control': 'private, max-age=300, must-revalidate',
      },
    });
  });

/** multipart/form-data carrying one `file`. */
export const PUT: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'No image supplied' }, { status: 400 });
    }
    return Response.json({ avatarUpdatedAt: await repo.saveAvatar(file) });
  });

export const DELETE: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    await repo.deleteAvatar();
    return Response.json({ ok: true });
  });
