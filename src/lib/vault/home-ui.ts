/**
 * Your ProFolio — what a signed-in practitioner lands on.
 *
 * A grid of projects, the way a portfolio site presents work, because that is
 * the shape people already know. The two things a portfolio site cannot do are
 * what the cards carry: each one says what is still missing, and opening one
 * shows the evidence organised inside it rather than a flat pile.
 *
 * "Project" is the word on screen for what the code calls a programme. The
 * rename stops at the UI on purpose — routes, API and schema still say
 * programme, and moving those is its own change.
 *
 * Read-only by design: every action here is a link to the page that owns it.
 */
import { describeError, isAuthError, loadProgrammes, loadVault, reloadForAuth, type Programme } from './db';
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
        <p class="pf-eyebrow text-ink-faint">Your ProFolio</p>
        <h1 class="mt-1.5 font-display text-3xl font-normal tracking-[-0.02em] sm:text-5xl ${named ? '' : 'text-ink-faint'}">
          ${escapeHtml(named ? profile.name : 'Your name')}
        </h1>
        <p class="prose-body mt-1 text-sm">
          ${role ? escapeHtml(role) : 'Shown on the cover of every export.'}
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
      <a href="/export" class="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-center text-sm font-medium transition hover:border-accent/40 sm:flex-none">
        Export
      </a>
    </div>
  </div>`;
}

/**
 * One project card.
 *
 * The grid is the page, the way a portfolio site's project grid is. What a
 * portfolio site cannot put on a card is what is still missing — that is the
 * checklist line, and it is the reason to open the app rather than admire it.
 */
function projectCard(programme: Programme, documents: VaultDocument[]): string {
  const template = templateFor(programme.template);
  const assigned = documents.filter((doc) => doc.programmes.includes(programme.id));
  const closed = programme.closedAt !== null;

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
    const elapsed = closed ? null : elapsedFraction(programme.startsOn, programme.endsOn);
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
        closed ? 'bg-canvas text-ink-muted' : 'bg-selected text-positive'
      }">${closed ? 'Closed' : 'Collecting'}</span>
    </div>

    <div class="flex flex-1 flex-col px-5 py-4">
      <p class="font-mono text-xs text-ink-muted">${escapeHtml(window)}</p>
      ${week && weeks && !closed ? `<p class="mt-1 font-mono text-xs text-ink-faint">week ${week} of ${weeks}</p>` : ''}

      <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
        <div class="h-full rounded-full bg-accent" style="width:${percent}%"></div>
      </div>
      <p class="mt-2 text-xs text-ink-muted">${escapeHtml(progressLine)}</p>
      ${missing}
    </div>
  </a>`;
}

/**
 * The grid of projects.
 *
 * Starting one is a button in the section header, not a dashed tile in the
 * grid. A tile that is not a project should not be sitting in the row of
 * projects at project size, and /programmes is where both starting and
 * managing happen anyway.
 */
function projectGrid(programmes: Programme[], documents: VaultDocument[]): string {
  const cards = programmes.map((programme) => projectCard(programme, documents)).join('');

  return `<section class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <h2 class="text-xl font-semibold">Your projects</h2>
      <a href="/programmes"
        class="shrink-0 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-accent/40 hover:text-accent">
        New project
      </a>
    </div>
    ${
      programmes.length === 0
        ? '<p class="prose-body text-sm">No projects yet.</p>'
        : `<div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">${cards}</div>`
    }
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
      detail: `Missing ${escapeHtml(gap)}. Left out of the data collection profile until it is filled in.`,
      href: '/portfolio',
      action: 'Review',
    });
  }

  const unassigned = documents.filter((doc) => doc.programmes.length === 0);
  if (unassigned.length > 0 && openProgrammes(programmes).length > 0) {
    items.push({
      tone: 'muted',
      title: `${unassigned.length} record${unassigned.length === 1 ? '' : 's'} not in a project`,
      detail: 'Not counted toward any project yet.',
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
 * things, which is the point — this is where a project's own character shows.
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
    <h3 class="text-base font-semibold">What this project produces</h3>
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

/** Day one. Says what belongs here and offers the one action that fills it. */
function emptyBlock(hasProgramme: boolean): string {
  return `<section class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line bg-canvas px-8 py-16 text-center">
    <h2 class="text-xl font-semibold">Nothing recorded yet</h2>
    <p class="prose-body max-w-[52ch] text-sm">
      ${
        hasProgramme
          ? 'Capture evidence and it appears here, dated and assigned to the project you are collecting for.'
          : 'Start a project first: a final placement, a registration year. It comes with a checklist, and evidence you capture has somewhere to go.'
      }
    </p>
    <div class="flex flex-wrap justify-center gap-2">
      ${
        hasProgramme
          ? `<a href="/capture" class="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90">Capture evidence</a>`
          : `<a href="/programmes" class="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90">Start a project</a>
             <a href="/capture" class="rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-medium transition hover:border-accent/40">Capture evidence</a>`
      }
    </div>
    <p class="text-xs text-ink-faint">You can capture now and assign later.</p>
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

    // With nothing captured and nothing started, the page is a single empty
    // state; a grid of zeroes says less than one clear sentence does.
    const body =
      documents.length === 0 && programmes.length === 0
        ? emptyBlock(false)
        : `<div class="flex flex-col gap-8">
            ${projectGrid(programmes, documents)}
            <div class="grid gap-7 lg:grid-cols-[1.6fr_1fr]">
              <div class="flex flex-col gap-5">
                ${attentionBlock(attention)}
                ${recentBlock(documents, programmes)}
              </div>
              <div class="flex flex-col gap-5">
                ${outputsBlock(lead, deidAcknowledged, documents)}
              </div>
            </div>
          </div>`;

    host.innerHTML = `<div class="flex flex-col gap-8">
      ${headerBlock(profile, signedInAs)}
      ${body}
    </div>`;
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    host.innerHTML = `<p class="card p-6 text-sm text-critical">
      Could not load your ProFolio: ${escapeHtml(describeError(error))}
    </p>`;
  }
}
