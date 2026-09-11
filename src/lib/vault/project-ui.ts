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
  ApiError,
  deleteProgramme,
  loadProgrammes,
  loadVault,
  updateDocument,
  updateProgramme,
  type Programme,
} from './db';
import { isComplete } from './dimensions';
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
import type { VaultDocument } from './types';

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

const TABS = [
  { id: 'checklist', label: 'Checklist' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'context', label: 'Context' },
  { id: 'settings', label: 'Settings' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Which tab is open, kept in the URL so a project view can be linked to and
 * survives a refresh — and so the browser's own back button works inside a
 * project, rather than throwing you out to the grid.
 */
let tab: TabId = 'checklist';

const projectId = () => new URLSearchParams(window.location.search).get('id') ?? '';

function readTab(): TabId {
  const raw = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((t) => t.id === raw) ? (raw as TabId) : 'checklist';
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
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      window.location.reload();
      return;
    }
    setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* -------------------------------------------------------------- rendering */

function evidenceRow(doc: VaultDocument, closed: boolean, alsoCounts = 0): string {
  return `<li class="flex items-center gap-3 border-t border-line-subtle py-2.5">
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
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
      In the project and in the export, but answering nothing on the checklist. Often that is just a
      record whose details are not filled in yet.
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
          ? 'This project is closed, so nothing can join it. Reopen it below if what it holds needs to change.'
          : 'Not in the project yet. Nothing counts until you add it.'
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
             Not answered yet. It prints at the front of this project's section when you export.
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
        Capture something and add it here, or open the checklist to see what would fit.
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
        What the checklist measures "by now" against. Leave them unset and nothing is ever
        flagged as behind.
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
      <h2 class="text-lg font-semibold">Remove this project</h2>
      <p class="prose-body mt-1 text-sm">
        The project and its checklist go. Your evidence does not — every record stays in your
        vault, and in any other project it belongs to.
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
        Nothing joins or leaves, so an export made today matches the one you handed in.
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
      Closing fixes what this project holds, so the copy you export later is the copy you submitted.
      You can reopen it.
    </p>
    <button type="button" data-close
      class="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium transition hover:border-accent/40">Close this project</button>
  </section>`;
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
    <nav class="mb-5 flex items-center gap-2 text-xs text-ink-faint" aria-label="Breadcrumb">
      <a href="/" class="text-accent hover:underline">Your ProFolio</a>
      <span aria-hidden="true">/</span>
      <span>${escapeHtml(programme.name)}</span>
    </nav>

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
        <a href="/export" class="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-center text-sm font-medium transition hover:border-accent/40 sm:flex-none">
          Export
        </a>
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
        tab === 'checklist'
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
  programme = programmeData.programmes.find((p) => p.id === projectId());
  template = programme ? templateFor(programme.template) : undefined;
}

export async function initProject() {
  const host = $('project');
  if (!host) return;

  try {
    await refresh();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      window.location.reload();
      return;
    }
    host.innerHTML = `<p class="card p-6 text-sm text-critical">
      Could not load this project: ${escapeHtml(error instanceof Error ? error.message : String(error))}
    </p>`;
    return;
  }

  if (!programme) {
    host.innerHTML = `<div class="card p-8 text-center">
      <h1 class="text-xl font-semibold">That project is not here</h1>
      <p class="prose-body mx-auto mt-2 max-w-[48ch] text-sm">
        It may have been removed, or the link may be out of date.
      </p>
      <a href="/" class="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Your ProFolio</a>
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
        setStatus('Removed from this project. The record itself is untouched.');
      });
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
        setStatus('Reopened. The reopen is recorded on the project.');
      });
    }
  });
}
