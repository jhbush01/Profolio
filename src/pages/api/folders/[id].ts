import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

export const PATCH: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as { name?: string; note?: string };
    await repo.updateFolder(params.id!, body);
    return Response.json({ ok: true });
  });

export const DELETE: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const removed = await repo.deleteFolder(params.id!);
    return Response.json({ ok: true, documentsRemoved: removed });
  });
