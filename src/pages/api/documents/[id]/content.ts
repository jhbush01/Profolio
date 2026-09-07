import type { APIRoute } from 'astro';
import { withRepo } from '../../../../lib/server/handler';

export const prerender = false;

/** Streams a document's bytes back to the owner, for PDF export and previews. */
export const GET: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const found = await repo.documentBody(params.id!);
    if (!found) return Response.json({ error: 'Not found' }, { status: 404 });
    return new Response(found.body, {
      headers: {
        'Content-Type': found.mime,
        // Private: these are one user's documents, never edge-cacheable.
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="${encodeURIComponent(found.name)}"`,
      },
    });
  });
