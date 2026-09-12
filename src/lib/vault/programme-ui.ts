/**
 * Projects — the index, grouped by what state a project is in.
 *
 * This page used to render every project in full: dates, context statement,
 * checklist, suggestions, closing, removing. All of that is on the project's
 * own page now, behind its tabs, so a second editable copy here meant two
 * places to change the same thing and two places for them to disagree. What
 * is left is a way to find a project and a way to start one.
 *
 * Three states, because a project has three honest shapes:
 *
 *   Current   — open and collecting.
 *   Completed — closed, so what it holds is fixed. Still yours to read and
 *               export; closing is not deleting.
 *   Archived  — put away. Off Home and out of the way, still there.
 *
 * The state is in the URL, so a tab can be linked to and survives a reload.
 */
import {
  createProgramme,
  describeError,
  isAuthError,
  loadProgrammes,
  loadVault,
  reloadForAuth,
  type Programme,
} from './db';
import { templateFor, TEMPLATES } from '../programmes';
import { projectCard } from './project-card';
import type { VaultDocument } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

let programmes: Programme[] = [];
let documents: VaultDocument[] = [];

const STATES = [
  { id: 'current', label: 'Current' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
] as const;

type StateId = (typeof STATES)[number]['id'];

/**
 * Archived wins over closed: a project closed and then put away belongs in one
 * list, not two, and archiving is the later decision.
 */
function stateOf(programme: Programme): StateId {
  if (programme.archived) return 'archived';
  return programme.closedAt === null ? 'current' : 'completed';
}

let state: StateId = 'current';

function readState(): StateId {
  const raw = new URLSearchParams(window.location.search).get('status');
  return STATES.some((s) => s.id === raw) ? (raw as StateId) : 'current';
}

function setState(next: StateId) {
  state = next;
  const params = new URLSearchParams(window.location.search);
  params.set('status', next);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
}

function setStatus(message: string) {
  const host = $('programme-status');
  if (host) host.textContent = message;
}

async function guard(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    setStatus(`${label} failed: ${describeError(error)}`);
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Start plus a template's typical length, as the first guess at an end date. */
function windowEnd(iso: string, weeks: number): string {
  const start = new Date(`${iso}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + weeks * 7);
  return start.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------- sections */

const EMPTY: Record<StateId, string> = {
  current: 'No projects on the go. Start one from a template below.',
  completed: 'Nothing completed yet. Closing a project, from its Settings tab, puts it here.',
  archived: 'Nothing archived. Archiving a project, from its Settings tab, puts it here.',
};

function renderProgrammes() {
  const host = $('programme-list');
  if (!host) return;

  const tabs = STATES.map((s) => {
    const count = programmes.filter((p) => stateOf(p) === s.id).length;
    return `<button type="button" data-state="${s.id}"
      aria-current="${s.id === state ? 'page' : 'false'}"
      class="min-h-11 border-b-2 px-4 text-sm transition ${
        s.id === state
          ? 'border-accent font-semibold text-accent'
          : 'border-transparent text-ink-muted hover:text-ink'
      }">${s.label} <span class="font-mono text-xs">${count}</span></button>`;
  }).join('');

  const shown = programmes.filter((p) => stateOf(p) === state);
  const body =
    shown.length === 0
      ? `<p class="prose-body text-sm">${escapeHtml(EMPTY[state])}</p>`
      : `<div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
           ${shown.map((programme) => projectCard(programme, documents)).join('')}
         </div>`;

  host.innerHTML = `
    <nav class="-mx-5 mb-6 overflow-x-auto border-b border-line px-5" aria-label="Project status">
      <div class="flex min-w-max gap-1">${tabs}</div>
    </nav>
    ${body}`;
}

function renderTemplates() {
  const host = $('template-list');
  if (!host) return;

  host.innerHTML = TEMPLATES.map(
    (template) => `<article class="card flex flex-col gap-2">
      <h3 class="text-base font-semibold">${escapeHtml(template.name)}</h3>
      <p class="prose-body text-sm">${escapeHtml(template.tagline)}</p>
      <p class="text-xs text-ink-muted">${escapeHtml(template.audience)}</p>
      <p class="text-xs text-ink-muted">
        ${template.items.length} checklist items · about ${template.defaultWeeks} week${template.defaultWeeks === 1 ? '' : 's'}
      </p>
      <button
        type="button"
        data-start="${template.key}"
        class="mt-auto rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
      >Start this</button>
    </article>`,
  ).join('');
}

/* --------------------------------------------------------------- wiring */

async function refresh() {
  const [programmeData, vault] = await Promise.all([loadProgrammes(), loadVault()]);
  programmes = programmeData.programmes;
  documents = vault.documents;
  renderProgrammes();
}

export async function initProgrammes() {
  state = readState();
  renderTemplates();

  $('programme-list')?.addEventListener('click', (event) => {
    const next = (event.target as HTMLElement).closest<HTMLElement>('[data-state]')?.dataset.state;
    if (!next) return;
    setState(next as StateId);
    renderProgrammes();
  });

  $('template-list')?.addEventListener('click', async (event) => {
    const key = (event.target as HTMLElement).closest('button')?.dataset.start;
    if (!key) return;
    const template = templateFor(key);
    if (!template) return;

    const name = window.prompt(`Name this ${template.name.toLowerCase()}`, template.name);
    if (!name?.trim()) return;

    const startsOn = todayIso();
    await guard('Starting project', async () => {
      const created = await createProgramme({
        template: key,
        name: name.trim(),
        startsOn,
        // Pre-filled from the template's typical length; editable straight after.
        endsOn: windowEnd(startsOn, template.defaultWeeks),
      });
      // Straight into it: the dates and the context statement both want
      // checking, and both live on the project's own page now.
      window.location.href = `/project?id=${encodeURIComponent(created.id)}&tab=settings`;
    });
  });

  await guard('Loading projects', refresh);
}
