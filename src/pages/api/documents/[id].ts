import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';
import type { DocumentPatch } from '../../../lib/server/repo';

export const prerender = false;

/**
 * Partial update. Every evidence dimension is optional, and anything the body
 * omits is left untouched — so the client can save one field at a time as the
 * user fills it in, without needing to resend the whole record.
 */
export const PATCH: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const body = (await request.json()) as DocumentPatch;

    // Whitelist: never hand raw request keys to the column mapper.
    const patch: DocumentPatch = {};
    if ('caption' in body) patch.caption = String(body.caption ?? '');
    if ('folderId' in body) patch.folderId = body.folderId ?? null;
    if ('capturedAt' in body) patch.capturedAt = body.capturedAt ?? null;
    if ('cyclePhase' in body) patch.cyclePhase = body.cyclePhase ?? null;
    if ('evidenceType' in body) patch.evidenceType = body.evidenceType ?? null;
    if ('purpose' in body) patch.purpose = body.purpose ?? null;
    if ('source' in body) patch.source = body.source ?? null;
    if ('subjectScope' in body) patch.subjectScope = body.subjectScope ?? null;
    if ('selfDesigned' in body) {
      patch.selfDesigned = body.selfDesigned === null ? null : Boolean(body.selfDesigned);
    }
    if ('standards' in body) {
      patch.standards = Array.isArray(body.standards)
        ? body.standards.filter((code): code is string => typeof code === 'string')
        : [];
    }

    await repo.updateDocument(params.id!, patch);
    return Response.json({ ok: true });
  });

export const DELETE: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    await repo.deleteDocument(params.id!);
    return Response.json({ ok: true });
  });
