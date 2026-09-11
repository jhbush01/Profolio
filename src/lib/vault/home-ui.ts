/**
 * The hub — what a signed-in practitioner lands on.
 *
 * Scaled to how much record exists rather than to a fixed layout. With one
 * placement running, career totals ("48 records held") say nothing useful, so
 * the live programme is the page and the rest is context. Years later the same
 * page is mostly the list of programmes.
 *
 * Read-only by design: every action here is a link to the page that owns it.
 */
import { ApiError, loadProgrammes, loadVault, type Programme } from './db';
import { isComplete, missingDimensions } from './dimensions';
import { currentWeek, elapsedFraction, scoreProgramme, templateFor, totalWeeks } from '../programmes';
import type { VaultDocument, VaultProfile } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** `14 Aug 2026` — the form the design system uses in lists. */
function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isoShortDate(iso: string): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed) ? shortDate(parsed) : iso;
}

function initials(profile: VaultProfile, email: string): string {
  const source = profile.name.trim() || email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}

/** Programmes still collecting: not closed, not archived. */
function openProgrammes(programmes: Programme[]): Programme[] {
  return programmes.filter((p) => p.closedAt === null && !p.archived);
}

/**
 * The programme the page leads with: the open one whose window covers today,
 * most recently started first. Falls back to the newest open programme so an
 * undated one still surfaces.
 */
function leadProgramme(programmes: Programme[]): Programme | undefined {
  const open = openProgrammes(programmes);
  const today = new Date().toISOString().slice(0, 10);
  const running = open
    .filter((p) => p.startsOn && p.endsOn && p.startsOn <= today && today <= p.endsOn)
    .sort((a, b) => (a.startsOn! < b.startsOn! ? 1 : -1));
  return running[0] ?? open[0];
}

/* --------------------------------------------------------------- sections */

function headerBlock(profile: VaultProfile, email: string): string {
  const named = profile.name.trim().length > 0;
  const role = [profile.title.trim(), profile.summary.trim()].filter(Boolean).join(' · ');

  // Stacked on a phone: side by side, the buttons squeeze the name into a
  // one-word-per-line column.
  return `<div class="flex flex-col gap-5 sm:flex-row sm:items-start">
    <div class="flex min-w-0 flex-1 items-start gap-4">
      <div class="flex size-16 shrink-0 items-center justify-center rounded-md bg-accent-soft font-display text-2xl text-accent">
        ${escapeHtml(initials(profile, email))}
      </div>
      <div class="min-w-0 flex-1">
        <h1 class="font-display text-3xl font-normal tracking-[-0.02em] sm:text-5xl ${named ? '' : 'text-ink-faint'}">
          ${escapeHtml(named ? profile.name : 'Your name')}
        </h1>
        <p class="prose-body mt-1 text-sm">
          ${role ? escapeHtml(role) : 'Your name and role print on the front page of every export.'}
        </p>
        <a href="/portfolio" class="mt-1 inline-block text-xs font-medium text-accent hover:underline">
          ${named ? 'Edit cover details' : 'Add cover details'}
        </a>
      </div>
    </div>
    <div class="flex shrink-0 gap-2">
      <a href="/capture" class="flex-1 rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-white transition hover:opacity-90 sm:flex-none">
        Capture evidence
      </a>
      <a href="/portfolio" class="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-center text-sm font-medium transition hover:border-accent/40 sm:flex-none">
        Export
      </a>
    </div>
  </div>`;
}

