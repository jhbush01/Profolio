import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

export const PATCH: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: { name?: string; startsOn?: string | null; endsOn?: string | null; archived?: boolean } = {};
    if ('name' in body) patch.name = String(body.name ?? '').trim();
    if ('startsOn' in body) patch.startsOn = (body.startsOn as string | null) ?? null;
    if ('endsOn' in body) patch.endsOn = (body.endsOn as string | null) ?? null;
    if ('archived' in body) patch.archived = Boolean(body.archived);

    await repo.updateProgramme(params.id!, patch);
    return Response.json({ ok: true });
  });

/** Deletes the programme only. Evidence is untouched. */
export const DELETE: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    await repo.deleteProgramme(params.id!);
    return Response.json({ ok: true });
  });
