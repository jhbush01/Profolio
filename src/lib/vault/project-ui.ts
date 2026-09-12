/**
 * One project, opened.
 *
 * The evidence is grouped under the checklist item each record answers, which
 * is the point of the page: a portfolio site can show you twenty files, but it
 * cannot tell you that three of them are your assessment data and that nothing
 * yet covers moderation. Records matching several items appear under each,
 * because that is how they count.
 *
 * "Project" on screen, programme in the code — see home-ui.ts.
 */
import {
  describeError,
  documentBytes,
  emptyProfile,
  isAuthError,
  reloadForAuth,
  deleteProgramme,
  loadProgrammes,
  loadVault,
  updateDocument,
  updateProgramme,
  type Programme,
} from './db';
import { isComplete, missingDimensions } from './dimensions';
import { wireViewer } from './viewer';
import { buildPortfolioPdf } from './pdf';
import { reportSections } from './report';
import {
  currentWeek,
  elapsedFraction,
  matchesItem,
  scoreProgramme,
  suggestForProgramme,
  templateFor,
  totalWeeks,
  type ProgrammeTemplate,
} from '../programmes';
import type { VaultDocument, VaultFolder, VaultProfile } from './types';

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

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

let programme: Programme | undefined;
let template: ProgrammeTemplate | undefined;
let documents: VaultDocument[] = [];
/** Needed by the Hub tab's outputs panel. */
let deidAcknowledged = false;
/** Needed to export this project on its own. */
let profile: VaultProfile = emptyProfile;
let folders: VaultFolder[] = [];

