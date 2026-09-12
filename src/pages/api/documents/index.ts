import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

/**
 * multipart/form-data upload: one or more `files`, an optional `folderId`, and
 * an optional `programmeId` that assigns every file in the request to that
 * project as it is stored.
 */
export const POST: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const form = await request.formData();
    const text = (key: string): string | null => {
      const raw = form.get(key);
      return typeof raw === 'string' && raw ? raw : null;
    };

    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) return Response.json({ error: 'No files supplied' }, { status: 400 });

    const folderId = text('folderId');
    const programmeId = text('programmeId');

    const added = [];
    for (const file of files) added.push(await repo.addDocument(file, folderId, programmeId));
    return Response.json({ added }, { status: 201 });
  });
