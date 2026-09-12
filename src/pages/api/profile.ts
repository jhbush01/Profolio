import type { APIRoute } from 'astro';
import { withRepo } from '../../lib/server/handler';

export const prerender = false;

export const PUT: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as Record<string, unknown>;
    // Every field explicitly, defaulting to empty: a PUT replaces the profile,
    // so an omitted field means "clear it", not "leave whatever was there".
    const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '');
    await repo.saveProfile({
      name: text('name'),
      title: text('title'),
      summary: text('summary'),
      philosophy: text('philosophy'),
      contactEmail: text('contactEmail'),
      contactPhone: text('contactPhone'),
      contactLocation: text('contactLocation'),
      contactLinks: text('contactLinks'),
    });
    return Response.json({ ok: true });
  });
