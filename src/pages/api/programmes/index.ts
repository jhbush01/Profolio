import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';
import { templateFor } from '../../../lib/programmes';

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => Response.json({ programmes: await repo.programmes() }));

export const POST: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as {
      template?: string;
      name?: string;
      startsOn?: string | null;
      endsOn?: string | null;
    };

    // The template must exist in the registry; an unknown key would produce a
    // programme that can never be scored.
    if (!body.template || !templateFor(body.template)) {
      return Response.json({ error: 'Unknown programme template' }, { status: 400 });
    }
    const name = body.name?.trim();
    if (!name) return Response.json({ error: 'A name is required' }, { status: 400 });

    const created = await repo.createProgramme({
      template: body.template,
      name,
      startsOn: body.startsOn ?? null,
      endsOn: body.endsOn ?? null,
    });
    return Response.json(created, { status: 201 });
  });
