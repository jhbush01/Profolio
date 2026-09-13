/**
 * Rendering one project as a finished document.
 *
 * The same data the Report tab edits and the PDF exporter prints, laid out to
 * be read rather than worked in: a cover, the context statement, each practice
 * with its prose and its evidence, and the data collection table.
 *
 * Evidence appears at full size here, which is the thing a PDF of this could
 * never do well and a page does for free — a photograph of a whiteboard is
 * legible, a recording plays, a marked work sample can be looked at rather
 * than squinted at. Printing collapses the recordings to a line of text,
 * because paper cannot play them and pretending otherwise leaves a black box.
 */
import {
  describeError,
  isAuthError,
  loadProgrammes,
  loadVault,
  reloadForAuth,
  type Programme,
} from './db';
import { outlineFor, templateFor, totalWeeks, writtenFor } from '../programmes';
import { buildProfileRows, PROFILE_COLUMNS, rowCells } from './profile-table';
import { contextLines } from './report';
import { kindLabel } from './file-browser';
import { renderKindFor } from './types';
import type { VaultDocument, VaultProfile } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function isoShortDate(iso: string): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : iso;
}

function setStatus(message: string) {
  const host = $('showcase-status');
  if (host) host.textContent = message;
}

/* ------------------------------------------------------------------ blocks */

function coverBlock(profile: VaultProfile, programme: Programme, count: number): string {
  const template = templateFor(programme.template);
  const weeks = totalWeeks(programme.startsOn, programme.endsOn);
  const window =
    programme.startsOn && programme.endsOn
      ? `${isoShortDate(programme.startsOn)} – ${isoShortDate(programme.endsOn)}`
      : '';

  const meta = [
    template?.name,
    window,
    weeks ? `${weeks} week${weeks === 1 ? '' : 's'}` : '',
    `${count} piece${count === 1 ? '' : 's'} of evidence`,
  ].filter(Boolean);

  return `<header class="pf-section border-b border-line pb-10">
    <div class="flex items-start gap-5">
      ${
        profile.avatarUpdatedAt
          ? `<img src="/api/profile/avatar?v=${profile.avatarUpdatedAt}" alt=""
               onerror="this.remove()"
               class="size-20 shrink-0 rounded-md border border-line-subtle object-cover" />`
          : ''
      }
      <div class="min-w-0">
        <p class="pf-eyebrow text-ink-faint">${escapeHtml(profile.title || 'Teaching portfolio')}</p>
        <h1 class="mt-2 font-display text-4xl font-normal leading-tight tracking-[-0.02em] sm:text-5xl">
          ${escapeHtml(programme.name)}
        </h1>
        <p class="mt-3 text-base text-ink-muted">${escapeHtml(profile.name || '')}</p>
        <p class="mt-1 font-mono text-xs text-ink-faint">${escapeHtml(meta.join(' · '))}</p>
      </div>
    </div>
    ${
      profile.summary
        ? `<p class="prose-body mt-6 max-w-[60ch] text-base">${escapeHtml(profile.summary)}</p>`
        : ''
    }
  </header>`;
}

/** The context statement, as a two-column list rather than a paragraph. */
function contextBlock(lines: string[]): string {
  if (lines.length === 0) return '';

  const rows = lines
    .map((line) => {
      const at = line.indexOf(':');
      const label = at > 0 ? line.slice(0, at) : line;
      const value = at > 0 ? line.slice(at + 1).trim() : '';
      return `<div class="flex gap-3 border-t border-line-subtle py-1.5">
        <dt class="w-48 shrink-0 text-xs text-ink-faint">${escapeHtml(label)}</dt>
        <dd class="min-w-0 flex-1 text-sm">${escapeHtml(value)}</dd>
      </div>`;
    })
    .join('');

  return `<dl class="mt-5">${rows}</dl>`;
}

/**
 * One piece of evidence, shown rather than listed.
 *
 * An image at its own size, a recording that plays, a PDF as a labelled card.
 * The caption is the annotation — an artefact with nothing written about it is
 * a file, not evidence — so it sits under the thing as a real caption.
 */
function evidenceFigure(doc: VaultDocument): string {
  const kind = renderKindFor(doc.mime, doc.name);
  const src = `/api/documents/${encodeURIComponent(doc.id)}/content`;

  const body =
    kind === 'image'
      ? // No `w-full`: a 400px photograph of a whiteboard blown up to the
        // measure is worse than the same photograph at its own size. It is
        // capped, centred, and otherwise left alone. `onerror` swaps in a line
        // of text, because a missing image is otherwise an unexplained gap.
        `<img src="${src}" alt="${escapeHtml(doc.caption || doc.name)}" loading="lazy"
           onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'rounded-md border border-line bg-canvas px-4 py-5 text-center text-xs text-ink-muted',textContent:'${escapeHtml(
             doc.name,
           ).replace(/'/g, "\\'")} could not be displayed.'}))"
           class="mx-auto block max-h-[26rem] w-auto max-w-full rounded-md border border-line-subtle bg-canvas" />`
      : kind === 'video'
        ? `<video src="${src}" controls playsinline preload="metadata"
             class="max-h-[28rem] w-full rounded-md bg-ink"></video>
           <span class="hidden print:block rounded-md border border-line bg-canvas px-3 py-6 text-center text-xs text-ink-muted">
             Video recording — ${escapeHtml(doc.name)}. Plays in the online version.
           </span>`
        : kind === 'audio'
          ? `<audio src="${src}" controls preload="metadata" class="w-full"></audio>`
          : `<a href="${src}" class="block rounded-md border border-line bg-canvas px-4 py-5 text-center transition hover:border-accent/40">
               <span class="font-mono text-xs text-ink-faint">${escapeHtml(kindLabel(doc))}</span>
               <span class="mt-1 block text-sm font-medium">${escapeHtml(doc.name)}</span>
             </a>`;

  return `<figure class="mt-4">
    ${body}
    ${
      doc.caption
        ? `<figcaption class="prose-body mt-2 text-xs">${escapeHtml(doc.caption)}</figcaption>`
        : `<figcaption class="mt-2 font-mono text-[0.7rem] text-ink-faint">${escapeHtml(doc.name)}</figcaption>`
    }
  </figure>`;
}

