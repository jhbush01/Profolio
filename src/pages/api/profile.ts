import type { APIRoute } from 'astro';
import { withRepo } from '../../lib/server/handler';

export const prerender = false;

export const PUT: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as { name?: string; title?: string; summary?: string };
    await repo.saveProfile({
      name: body.name ?? '',
      title: body.title ?? '',
      summary: body.summary ?? '',
    });
    return Response.json({ ok: true });
  });
