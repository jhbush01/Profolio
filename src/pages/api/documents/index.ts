import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';

export const prerender = false;

/** multipart/form-data upload: one or more `files`, plus an optional folderId. */
export const POST: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const form = await request.formData();
    const folderIdRaw = form.get('folderId');
    const folderId = typeof folderIdRaw === 'string' && folderIdRaw ? folderIdRaw : null;

    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) return Response.json({ error: 'No files supplied' }, { status: 400 });

    const added = [];
    for (const file of files) added.push(await repo.addDocument(file, folderId));
    return Response.json({ added }, { status: 201 });
  });