/** The live programme, given the whole page over to it while one is running. */
function leadProgrammeBlock(programme: Programme, documents: VaultDocument[]): string {
  const template = templateFor(programme.template);
  if (!template) return '';

  const assigned = documents.filter((doc) => doc.programmes.includes(programme.id));
  const elapsed = elapsedFraction(programme.startsOn, programme.endsOn);
  const progress = scoreProgramme(template, assigned, elapsed);
  const done = progress.filter((p) => p.satisfied).length;
  const overdue = progress.filter((p) => p.overdue).length;
  const percent = progress.length > 0 ? Math.round((done / progress.length) * 100) : 0;

  const week = currentWeek(programme.startsOn, programme.endsOn);
  const weeks = totalWeeks(programme.startsOn, programme.endsOn);
  const windowLabel =
    programme.startsOn && programme.endsOn
      ? `${isoShortDate(programme.startsOn)} – ${isoShortDate(programme.endsOn)}${week && weeks ? ` · week ${week} of ${weeks}` : ''}`
      : 'No dates set';

  const sections = [...new Set(template.items.map((item) => item.section))];
  const tiles = sections
    .map((section) => {
      // Items, not records — so the tiles add up to the count in the header.
      const rows = progress.filter((p) => p.item.section === section);
      const got = rows.filter((p) => p.satisfied).length;
      const need = rows.length;
      const behind = rows.some((p) => p.overdue);
      return `<div class="flex flex-1 flex-col gap-1.5 rounded-md bg-canvas px-4 py-3">
        <span class="pf-eyebrow text-ink-faint">${escapeHtml(section)}</span>
        <span class="font-mono text-sm ${behind ? 'text-critical' : 'text-positive'}">${got} of ${need}</span>
      </div>`;
    })
    .join('');

  return `<section class="card flex flex-col gap-4 p-6 shadow-[0_1px_3px_rgba(77,51,22,0.07)]">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="pf-eyebrow text-ink-faint">Collecting now</p>
        <h2 class="mt-1.5 font-display text-3xl font-normal tracking-[-0.02em]">${escapeHtml(programme.name)}</h2>
        <p class="mt-1.5 font-mono text-xs text-ink-muted">${escapeHtml(windowLabel)}</p>
      </div>
      <div class="text-right">
        <p>
          <span class="font-display text-4xl font-normal">${done}</span>
          <span class="text-sm text-ink-muted">of ${progress.length} collected</span>
        </p>
        <p class="text-xs text-ink-muted">${assigned.length} record${assigned.length === 1 ? '' : 's'} in this programme</p>
        ${overdue > 0 ? `<p class="text-xs font-medium text-critical">${overdue} behind schedule</p>` : ''}
      </div>
    </div>

    <div class="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
      <div class="h-full rounded-full bg-accent" style="width:${percent}%"></div>
    </div>

    <div class="flex flex-wrap gap-3">${tiles}</div>

    <a href="/programmes" class="text-sm font-medium text-accent hover:underline">Open this programme →</a>
  </section>`;
}

interface Attention {
  tone: 'critical' | 'caution' | 'muted';
  title: string;
  detail: string;
  href: string;
  action: string;
}

/**
 * Unfinished business, and only things that can actually reach zero. No
 * completeness meter: a permanent nag is not a task.
 */
function attentionItems(documents: VaultDocument[], programmes: Programme[]): Attention[] {
  const items: Attention[] = [];

  for (const programme of openProgrammes(programmes)) {
    const template = templateFor(programme.template);
    if (!template) continue;
    const assigned = documents.filter((doc) => doc.programmes.includes(programme.id));
    const elapsed = elapsedFraction(programme.startsOn, programme.endsOn);
    const overdue = scoreProgramme(template, assigned, elapsed).filter((p) => p.overdue);
    if (overdue.length > 0) {
      items.push({
        tone: 'critical',
        title: `${overdue.length} checklist item${overdue.length === 1 ? '' : 's'} behind schedule`,
        detail: `${escapeHtml(programme.name)} · ${overdue.map((p) => p.item.label.toLowerCase()).slice(0, 2).join(', ')}.`,
        href: '/programmes',
        action: 'Open',
      });
    }
  }

  const incomplete = documents.filter((doc) => !isComplete(doc));
  if (incomplete.length > 0) {
    const gap = missingDimensions(incomplete[0]!)[0] ?? 'detail';
    items.push({
      tone: 'caution',
      title: `${incomplete.length} record${incomplete.length === 1 ? '' : 's'} missing detail`,
      detail: `Starting with ${escapeHtml(gap)}. Records without it are left out of your data collection profile.`,
      href: '/portfolio',
      action: 'Review',
    });
  }

  const unassigned = documents.filter((doc) => doc.programmes.length === 0);
  if (unassigned.length > 0 && openProgrammes(programmes).length > 0) {
    items.push({
      tone: 'muted',
      title: `${unassigned.length} record${unassigned.length === 1 ? '' : 's'} not in a programme`,
      detail: 'Kept in your evidence, but counting toward nothing until you assign them.',
      href: '/portfolio',
      action: 'Assign',
    });
  }

  return items;
}

