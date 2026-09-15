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
    const body = (await request.json()) as DocumentPatch & {
      programmes?: unknown;
      placement?: unknown;
    };

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

    // Assignment lives in its own table, so it is applied separately — but it
    // rides the same request, because the user experiences it as one more thing
    // they tagged the record with.
    let programmes: string[] | undefined;
    if ('programmes' in body) {
      programmes = await repo.setDocumentProgrammes(
        params.id!,
        Array.isArray(body.programmes)
          ? body.programmes.filter((id): id is string => typeof id === 'string')
          : [],
      );
    }

    // Where the record sits on ONE project's checklist. Scoped to a project
    // because that is how the decision is made: you are looking at one
    // checklist and moving a file within it, not editing every project the
    // record happens to belong to.
    let items: string[] | undefined;
    if (body.placement && typeof body.placement === 'object') {
      const placement = body.placement as { programmeId?: unknown; itemIds?: unknown };
      if (typeof placement.programmeId === 'string') {
        items = await repo.setDocumentItems(
          params.id!,
          placement.programmeId,
          Array.isArray(placement.itemIds)
            ? placement.itemIds.filter((id): id is string => typeof id === 'string')
            : [],
        );
      }
    }

    return Response.json({
      ok: true,
      ...(programmes ? { programmes } : {}),
      ...(items ? { items } : {}),
    });
  });

export const DELETE: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    await repo.deleteDocument(params.id!);
    return Response.json({ ok: true });
  });
