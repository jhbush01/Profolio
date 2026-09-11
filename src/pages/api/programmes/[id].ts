import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

export const PATCH: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: {
      name?: string;
      startsOn?: string | null;
      endsOn?: string | null;
      archived?: boolean;
      context?: Record<string, string>;
    } = {};
    if ('name' in body) patch.name = String(body.name ?? '').trim();
    if ('startsOn' in body) patch.startsOn = (body.startsOn as string | null) ?? null;
    if ('endsOn' in body) patch.endsOn = (body.endsOn as string | null) ?? null;
    if ('archived' in body) patch.archived = Boolean(body.archived);
    if ('context' in body) {
      // Whitelist to string values; a template's field ids are the only keys
      // that will ever be read back, so anything else is dropped here.
      const raw = body.context;
      patch.context =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? Object.fromEntries(
              Object.entries(raw as Record<string, unknown>)
                .filter(([, value]) => typeof value === 'string')
                .map(([key, value]) => [key, (value as string).slice(0, 2000)]),
            )
          : {};
    }

    await repo.updateProgramme(params.id!, patch);

    // Closing is not a field on the row the user edits — it changes whether the
    // programme accepts evidence at all, so it goes through its own path.
    if ('closed' in body) await repo.setProgrammeClosed(params.id!, Boolean(body.closed));

    return Response.json({ ok: true });
  });

/** Deletes the programme only. Evidence is untouched. */
export const DELETE: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    await repo.deleteProgramme(params.id!);
    return Response.json({ ok: true });
  });
