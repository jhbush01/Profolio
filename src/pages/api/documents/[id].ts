import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

export const PATCH: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as { caption?: string; folderId?: string | null };
    await repo.updateDocument(params.id!, body);
    return Response.json({ ok: true });
  });

export const DELETE: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    await repo.deleteDocument(params.id!);
    return Response.json({ ok: true });
  });