/** The data collection table, at the heading its template puts it under. */
function tableBlock(records: VaultDocument[]): string {
  const rows = buildProfileRows(records);
  if (rows.length === 0) return '';

  // The table is the one thing here wider than the reading measure, so it gets
  // to break out of it rather than being crushed into it.
  return `<div class="mt-6 overflow-x-auto lg:-mx-16">
    <table class="w-full min-w-[48rem] border-collapse text-left text-[0.7rem]">
      <thead>
        <tr class="border-b border-line">
          <th class="py-2 pr-3 font-medium">Evidence</th>
          ${PROFILE_COLUMNS.map((column) => `<th class="py-2 pr-3 font-medium">${escapeHtml(column)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr class="border-b border-line-subtle">
              <td class="py-1.5 pr-3 font-medium">${escapeHtml(row.documentName)}</td>
              ${rowCells(row)
                .map((cell) => `<td class="py-1.5 pr-3 text-ink-muted">${escapeHtml(cell)}</td>`)
                .join('')}
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

/* ----------------------------------------------------------------- wiring */

export async function initShowcase() {
  const host = $('showcase');
  if (!host) return;

  const id = new URLSearchParams(window.location.search).get('id') ?? '';

  const back = $<HTMLAnchorElement>('showcase-back');
  if (back && id) back.href = `/project?id=${encodeURIComponent(id)}&tab=report`;

  $('showcase-print')?.addEventListener('click', () => window.print());

  $('showcase-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      // Said plainly, because a "share" that only the owner can open is a
      // promise this app must not appear to make.
      setStatus('Link copied. It only opens for you — signing in is still required.');
    } catch {
      setStatus('Could not copy. Use the address bar.');
    }
  });

  try {
    const [snapshot, programmeData] = await Promise.all([loadVault(), loadProgrammes()]);
    const programme = programmeData.programmes.find((p) => p.id === id);
    if (!programme) {
      host.innerHTML = `<p class="py-16 text-center text-sm text-ink-muted">That project is not here.</p>`;
      return;
    }

    document.title = `${programme.name} — Profolio`;

    const template = templateFor(programme.template);
    const records = snapshot.documents.filter((doc) => doc.programmes.includes(programme.id));
    const written = programme.report ?? {};
    const lines = contextLines(programme);

    const sections = template
      ? outlineFor(template)
          .map((heading, index) => {
            const items = template.items.filter((item) =>
              (heading.sections ?? []).includes(item.section),
            );
            const matched = records.filter((doc) =>
              items.some((item) => {
                try {
                  return item.matches(doc);
                } catch {
                  return false;
                }
              }),
            );
            const prose = writtenFor(written, heading).trim();

            // A heading with no prose, no evidence and no table of its own is
            // an empty chapter. A document does not print those.
            const showsContext = heading.includesContext && lines.length > 0;
            const showsTable = heading.includesDataProfile && records.length > 0;
            if (!prose && matched.length === 0 && !showsContext && !showsTable) return '';

            const paragraphs = prose
              .split(/\n\s*\n/)
              .map((block) => block.replace(/\s+/g, ' ').trim())
              .filter(Boolean)
              .map((block) => `<p class="prose-body mt-3 max-w-[62ch] text-[0.95rem] text-ink">${escapeHtml(block)}</p>`)
              .join('');

            return `<section class="pf-section ${index > 0 ? 'pf-break' : ''} pt-10">
              <h2 class="font-display text-2xl font-normal tracking-[-0.01em]">${escapeHtml(heading.title)}</h2>
              ${showsContext ? contextBlock(lines) : ''}
              ${paragraphs}
              ${matched.map(evidenceFigure).join('')}
              ${showsTable ? tableBlock(records) : ''}
            </section>`;
          })
          .join('')
      : '';

    host.innerHTML = `${coverBlock(snapshot.profile, programme, records.length)}${
      sections ||
      `<p class="py-16 text-center text-sm text-ink-muted">
         Nothing written yet. The Report tab is where this fills in.
       </p>`
    }`;
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    host.innerHTML = `<p class="py-16 text-center text-sm text-critical">
      Could not load this: ${escapeHtml(describeError(error))}
    </p>`;
  }
}