function attentionBlock(items: Attention[]): string {
  if (items.length === 0) return '';

  const rows = items
    .map(
      (item, index) => `<div class="flex items-start gap-3 border-t border-line py-3.5 ${index === items.length - 1 ? 'pb-0' : ''}">
        <span class="mt-1.5 size-2 shrink-0 rounded-full ${
          item.tone === 'critical' ? 'bg-critical' : item.tone === 'caution' ? 'bg-caution' : 'bg-taupe'
        }"></span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">${escapeHtml(item.title)}</p>
          <p class="prose-body mt-0.5 text-xs">${item.detail}</p>
        </div>
        <a href="${item.href}" class="shrink-0 self-center text-xs font-medium text-accent hover:underline">${escapeHtml(item.action)}</a>
      </div>`,
    )
    .join('');

  return `<section class="card p-6">
    <div class="flex items-center gap-2.5 pb-1.5">
      <h2 class="text-xl font-semibold">Needs attention</h2>
      <span class="rounded-sm bg-caution-surface px-2 py-0.5 text-xs font-medium text-caution">${items.length}</span>
    </div>
    ${rows}
  </section>`;
}

function recentBlock(documents: VaultDocument[], programmes: Programme[]): string {
  const recent = [...documents].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5);
  if (recent.length === 0) return '';

  const nameFor = new Map(programmes.map((p) => [p.id, p.name]));

  const rows = recent
    .map((doc, index) => {
      const chips = doc.programmes
        .map((id) => nameFor.get(id))
        .filter((name): name is string => Boolean(name))
        .map(
          (name) =>
            `<span class="rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">${escapeHtml(name)}</span>`,
        )
        .join('');

      return `<div class="flex flex-wrap items-center gap-3 border-t border-line py-3 ${index === recent.length - 1 ? 'pb-0' : ''}">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</p>
          <p class="mt-0.5 text-xs text-ink-faint">
            <span class="font-mono">${escapeHtml(shortDate(doc.addedAt))}</span>
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap gap-1.5">
          ${
            chips ||
            '<span class="rounded-sm border border-dashed border-line bg-canvas px-2 py-0.5 text-xs text-ink-faint">Unassigned</span>'
          }
        </div>
      </div>`;
    })
    .join('');

  return `<section class="card p-6">
    <div class="flex items-baseline justify-between gap-4 pb-1.5">
      <h2 class="text-xl font-semibold">Recently captured</h2>
      <a href="/portfolio" class="text-xs font-medium text-accent hover:underline">All evidence</a>
    </div>
    ${rows}
  </section>`;
}

/**
 * What the lead programme produces. A different template asks for different
 * things, which is the point — this is where a programme's own character shows.
 */
function outputsBlock(programme: Programme | undefined, deidAcknowledged: boolean, documents: VaultDocument[]): string {
  if (!programme) return '';
  const template = templateFor(programme.template);
  if (!template) return '';

  const rows: string[] = [];

  if (template.contextFields.length > 0) {
    const answered = template.contextFields.filter((f) => programme.context[f.id]?.trim()).length;
    const total = template.contextFields.length;
    rows.push(
      row(
        answered === total,
        'Context statement',
        `${answered} of ${total} answered`,
        '/programmes',
        answered === total ? 'View' : 'Finish',
      ),
    );
  }

  const assigned = documents.filter((doc) => doc.programmes.includes(programme.id));
  const incomplete = assigned.filter((doc) => !isComplete(doc)).length;
  rows.push(
    row(
      incomplete === 0 && assigned.length > 0,
      'Data collection profile',
      incomplete === 0
        ? `${assigned.length} row${assigned.length === 1 ? '' : 's'}, all complete`
        : `${incomplete} row${incomplete === 1 ? '' : 's'} incomplete`,
      '/data-profile',
      incomplete === 0 ? 'View' : 'Fix',
    ),
  );

  rows.push(
    row(deidAcknowledged, 'De-identification', deidAcknowledged ? 'Acknowledged' : 'Not acknowledged yet', '/portfolio', deidAcknowledged ? '' : 'Read'),
  );

  return `<section class="card p-6">
    <h3 class="text-base font-semibold">What this programme produces</h3>
    <p class="prose-body mb-1.5 mt-1 text-xs">Another programme asks for different things.</p>
    ${rows.join('')}
  </section>`;

  function row(ok: boolean, title: string, detail: string, href: string, action: string): string {
    return `<div class="flex items-center gap-3 border-t border-line py-3">
      <span class="mt-0 size-2 shrink-0 rounded-full ${ok ? 'bg-positive' : 'bg-caution'}"></span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">${escapeHtml(title)}</p>
        <p class="text-xs text-ink-muted">${escapeHtml(detail)}</p>
      </div>
      ${action ? `<a href="${href}" class="shrink-0 text-xs font-medium text-accent hover:underline">${escapeHtml(action)}</a>` : ''}
    </div>`;
  }
}

