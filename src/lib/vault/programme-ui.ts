/**
 * Client controller for the programmes page.
 *
 * Shows the templates available, lets the user start one with a date window,
 * and scores its checklist against the vault. A programme never owns evidence —
 * the same artefact can satisfy items in several programmes at once.
 */
import {
  ApiError,
  createProgramme,
  deleteProgramme,
  loadProgrammes,
  loadVault,
  updateProgramme,
  type Programme,
} from './db';
import {
  currentWeek,
  elapsedFraction,
  scoreProgramme,
  templateFor,
  TEMPLATES,
  totalWeeks,
} from '../programmes';
import type { VaultDocument } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

let programmes: Programme[] = [];
let documents: VaultDocument[] = [];

function setStatus(message: string) {
  const host = $('programme-status');
  if (host) host.textContent = message;
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

/** Today as YYYY-MM-DD, for pre-filling the start date. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The last day of an N-week window that starts on `iso`.
 *
 * Inclusive: a 6-week placement starting Monday 20 July ends Sunday 30 August,
 * which is 41 days later, not 42. Adding a full 42 would render as 7 weeks.
 */
function windowEnd(iso: string, weeks: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7 - 1);
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------- rendering */

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

function renderProgrammes() {
  const host = $('programme-list');
  const empty = $('programme-empty');
  if (!host) return;

  if (programmes.length === 0) {
    host.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  host.innerHTML = programmes
    .map((programme) => {
      const template = templateFor(programme.template);
      if (!template) {
        return `<article class="card">
          <h3 class="text-base font-semibold">${escapeHtml(programme.name)}</h3>
          <p class="prose-body mt-1 text-sm">
            This programme uses a template that is no longer available
            (<code class="text-xs">${escapeHtml(programme.template)}</code>).
          </p>
        </article>`;
      }

      const elapsed = elapsedFraction(programme.startsOn, programme.endsOn);
      const week = currentWeek(programme.startsOn, programme.endsOn);
      const weeks = totalWeeks(programme.startsOn, programme.endsOn);
      const progress = scoreProgramme(template, documents, elapsed);
      const done = progress.filter((p) => p.satisfied).length;
      const overdue = progress.filter((p) => p.overdue).length;
      const percent = Math.round((done / progress.length) * 100);

      const sections = [...new Set(template.items.map((item) => item.section))];
      const checklist = sections
        .map((section) => {
          const rows = progress
            .filter((p) => p.item.section === section)
            .map((p) => {
              const tone = p.satisfied
                ? 'text-emerald-700'
                : p.overdue
                  ? 'text-red-700'
                  : 'text-ink-muted';
              const mark = p.satisfied ? '✓' : p.overdue ? '!' : '○';
              const count =
                p.item.requires > 1 ? ` <span class="text-xs">(${p.matched}/${p.item.requires})</span>` : '';
              return `<li class="flex items-start gap-2 py-1.5">
                <span aria-hidden="true" class="mt-0.5 w-3 shrink-0 text-center ${tone}">${mark}</span>
                <span class="min-w-0">
                  <span class="block text-sm ${p.satisfied ? '' : 'font-medium'}">${escapeHtml(p.item.label)}${count}</span>
                  <span class="block text-xs text-ink-muted">${escapeHtml(p.item.detail)}</span>
                </span>
              </li>`;
            })
            .join('');
          return `<div class="border-t border-line px-4 py-2">
            <p class="text-[0.7rem] font-semibold uppercase tracking-wider text-ink-muted">${escapeHtml(section)}</p>
            <ul>${rows}</ul>
          </div>`;
        })
        .join('');

      const windowLabel = programme.startsOn && programme.endsOn
        ? `${programme.startsOn} → ${programme.endsOn}${weeks ? ` · ${weeks} weeks` : ''}${week ? ` · currently week ${week}` : ''}`
        : 'No dates set — nothing will be flagged as overdue';

      return `<article class="overflow-hidden rounded-xl border border-line bg-surface" data-programme="${programme.id}">
        <div class="flex flex-wrap items-start justify-between gap-3 p-4">
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wider text-accent">${escapeHtml(template.name)}</p>
            <h3 class="mt-0.5 text-lg font-semibold">${escapeHtml(programme.name)}</h3>
            <p class="mt-1 text-xs text-ink-muted">${escapeHtml(windowLabel)}</p>
          </div>
          <div class="text-right">
            <p class="font-display text-2xl font-semibold">${percent}%</p>
            <p class="text-xs text-ink-muted">${done} of ${progress.length} collected</p>
            ${overdue > 0 ? `<p class="text-xs font-medium text-red-700">${overdue} behind schedule</p>` : ''}
          </div>
        </div>

        <div class="px-4 pb-3">
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
            <div class="h-full rounded-full bg-accent" style="width:${percent}%"></div>
          </div>
        </div>

        <div class="grid gap-2 border-t border-line bg-canvas/40 px-4 py-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-medium">Start date</span>
            <input type="date" data-starts="${programme.id}" value="${programme.startsOn ?? ''}"
              class="rounded-lg border border-line bg-surface px-2 py-1 text-xs" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-medium">End date</span>
            <input type="date" data-ends="${programme.id}" value="${programme.endsOn ?? ''}"
              class="rounded-lg border border-line bg-surface px-2 py-1 text-xs" />
          </label>
        </div>

        ${checklist}

        <div class="flex items-center justify-between border-t border-line px-4 py-2">
          <a href="/portfolio" class="text-xs text-accent hover:underline">Add evidence →</a>
          <button type="button" data-remove="${programme.id}"
            class="text-xs text-ink-muted underline underline-offset-2 hover:text-red-600">Remove programme</button>
        </div>
      </article>`;
    })
    .join('');
}

async function refresh() {
  const [programmeData, vault] = await Promise.all([loadProgrammes(), loadVault()]);
  programmes = programmeData.programmes;
  documents = vault.documents;
  renderProgrammes();
}

/* --------------------------------------------------------------- wiring */

export async function initProgrammes() {
  renderTemplates();

  $('template-list')?.addEventListener('click', async (event) => {
    const key = (event.target as HTMLElement).closest('button')?.dataset.start;
    if (!key) return;
    const template = templateFor(key);
    if (!template) return;

    const name = window.prompt(`Name this ${template.name.toLowerCase()}`, template.name);
    if (!name?.trim()) return;

    const startsOn = todayIso();
    await guard('Starting programme', async () => {
      await createProgramme({
        template: key,
        name: name.trim(),
        startsOn,
        // Pre-filled from the template's typical length; editable straight after.
        endsOn: windowEnd(startsOn, template.defaultWeeks),
      });
      await refresh();
      setStatus('Programme started. Check the dates are right.');
    });
  });

  const list = $('programme-list');
  list?.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.starts) {
      const id = target.dataset.starts;
      return guard('Saving start date', async () => {
        await updateProgramme(id, { startsOn: target.value || null });
        await refresh();
        setStatus('Dates updated.');
      });
    }
    if (target.dataset.ends) {
      const id = target.dataset.ends;
      return guard('Saving end date', async () => {
        await updateProgramme(id, { endsOn: target.value || null });
        await refresh();
        setStatus('Dates updated.');
      });
    }
  });

  list?.addEventListener('click', async (event) => {
    const id = (event.target as HTMLElement).closest('button')?.dataset.remove;
    if (!id) return;
    const programme = programmes.find((p) => p.id === id);
    if (!window.confirm(`Remove "${programme?.name}"? Your evidence is not deleted.`)) return;
    await guard('Removing programme', async () => {
      await deleteProgramme(id);
      await refresh();
      setStatus('Programme removed. Evidence untouched.');
    });
  });

  await guard('Loading programmes', refresh);
}