const TABS = [
  { id: 'hub', label: 'Hub' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'context', label: 'Context' },
  { id: 'report', label: 'Report' },
  { id: 'settings', label: 'Settings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Which tab is open, kept in the URL so a project view can be linked to and
 * survives a refresh — and so the browser's own back button works inside a
 * project, rather than throwing you out to the grid.
 */
let tab: TabId = 'hub';

const projectId = () => new URLSearchParams(window.location.search).get('id') ?? '';

function readTab(): TabId {
  const raw = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((t) => t.id === raw) ? (raw as TabId) : 'hub';
}

function setTab(next: TabId) {
  tab = next;
  const params = new URLSearchParams(window.location.search);
  params.set('tab', next);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
}

function assigned(): VaultDocument[] {
  return programme ? documents.filter((doc) => doc.programmes.includes(programme!.id)) : [];
}

function setStatus(message: string, busy = false) {
  const host = $('project-status');
  if (!host) return;
  host.textContent = message;
  host.classList.toggle('animate-pulse', busy);
}

async function guard(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    setStatus(`${label} failed: ${describeError(error)}`);
  }
}

/* -------------------------------------------------------------- rendering */

function evidenceRow(doc: VaultDocument, closed: boolean, alsoCounts = 0): string {
  return `<li class="flex items-center gap-3 border-t border-line-subtle py-2.5">
    <span class="min-w-0 flex-1">
      <button type="button" data-view="${doc.id}" title="${escapeHtml(doc.name)}"
        class="block max-w-full truncate text-left text-sm font-medium transition hover:text-accent hover:underline">
        ${escapeHtml(doc.name)}
      </button>
      <span class="mt-0.5 block text-xs text-ink-faint">
        <span class="font-mono">${escapeHtml(shortDate(doc.addedAt))}</span>${
          isComplete(doc) ? '' : ' · <span class="text-caution">missing detail</span>'
        }${
          // One record can answer several items, so it is listed under each.
          // Say so, or the repeat reads as the page rendering it twice.
          alsoCounts > 0 ? ` · also counts toward ${alsoCounts} other item${alsoCounts === 1 ? '' : 's'}` : ''
        }
      </span>
    </span>
    ${
      closed
        ? ''
        : `<button type="button" data-unassign="${doc.id}"
             class="shrink-0 text-xs text-ink-faint underline underline-offset-2 hover:text-critical">Remove</button>`
    }
  </li>`;
}

/** The checklist, with each item's evidence nested underneath it. */
function checklistBlock(closed: boolean): string {
  if (!template || !programme) return '';

  const records = assigned();
  const elapsed = closed ? null : elapsedFraction(programme.startsOn, programme.endsOn);
  const progress = scoreProgramme(template, records, elapsed);
  const sections = [...new Set(template.items.map((item) => item.section))];

  const blocks = sections
    .map((section) => {
      const rows = progress
        .filter((p) => p.item.section === section)
        .map((p) => {
          const matched = records.filter((doc) => matchesItem(p.item, doc));
          const tone = p.satisfied ? 'text-positive' : p.overdue ? 'text-critical' : 'text-ink-faint';
          const mark = p.satisfied ? '✓' : p.overdue ? '!' : '○';

          return `<div class="border-t border-line py-4">
            <div class="flex items-start gap-3">
              <span aria-hidden="true" class="mt-0.5 w-3 shrink-0 text-center text-sm ${tone}">${mark}</span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">
                  ${escapeHtml(p.item.label)}
                  <span class="font-mono text-xs font-normal text-ink-muted">${p.matched} of ${p.item.requires}</span>
                </p>
                <p class="prose-body mt-0.5 text-xs">${escapeHtml(p.item.detail)}</p>
                ${
                  matched.length > 0
                    ? `<ul class="mt-2">${matched
                        .map((doc) =>
                          evidenceRow(
                            doc,
                            closed,
                            template!.items.filter((other) => other !== p.item && matchesItem(other, doc)).length,
                          ),
                        )
                        .join('')}</ul>`
                    : `<p class="mt-2 rounded-md border border-dashed border-line bg-canvas px-3 py-2 text-xs text-ink-faint">
                         Nothing here yet.${closed ? '' : ' Capture it, or add a record that already fits.'}
                       </p>`
                }
              </div>
            </div>
          </div>`;
        })
        .join('');

      return `<section class="card p-6">
        <h2 class="pb-1 text-lg font-semibold">${escapeHtml(section)}</h2>
        ${rows}
      </section>`;
    })
    .join('');

  return blocks;
}

/** Assigned records that answer nothing on the checklist — still theirs to keep. */
function extraBlock(closed: boolean): string {
  if (!template) return '';
  const records = assigned().filter((doc) => !template!.items.some((item) => matchesItem(item, doc)));
  if (records.length === 0) return '';

  return `<section class="card p-6">
    <h2 class="text-lg font-semibold">Also in this project</h2>
    <p class="prose-body mb-1 mt-1 text-xs">
      In the project and in the export, but not matched to a checklist item. Usually this means
      the record's details are not filled in yet.
    </p>
    <ul>${records.map((doc) => evidenceRow(doc, closed)).join('')}</ul>
  </section>`;
}

function suggestionBlock(closed: boolean): string {
  if (!template || !programme) return '';
  const candidates = documents.filter((doc) => !doc.programmes.includes(programme!.id));
  const suggestions = suggestForProgramme(template, candidates);
  if (suggestions.length === 0) return '';

  const rows = suggestions
    .slice(0, 8)
    .map(
      (doc) => `<li class="flex items-center gap-3 border-t border-line-subtle py-2.5">
        <span class="min-w-0 flex-1 truncate text-sm ${closed ? 'text-ink-muted' : ''}" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
        ${
          closed
            ? ''
            : `<button type="button" data-assign="${doc.id}"
                 class="shrink-0 text-xs font-medium text-accent hover:underline">Add</button>`
        }
      </li>`,
    )
    .join('');

  return `<section class="card p-6">
    <h2 class="text-lg font-semibold">${suggestions.length} record${suggestions.length === 1 ? '' : 's'} would fit here</h2>
    <p class="prose-body mb-1 mt-1 text-xs">
      ${
        closed
          ? 'This project is closed. Reopen it below to change what it holds.'
          : 'Not in this project yet.'
      }
    </p>
    <ul>${rows}</ul>
    ${
      closed
        ? ''
        : `<button type="button" data-assign-all
             class="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-accent/40">Add all ${suggestions.length}</button>`
    }
  </section>`;
}

function contextBlock(): string {
  if (!template || !programme || template.contextFields.length === 0) return '';
  const lines = template.contextFields
    .map((field) => {
      const value = programme!.context[field.id]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => line !== null);

  return `<section class="card p-6">
    <div class="flex items-baseline justify-between gap-4">
      <h2 class="text-lg font-semibold">Context statement</h2>
      <a href="/programmes" class="text-xs font-medium text-accent hover:underline">Edit</a>
    </div>
    ${
      lines.length > 0
        ? `<div class="mt-3 flex flex-col gap-1.5 rounded-md bg-canvas p-4">
             ${lines.map((line) => `<span class="text-sm">${escapeHtml(line)}</span>`).join('')}
           </div>`
        : `<p class="prose-body mt-2 text-sm">
             Not answered yet. Prints at the front of this project's section on export.
           </p>`
    }
  </section>`;
}

/** Everything in the project, flat and dated — the "what have I actually got" view. */
function evidenceTab(closed: boolean): string {
  const records = [...assigned()].sort((a, b) => b.addedAt - a.addedAt);

  if (records.length === 0) {
    return `<section class="rounded-lg border border-dashed border-line bg-canvas px-8 py-14 text-center">
      <h2 class="text-lg font-semibold">Nothing in this project yet</h2>
      <p class="prose-body mx-auto mt-2 max-w-[48ch] text-sm">
        Capture something and add it here, or open the checklist to see what fits.
      </p>
      <a href="/capture" class="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Capture evidence</a>
    </section>`;
  }

  const incomplete = records.filter((doc) => !isComplete(doc)).length;

  return `<section class="card p-6">
    <div class="flex flex-wrap items-baseline justify-between gap-3 pb-1">
      <h2 class="text-lg font-semibold">${records.length} record${records.length === 1 ? '' : 's'}</h2>
      ${
        incomplete > 0
          ? `<span class="text-xs text-caution">${incomplete} missing detail</span>`
          : '<span class="text-xs text-positive">All details filled in</span>'
      }
    </div>
    <ul>${records.map((doc) => evidenceRow(doc, closed)).join('')}</ul>
  </section>`;
}

/** Dates, closing, and removing — the things that change the project itself. */
function settingsTab(closed: boolean): string {
  if (!programme) return '';

  return `<div class="flex flex-col gap-5">
    <section class="card p-6">
      <h2 class="text-lg font-semibold">Window</h2>
      <p class="prose-body mb-3 mt-1 text-xs">
        Used to work out what is due by now. Leave unset and nothing is flagged as behind.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">Start date</span>
          <input type="date" id="project-starts" value="${programme.startsOn ?? ''}" ${closed ? 'disabled' : ''}
            class="min-h-11 rounded-md border border-line bg-surface px-3 text-sm disabled:opacity-50" />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">End date</span>
          <input type="date" id="project-ends" value="${programme.endsOn ?? ''}" ${closed ? 'disabled' : ''}
            class="min-h-11 rounded-md border border-line bg-surface px-3 text-sm disabled:opacity-50" />
        </label>
      </div>
      ${closed ? '<p class="mt-2 text-xs text-ink-muted">Reopen the project to change its dates.</p>' : ''}
    </section>

    ${closureBlock(closed)}

    <section class="card p-6">
      <h2 class="text-lg font-semibold">${programme.archived ? 'Archived' : 'Archive this project'}</h2>
      <p class="prose-body mt-1 text-sm">
        ${
          programme.archived
            ? 'Out of Home and out of the projects you are working on, and still here in full. Restore it whenever you want it back.'
            : 'Puts it away without deleting anything. It leaves Home and the Current tab, keeps everything it holds, and still exports.'
        }
      </p>
      <button type="button" data-archive
        class="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium transition hover:border-accent/40 hover:text-accent">
        ${programme.archived ? 'Restore project' : 'Archive project'}
      </button>
    </section>

    <section class="card p-6">
      <h2 class="text-lg font-semibold">Remove this project</h2>
      <p class="prose-body mt-1 text-sm">
        The project and its checklist are deleted. Your evidence is not: every record stays
        in your vault, and in any other project it belongs to.
      </p>
      <button type="button" data-remove-project
        class="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:border-critical/40 hover:text-critical">
        Remove project
      </button>
    </section>
  </div>`;
}

function closureBlock(closed: boolean): string {
  if (!programme) return '';
  const count = assigned().length;

  if (closed) {
    const on = programme.closedAt ? shortDate(programme.closedAt) : '';
    return `<section class="card p-6">
      <h2 class="text-lg font-semibold">Closed and fixed</h2>
      <p class="prose-body mt-1 text-sm">
        Closed${on ? ` on <span class="font-mono">${escapeHtml(on)}</span>` : ''}, holding ${count} record${count === 1 ? '' : 's'}.
        Nothing joins or leaves while it is closed.
      </p>
      <button type="button" data-reopen
        class="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium transition hover:border-accent/40">Reopen to change what is in it</button>
      ${
        programme.reopenedAt
          ? `<p class="mt-1.5 text-xs text-ink-muted">Last reopened <span class="font-mono">${escapeHtml(shortDate(programme.reopenedAt))}</span>.</p>`
          : ''
      }
    </section>`;
  }

  return `<section class="card p-6">
    <h2 class="text-lg font-semibold">Finished with it?</h2>
    <p class="prose-body mt-1 text-sm">
      Closing fixes what this project holds, so a later export matches what you submitted.
      You can reopen it.
    </p>
    <button type="button" data-close
      class="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium transition hover:border-accent/40">Close this project</button>
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
 * Unfinished business in THIS project, and only things that can reach zero.
 * No completeness meter: a permanent nag is not a task.
 *
 * Scoped to the project on purpose. Averaged across every project these
 * counts answered a question nobody asks — "how am I going overall" — while
 * the one that matters is "what does this placement still need".
 */
function attentionItems(): Attention[] {
  if (!programme) return [];
  const items: Attention[] = [];
  const records = assigned();
  const closed = programme.closedAt !== null;

  if (template && !closed) {
    const elapsed = elapsedFraction(programme.startsOn, programme.endsOn);
    const overdue = scoreProgramme(template, records, elapsed).filter((p) => p.overdue);
    if (overdue.length > 0) {
      items.push({
        tone: 'critical',
        title: `${overdue.length} checklist item${overdue.length === 1 ? '' : 's'} behind schedule`,
        detail: `${overdue.map((p) => escapeHtml(p.item.label.toLowerCase())).slice(0, 2).join(', ')}.`,
        href: `/project?id=${encodeURIComponent(programme.id)}&tab=checklist`,
        action: 'Open',
      });
    }
  }

  const incomplete = records.filter((doc) => !isComplete(doc));
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

/** The last few things added to this project. */
function recentBlock(): string {
  const recent = [...assigned()].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5);
  if (recent.length === 0) return '';

  const rows = recent
    .map((doc, index) => {
      return `<div class="flex flex-wrap items-center gap-3 border-t border-line py-3 ${index === recent.length - 1 ? 'pb-0' : ''}">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</p>
          <p class="mt-0.5 text-xs text-ink-faint">
            <span class="font-mono">${escapeHtml(shortDate(doc.addedAt))}</span>
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap gap-1.5">
          ${
            doc.programmes.length > 1
              ? `<span class="rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">also in ${doc.programmes.length - 1} other</span>`
              : ''
          }
        </div>
      </div>`;
    })
    .join('');

  return `<section class="card p-6">
    <div class="flex items-baseline justify-between gap-4 pb-1.5">
      <h2 class="text-xl font-semibold">Recently captured</h2>
      <a href="/portfolio" class="text-xs font-medium text-accent hover:underline">All artefacts</a>
    </div>
    ${rows}
  </section>`;
}

/**
 * What this project produces on export. A different template asks for
 * different things, which is the point — this is where a project's own
 * character shows.
 */
function outputsBlock(acknowledged: boolean): string {
  // Bound locally: `programme` is a module-level `let`, so a narrowing check
  // does not survive into the callback below.
  const current = programme;
  if (!current || !template) return '';

  const rows: string[] = [];

  if (template.contextFields.length > 0) {
    const answered = template.contextFields.filter((f) => current.context[f.id]?.trim()).length;
    const total = template.contextFields.length;
    rows.push(
      row(
        answered === total,
        'Context statement',
        `${answered} of ${total} answered`,
        `/project?id=${encodeURIComponent(current.id)}&tab=context`,
        answered === total ? 'View' : 'Finish',
      ),
    );
  }

  const records = assigned();
  const incomplete = records.filter((doc) => !isComplete(doc)).length;
  rows.push(
    row(
      incomplete === 0 && records.length > 0,
      'Data collection profile',
      records.length === 0
        ? 'Nothing assigned to this project yet'
        : incomplete === 0
          ? `${records.length} row${records.length === 1 ? '' : 's'}, all complete`
          : `${incomplete} row${incomplete === 1 ? '' : 's'} incomplete`,
      '/data-profile',
      incomplete === 0 ? 'View' : 'Fix',
    ),
  );

  rows.push(
    row(acknowledged, 'De-identification', acknowledged ? 'Acknowledged' : 'Not acknowledged yet', '/portfolio', acknowledged ? '' : 'Read'),
  );

  return `<section class="card p-6">
    <h2 class="text-lg font-semibold">What this project produces</h2>
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

/**
 * Hub: what this project still needs, what went into it lately, and what it
 * produces when exported.
 *
 * These three panels used to sit on Home, averaged across every project. That
 * answered a question nobody asks. Here they answer the one that matters.
 */
function hubTab(): string {
  const attention = attentionBlock(attentionItems());
  const recent = recentBlock();
  const outputs = outputsBlock(deidAcknowledged);

  if (!attention && !recent && !outputs) {
    return `<p class="prose-body text-sm">Nothing to report yet. Capture something and assign it here.</p>`;
  }

  return `<div class="grid gap-7 lg:grid-cols-[1.6fr_1fr]">
    <div class="flex flex-col gap-5">${attention}${recent}</div>
    <div class="flex flex-col gap-5">${outputs}</div>
  </div>`;
}

/**
 * `final-placement-eastvale-2026.pdf`, from the project's own name and the
 * year its window closes.
 *
 * The export page names every file after your profile, so every export you
 * have ever taken is called the same thing. A submission wants to say which
 * project it is, without being renamed in a downloads folder first.
 */
function exportFilename(): string {
  if (!programme) return 'portfolio.pdf';
  const year = programme.endsOn?.slice(0, 4) ?? new Date().getFullYear();
  const stem = `${programme.name} ${year}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${stem || 'project'}.pdf`;
}

/** The context statement as "Label: value" lines, or nothing when unanswered. */
function contextLines(): string[] {
  if (!programme || !template) return [];
  const current = programme;
  return template.contextFields
    .map((field) => {
      const value = current.context[field.id]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => line !== null);
}

async function exportProject() {
  if (!programme) return;
  const records = assigned();
  if (records.length === 0) {
    setStatus('Nothing to export: this project has no evidence yet.');
    return;
  }

  const button = document.querySelector<HTMLButtonElement>('[data-export-project]');
  if (button) button.disabled = true;

  try {
    const bytes = await buildPortfolioPdf(
      profile,
      folders,
      records,
      (doc) => documentBytes(doc.id),
      (done, total, label) => setStatus(`Adding ${done + 1} of ${total}: ${label}`, true),
      {
        sections: [
          {
            name: programme.name,
            window: windowLabel(),
            contextLines: contextLines(),
            report: reportSections(programme),
            documents: records,
          },
        ],
        unassigned: [],
        includeProfileTable: true,
      },
    );

    // Copy into a fresh ArrayBuffer so the Blob owns its own memory.
    const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${exportFilename()}.`);
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    setStatus(`Export failed: ${describeError(error)}`);
  } finally {
    if (button) button.disabled = false;
  }
}

/** Rendered date window, or null when the project has no dates. */
function windowLabel(): string | null {
  if (!programme?.startsOn || !programme.endsOn) return null;
  return `${isoShortDate(programme.startsOn)} – ${isoShortDate(programme.endsOn)}`;
}


/* ----------------------------------------------------------------- report */

/**
 * The written half of a portfolio, section by section, before you export.
 *
 * Three things per section of the template's checklist: the evidence you
 * assigned that answers it, what is missing from that evidence, and the
 * questions to answer about it.
 *
 * The questions come from the template (see ProgrammeTemplate.reportPrompts)
 * and they are only ever questions. Nothing here drafts, suggests or starts a
 * sentence for you — docs/PRODUCT.md rules that out, and the whole value of a
 * portfolio's prose is that an assessor is reading your thinking, not a form
 * letter you adapted.
 */
function reportTab(closed: boolean): string {
  if (!programme || !template) {
    return '<p class="prose-body text-sm">This project uses a template that declares no report.</p>';
  }

  const records = assigned();
  const sections = [...new Set(template.items.map((item) => item.section))];
  const prompts = template.reportPrompts ?? {};
  const answers = programme.report ?? {};

  const blocks = sections
    .map((section) => {
      const items = template!.items.filter((item) => item.section === section);
      const matched = records.filter((doc) => items.some((item) => matchesItem(item, doc)));

      // What an assessor will notice is missing, per artefact.
      const unannotated = matched.filter((doc) => !doc.caption.trim()).length;
      const unsourced = matched.filter((doc) => !doc.source?.trim()).length;
      const gaps = [
        unannotated > 0 ? `${unannotated} with no annotation` : null,
        unsourced > 0 ? `${unsourced} with no source` : null,
      ].filter(Boolean) as string[];

      const questions = prompts[section] ?? [];
      const written = answers[section] ?? '';
      const words = written.trim() ? written.trim().split(/\s+/).length : 0;

      return `<section class="card p-6">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 class="text-lg font-semibold">${escapeHtml(section)}</h2>
          <p class="font-mono text-xs text-ink-faint">
            ${matched.length} artefact${matched.length === 1 ? '' : 's'}${
              words > 0 ? ` · ${words} word${words === 1 ? '' : 's'} written` : ''
            }
          </p>
        </div>

        ${
          matched.length === 0
            ? `<p class="prose-body mt-2 text-sm">
                 Nothing assigned here yet. The checklist tab says what would fit.
               </p>`
            : `<ul class="mt-3 flex flex-col">
                 ${matched.map((doc) => evidenceRow(doc, closed)).join('')}
               </ul>`
        }

        ${
          gaps.length > 0
            ? `<p class="mt-3 rounded-md bg-caution-surface px-3 py-2 text-xs text-caution">
                 ${escapeHtml(gaps.join(' · '))}. An artefact with nothing written about it is a
                 file, not evidence.
               </p>`
            : ''
        }

        ${
          questions.length > 0
            ? `<div class="mt-5 border-t border-line-subtle pt-4">
                 <p class="pf-eyebrow text-ink-faint">Answer in your own words</p>
                 <ul class="prose-body mt-2 list-disc space-y-1 pl-5 text-sm">
                   ${questions.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}
                 </ul>
               </div>`
            : ''
        }

        <textarea
          data-report="${escapeHtml(section)}"
          rows="8"
          ${closed ? 'readonly' : ''}
          placeholder="${closed ? 'This project is closed.' : 'Your response to the questions above.'}"
          class="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed ${
            closed ? 'cursor-not-allowed opacity-70' : ''
          }"
        >${escapeHtml(written)}</textarea>
      </section>`;
    })
    .join('');

  return `<div class="flex flex-col gap-5">
    <section class="card p-6">
      <h2 class="text-lg font-semibold">Before you export</h2>
      <p class="prose-body mt-1 text-sm">
        Each section below holds the evidence you assigned to it and the questions to answer about
        it. What you write here prints ahead of that section's evidence in the export.
      </p>
      <p class="prose-body mt-2 text-sm">
        The questions are prompts, not a template to fill in. Nothing in ProFolio writes any of this
        for you — an assessor is reading your thinking, and it has to be yours.
      </p>
    </section>
    ${blocks}
  </div>`;
}

function render() {
  const host = $('project');
  if (!host || !programme) return;

  const closed = programme.closedAt !== null;
  const records = assigned();
  const week = currentWeek(programme.startsOn, programme.endsOn);
  const weeks = totalWeeks(programme.startsOn, programme.endsOn);
  const window =
    programme.startsOn && programme.endsOn
      ? `${isoShortDate(programme.startsOn)} – ${isoShortDate(programme.endsOn)}`
      : 'No dates set';

  let headline = `${records.length} record${records.length === 1 ? '' : 's'}`;
  if (template) {
    const progress = scoreProgramme(
      template,
      records,
      closed ? null : elapsedFraction(programme.startsOn, programme.endsOn),
    );
    const done = progress.filter((p) => p.satisfied).length;
    headline = `${done} of ${progress.length} collected`;
  }

  host.innerHTML = `
    <div class="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start">
      <div class="min-w-0 flex-1">
        <p class="pf-eyebrow text-ink-faint">${escapeHtml(template?.name ?? 'Project')}</p>
        <div class="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 class="font-display text-3xl font-normal tracking-[-0.02em] sm:text-4xl">${escapeHtml(programme.name)}</h1>
          <span class="rounded-sm px-2 py-0.5 text-xs font-medium ${
            closed ? 'bg-canvas text-ink-muted' : 'bg-selected text-positive'
          }">${closed ? 'Closed' : 'Collecting'}</span>
        </div>
        <p class="mt-2 font-mono text-xs text-ink-muted">
          ${escapeHtml(window)}${week && weeks && !closed ? ` · week ${week} of ${weeks}` : ''} · ${escapeHtml(headline)}
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        <a href="/capture" class="flex-1 rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-white transition hover:opacity-90 sm:flex-none">
          Capture evidence
        </a>
        <button type="button" data-export-project
          class="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-center text-sm font-medium transition hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">
          Export this project
        </button>
      </div>
    </div>

    <!-- Everything this project can do, flat and in one row. The drawer is for
         moving around the ProFolio; this is for working inside one project. -->
    <nav class="-mx-5 mb-6 overflow-x-auto border-b border-line px-5" aria-label="Project">
      <div class="flex min-w-max gap-1">
        ${TABS.map(
          (t) => `<button type="button" data-tab="${t.id}"
            aria-current="${t.id === tab ? 'page' : 'false'}"
            class="min-h-11 border-b-2 px-4 text-sm transition ${
              t.id === tab
                ? 'border-accent font-semibold text-accent'
                : 'border-transparent text-ink-muted hover:text-ink'
            }">${t.label}${
              t.id === 'evidence' ? ` <span class="font-mono text-xs">${records.length}</span>` : ''
            }</button>`,
        ).join('')}
      </div>
    </nav>

    <p id="project-status" role="status" aria-live="polite" class="mb-4 text-xs text-ink-muted"></p>

    <div class="flex flex-col gap-5">
      ${
        tab === 'hub'
          ? hubTab()
          : tab === 'report'
            ? reportTab(closed)
          : tab === 'checklist'
            ? `${checklistBlock(closed)}${extraBlock(closed)}${suggestionBlock(closed)}`
            : tab === 'evidence'
              ? evidenceTab(closed)
              : tab === 'context'
                ? contextBlock()
                : settingsTab(closed)
      }
    </div>`;
}

/* ---------------------------------------------------------------- wiring */

async function refresh() {
  const [snapshot, programmeData] = await Promise.all([loadVault(), loadProgrammes()]);
  documents = snapshot.documents;
  profile = snapshot.profile;
  folders = snapshot.folders;
  deidAcknowledged = snapshot.deidAcknowledged;
  programme = programmeData.programmes.find((p) => p.id === projectId());
  template = programme ? templateFor(programme.template) : undefined;
}

export async function initProject() {
  const host = $('project');
  if (!host) return;

  wireViewer(host, (id) => documents.find((doc) => doc.id === id));

  host.addEventListener('change', async (event) => {
    const field = event.target as HTMLTextAreaElement;
    const section = field.dataset?.report;
    if (!section || !programme) return;
    const next = { ...(programme.report ?? {}), [section]: field.value };
    await guard('Saving your report', async () => {
      await updateProgramme(programme!.id, { report: next });
      await refresh();
      setStatus('Saved.');
    });
  });

  // setTab has always written ?tab= to the URL, and nothing ever read it back,
  // so a deep link or a refresh silently landed on the default tab. Every link
  // that names a tab — the Hub panels, a freshly started project going to its
  // settings — depended on this.
  tab = readTab();

  try {
    await refresh();
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    host.innerHTML = `<p class="card p-6 text-sm text-critical">
      Could not load this project: ${escapeHtml(describeError(error))}
    </p>`;
    return;
  }

  if (!programme) {
    host.innerHTML = `<div class="card p-8 text-center">
      <h1 class="text-xl font-semibold">That project is not here</h1>
      <p class="prose-body mx-auto mt-2 max-w-[48ch] text-sm">
        It may have been removed, or the link may be out of date.
      </p>
      <a href="/" class="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Home</a>
    </div>`;
    return;
  }

  render();

  // Dates are written on change rather than behind a Save button: there are two
  // of them, and a form that needs saving is one more thing to forget.
  host.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    if (!programme) return;
    if (target.id !== 'project-starts' && target.id !== 'project-ends') return;

    const patch =
      target.id === 'project-starts'
        ? { startsOn: target.value || null }
        : { endsOn: target.value || null };

    await guard('Saving dates', async () => {
      await updateProgramme(programme!.id, patch);
      await refresh();
      render();
      setStatus('Dates updated.');
    });
  });

  host.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!button || !programme) return;
    const id = programme.id;

    const nextTab = button.dataset.tab;
    if (nextTab) {
      setTab(nextTab as TabId);
      render();
      return;
    }

    if (button.dataset.removeProject !== undefined) {
      if (
        !window.confirm(
          `Remove "${programme.name}"? The project goes; your evidence stays in your vault.`,
        )
      ) {
        return;
      }
      return guard('Removing project', async () => {
        await deleteProgramme(id);
        window.location.href = '/';
      });
    }

    const add = button.dataset.assign;
    if (add) {
      const doc = documents.find((d) => d.id === add);
      if (!doc) return;
      return guard('Adding to project', async () => {
        await updateDocument(doc.id, { programmes: [...doc.programmes, id] });
        await refresh();
        render();
        setStatus('Added.');
      });
    }

    if (button.dataset.assignAll !== undefined && template) {
      const pending = suggestForProgramme(
        template,
        documents.filter((doc) => !doc.programmes.includes(id)),
      );
      if (pending.length === 0) return;
      return guard('Adding to project', async () => {
        for (const doc of pending) {
          await updateDocument(doc.id, { programmes: [...doc.programmes, id] });
        }
        await refresh();
        render();
        setStatus(`Added ${pending.length} record${pending.length === 1 ? '' : 's'}.`);
      });
    }

    const remove = button.dataset.unassign;
    if (remove) {
      const doc = documents.find((d) => d.id === remove);
      if (!doc) return;
      return guard('Removing from project', async () => {
        await updateDocument(doc.id, { programmes: doc.programmes.filter((p) => p !== id) });
        await refresh();
        render();
        setStatus('Removed from this project. The record is untouched.');
      });
    }

    if (button.dataset.exportProject !== undefined) {
      await exportProject();
      return;
    }

    if (button.dataset.archive !== undefined) {
      const next = !programme.archived;
      await guard(next ? 'Archiving project' : 'Restoring project', async () => {
        await updateProgramme(id, { archived: next });
        await refresh();
        render();
        setStatus(next ? 'Archived. Find it under Projects → Archived.' : 'Restored.');
      });
      return;
    }

    if (button.dataset.close !== undefined) {
      if (!window.confirm(`Close "${programme.name}"? Nothing can be added until you reopen it.`)) return;
      return guard('Closing project', async () => {
        await updateProgramme(id, { closed: true });
        await refresh();
        render();
        setStatus('Closed. What it holds is now fixed.');
      });
    }

    if (button.dataset.reopen !== undefined) {
      if (
        !window.confirm(
          `Reopen "${programme.name}"? Anything you export afterwards may differ from the version you submitted.`,
        )
      ) {
        return;
      }
      return guard('Reopening project', async () => {
        await updateProgramme(id, { closed: false });
        await refresh();
        render();
        setStatus('Reopened. This is recorded on the project.');
      });
    }
  });
}