function programmesBlock(programmes: Programme[], documents: VaultDocument[]): string {
  if (programmes.length === 0) return '';

  const rows = programmes
    .slice(0, 6)
    .map((programme) => {
      const count = documents.filter((doc) => doc.programmes.includes(programme.id)).length;
      const closed = programme.closedAt !== null;
      const window =
        programme.startsOn && programme.endsOn
          ? `${isoShortDate(programme.startsOn)} – ${isoShortDate(programme.endsOn)}`
          : 'No dates set';
      return `<div class="flex items-center gap-3 border-t border-line py-3">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">${escapeHtml(programme.name)}</p>
          <p class="mt-0.5 font-mono text-xs text-ink-muted">${escapeHtml(window)} · ${count} record${count === 1 ? '' : 's'}</p>
        </div>
        <span class="shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium ${
          closed ? 'bg-canvas text-ink-muted' : 'bg-selected text-positive'
        }">${closed ? 'Closed' : 'Collecting'}</span>
      </div>`;
    })
    .join('');

  return `<section class="card p-6">
    <div class="flex items-baseline justify-between gap-4 pb-1.5">
      <h3 class="text-base font-semibold">My programmes</h3>
      <a href="/programmes" class="text-xs font-medium text-accent hover:underline">All</a>
    </div>
    ${rows}
  </section>`;
}

/** Day one. Says what belongs here and offers the one action that fills it. */
function emptyBlock(hasProgramme: boolean): string {
  return `<section class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line bg-canvas px-8 py-16 text-center">
    <h2 class="text-xl font-semibold">Nothing recorded yet</h2>
    <p class="prose-body max-w-[52ch] text-sm">
      ${
        hasProgramme
          ? 'Capture a piece of evidence and it appears here, dated and kept, counting toward the programme you are collecting for.'
          : 'Start with what you are collecting for — a final placement, a registration year. Evidence you capture then has somewhere to go, and the programme tells you what is still missing while there is time to collect it.'
      }
    </p>
    <div class="flex flex-wrap justify-center gap-2">
      ${
        hasProgramme
          ? `<a href="/capture" class="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90">Capture evidence</a>`
          : `<a href="/programmes" class="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90">Start a programme</a>
             <a href="/capture" class="rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-medium transition hover:border-accent/40">Capture evidence</a>`
      }
    </div>
    <p class="text-xs text-ink-faint">You can capture first and assign it to a programme later.</p>
  </section>`;
}

/* ---------------------------------------------------------------- wiring */

export async function initHome() {
  const host = $('home');
  if (!host) return;

  try {
    const [snapshot, programmeData] = await Promise.all([loadVault(), loadProgrammes()]);
    const { documents, profile, signedInAs, deidAcknowledged } = snapshot;
    const programmes = programmeData.programmes;

    const lead = leadProgramme(programmes);
    const attention = attentionItems(documents, programmes);

    // With nothing captured the page is a single empty state; the panels below
    // would all be zeroes, which says less than one clear sentence does.
    const body =
      documents.length === 0
        ? emptyBlock(programmes.length > 0)
        : `<div class="flex flex-col gap-7">
            ${lead ? leadProgrammeBlock(lead, documents) : ''}
            <div class="grid gap-7 lg:grid-cols-[1.6fr_1fr]">
              <div class="flex flex-col gap-5">
                ${attentionBlock(attention)}
                ${recentBlock(documents, programmes)}
              </div>
              <div class="flex flex-col gap-5">
                ${outputsBlock(lead, deidAcknowledged, documents)}
                ${programmesBlock(programmes, documents)}
              </div>
            </div>
          </div>`;

    host.innerHTML = `<div class="flex flex-col gap-8">
      ${headerBlock(profile, signedInAs)}
      ${body}
    </div>`;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      window.location.reload();
      return;
    }
    host.innerHTML = `<p class="card p-6 text-sm text-critical">
      Could not load your record: ${escapeHtml(error instanceof Error ? error.message : String(error))}
    </p>`;
  }
}
