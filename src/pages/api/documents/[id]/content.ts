import type { APIRoute } from 'astro';
import { withRepo } from '../../../../lib/server/handler';

export const prerender = false;

/**
 * Parses a single-range `Range: bytes=…` header into R2's shape.
 *
 * Only one range, which is all a media element ever asks for. Anything else —
 * multiple ranges, a unit that is not bytes, nonsense — returns null and the
 * caller answers with the whole object, which is always a valid response.
 */
function parseRange(header: string | null): R2Range | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;

  if (startRaw === '') {
    // "bytes=-500": the last 500 bytes.
    const suffix = Number(endRaw);
    return Number.isFinite(suffix) && suffix > 0 ? { suffix } : null;
  }

  const offset = Number(startRaw);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (endRaw === '') return { offset };

  const end = Number(endRaw);
  if (!Number.isFinite(end) || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

/**
 * Streams a document's bytes back to the owner, for PDF export and previews.
 *
 * Answers byte ranges so video and audio can be scrubbed rather than
 * downloaded whole — without a 206 a browser gives no seek bar, and Safari
 * will not start the file at all. Still `private, no-store`: these are
 * children's work, and a range is no more cacheable than the whole object.
 */
export const GET: APIRoute = ({ request, params }) =>
  withRepo(request, async (repo) => {
    const range = parseRange(request.headers.get('Range'));
    const found = await repo.documentBody(params.id!, range ?? undefined);
    if (!found) return Response.json({ error: 'Not found' }, { status: 404 });

    const headers: Record<string, string> = {
      'Content-Type': found.mime,
      'Content-Length': String(found.length),
      // Private: these are one user's documents, never edge-cacheable.
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="${encodeURIComponent(found.name)}"`,
      // Advertised unconditionally, so a player knows it may seek.
      'Accept-Ranges': 'bytes',
    };

    if (range) {
      headers['Content-Range'] =
        `bytes ${found.offset}-${found.offset + found.length - 1}/${found.total}`;
    }

    return new Response(found.body, { status: range ? 206 : 200, headers });
  });
