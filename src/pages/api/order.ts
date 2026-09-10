import type { APIRoute } from 'astro';
import { withRepo } from '../../lib/server/handler';

export const prerender = false;

/**
 * Rewrites display order. Body is `{ documents?: string[], folders?: string[] }`
 * listing ids in their new order.
 *
 * Order matters beyond presentation: it is the order sections and documents
 * appear in the exported PDF.
 */
export const PUT: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as { documents?: string[]; folders?: string[] };

    const documents = Array.isArray(body.documents) ? await repo.reorderDocuments(body.documents) : 0;
    const folders = Array.isArray(body.folders) ? await repo.reorderFolders(body.folders) : 0;

    return Response.json({ ok: true, documents, folders });
  });
