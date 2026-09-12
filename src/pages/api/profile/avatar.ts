import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

/**
 * The profile picture: one object, one owner, one URL.
 *
 * NOT CACHED, and that is the point of this comment.
 *
 * This used to be `private, max-age=300, must-revalidate`, which is a
 * cross-account leak. Every account asks for the same URL, so after signing out
 * and signing in as somebody else, the browser answered from its own cache with
 * the previous account's face — under the new account's name — for the next
 * five minutes. On a shared staffroom device that is one person's photograph
 * presented as another person's.
 *
 * `Vary: Cookie` says the same thing to anything in between: this response
 * depends on the Access cookie, so it is never one shared answer. Callers still
 * append the stored timestamp, which costs nothing and keeps a replacement
 * instant if some cache ignores all of this.
 */
export const GET: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const found = await repo.avatarBody();
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
