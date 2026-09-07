import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as { name?: string; parentId?: string | null };
    const name = body.name?.trim();
    if (!name) return Response.json({ error: 'A folder name is required' }, { status: 400 });
    return Response.json(await repo.createFolder(name, body.parentId ?? null), { status: 201 });
  });
