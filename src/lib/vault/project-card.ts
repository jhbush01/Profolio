/**
 * One project, as a card.
 *
 * Shared by Home and the projects index so the two cannot drift: the same
 * project should not look like two different things depending on which page
 * you came in through.
 */
import type { Programme } from './db';
import { currentWeek, elapsedFraction, scoreProgramme, templateFor, totalWeeks } from '../programmes';
import type { VaultDocument } from './types';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** `14 Aug 2026` — the form the design system uses in lists. */
function isoShortDate(iso: string): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : iso;
}

/**
 * One project card.
 *
 * The grid is the page, the way a portfolio site's project grid is. What a
 * portfolio site cannot put on a card is what is still missing — that is the
 * checklist line, and it is the reason to open the app rather than admire it.
 */
export function projectCard(programme: Programme, documents: VaultDocument[]): string {
  const template = templateFor(programme.template);
  const assigned = documents.filter((doc) => doc.programmes.includes(programme.id));
  const closed = programme.closedAt !== null;
  // Archived or closed, the clock has stopped: nothing is "behind" on a
  // project that is no longer being collected for, and saying so is nagging
  // about a decision already made.
  const resting = closed || programme.archived;

  const week = currentWeek(programme.startsOn, programme.endsOn);
  const weeks = totalWeeks(programme.startsOn, programme.endsOn);
  const window =
    programme.startsOn && programme.endsOn
      ? `${isoShortDate(programme.startsOn)} – ${isoShortDate(programme.endsOn)}`
      : 'No dates set';

  let progressLine = `${assigned.length} record${assigned.length === 1 ? '' : 's'}`;
  let percent = 0;
  let missing = '';

  if (template) {
    const elapsed = resting ? null : elapsedFraction(programme.startsOn, programme.endsOn);
    const progress = scoreProgramme(template, assigned, elapsed);
    const done = progress.filter((p) => p.satisfied).length;
    const overdue = progress.filter((p) => p.overdue);
    percent = progress.length > 0 ? Math.round((done / progress.length) * 100) : 0;
    progressLine = `${done} of ${progress.length} items · ${assigned.length} record${assigned.length === 1 ? '' : 's'}`;

    const next = overdue[0] ?? progress.find((p) => !p.satisfied);
    if (overdue.length > 0) {
      missing = `<p class="mt-2.5 text-xs font-medium text-critical">
        Behind: ${escapeHtml(next!.item.label.toLowerCase())}${overdue.length > 1 ? ` and ${overdue.length - 1} more` : ''}
      </p>`;
    } else if (next) {
      missing = `<p class="mt-2.5 text-xs text-ink-muted">Next: ${escapeHtml(next.item.label.toLowerCase())}</p>`;
    } else {
      missing = '<p class="mt-2.5 text-xs font-medium text-positive">Checklist complete</p>';
    }
  }

  return `<a href="/project?id=${encodeURIComponent(programme.id)}"
    class="card flex flex-col p-0 transition hover:border-accent/40 hover:shadow-[0_4px_14px_rgba(77,51,22,0.08)]">
    <!-- Fixed header height, so the rules line up across a row whether a
         title runs to one line or two. -->
    <div class="flex min-h-[6.25rem] items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
      <div class="min-w-0">
        <p class="pf-eyebrow text-ink-faint">${escapeHtml(template?.name ?? 'Project')}</p>
        <h3 class="mt-1.5 text-lg font-semibold leading-snug">${escapeHtml(programme.name)}</h3>
      </div>
      <span class="shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium ${
        resting ? 'bg-canvas text-ink-muted' : 'bg-selected text-positive'
      }">${programme.archived ? 'Archived' : closed ? 'Closed' : 'Collecting'}</span>
    </div>

    <div class="flex flex-1 flex-col px-5 py-4">
      <p class="font-mono text-xs text-ink-muted">${escapeHtml(window)}</p>
      ${week && weeks && !resting ? `<p class="mt-1 font-mono text-xs text-ink-faint">week ${week} of ${weeks}</p>` : ''}

      <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
        <div class="h-full rounded-full bg-accent" style="width:${percent}%"></div>
      </div>
      <p class="mt-2 text-xs text-ink-muted">${escapeHtml(progressLine)}</p>
      ${missing}
    </div>
  </a>`;
}
