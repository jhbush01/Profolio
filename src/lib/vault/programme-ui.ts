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
import type { ContextField, ProgrammeTemplate } from '../programmes/types';

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

/** One input, shaped by the field's declared kind. */
function contextInput(programmeId: string, field: ContextField, value: string): string {
  const common = `data-context="${programmeId}" data-field="${field.id}"
    class="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"`;

  if (field.kind === 'select') {
    const options = (field.options ?? [])
      .map((option) => `<option${value === option ? ' selected' : ''}>${escapeHtml(option)}</option>`)
      .join('');
    return `<select ${common}><option value=""${value ? '' : ' selected'}>Not set</option>${options}</select>`;
  }
  if (field.kind === 'longtext') {
    return `<textarea rows="2" ${common}>${escapeHtml(value)}</textarea>`;
  }
  return `<input type="${field.kind === 'number' ? 'number' : 'text'}" value="${escapeHtml(value)}" ${common} />`;
}

/**
 * The context section: a form on the left of the disclosure, and the statement
 * it produces underneath, ready to copy into whatever needs it.
 *
 * Duration is derived from the programme's own window rather than asked again.
 */
function contextSection(
  programme: Programme,
  template: ProgrammeTemplate,
  weeks: number | null,
): string {
  if (template.contextFields.length === 0) return '';

  const answered = template.contextFields.filter((field) => programme.context[field.id]?.trim()).length;
  const total = template.contextFields.length;

  const inputs = template.contextFields
    .map(
      (field) => `<label class="flex flex-col gap-1 ${field.kind === 'longtext' ? 'sm:col-span-2' : ''}">
        <span class="text-xs font-medium">${escapeHtml(field.label)}</span>
        ${contextInput(programme.id, field, programme.context[field.id] ?? '')}
        ${field.hint ? `<span class="text-[0.7rem] text-ink-muted">${escapeHtml(field.hint)}</span>` : ''}
      </label>`,
    )
    .join('');

  const lines = template.contextFields
    .map((field) => {
      const value = programme.context[field.id]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => line !== null);
  // Neutral wording: this line is generated for every template, and a
  // professional-development year is not a placement.
  if (weeks) lines.push(`Duration: ${weeks} weeks`);

  const statement =
    lines.length === 0
      ? '<p class="text-xs text-ink-muted">Fill in the fields above and your statement appears here.</p>'
      : `<pre data-statement="${programme.id}" class="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">${escapeHtml(lines.join('\n'))}</pre>
         <button type="button" data-copy="${programme.id}"
           class="mt-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-accent/40">Copy statement</button>`;

  return `<details class="border-t border-line" ${answered === 0 ? '' : 'open'}>
    <summary class="cursor-pointer px-4 py-2 text-xs">
      Context statement
      <span class="${answered === total ? 'text-positive' : 'text-ink-muted'}">— ${answered} of ${total} filled in</span>
    </summary>
    <div class="grid gap-3 px-4 pb-4 sm:grid-cols-2">${inputs}</div>
    <div class="mx-4 mb-4 rounded-lg border border-line bg-canvas/60 p-3">
      <p class="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-ink-muted">Generated statement</p>
      ${statement}
    </div>
  </details>`;
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
                ? 'text-positive'
                : p.overdue
                  ? 'text-critical'
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

      return `<article class="overflow-hidden rounded-lg border border-line bg-surface" data-programme="${programme.id}">
        <div class="flex flex-wrap items-start justify-between gap-3 p-4">
          <div class="min-w-0">
            <p class="pf-eyebrow text-accent">${escapeHtml(template.name)}</p>
            <h3 class="mt-0.5 text-lg font-semibold">${escapeHtml(programme.name)}</h3>
            <p class="mt-1 text-xs text-ink-muted">${escapeHtml(windowLabel)}</p>
          </div>
          <div class="text-right">
            <p class="font-display text-2xl font-normal">${percent}%</p>
            <p class="text-xs text-ink-muted">${done} of ${progress.length} collected</p>
            ${overdue > 0 ? `<p class="text-xs font-medium text-critical">${overdue} behind schedule</p>` : ''}
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

        ${contextSection(programme, template, weeks)}

        ${checklist}

        <div class="flex items-center justify-between border-t border-line px-4 py-2">
          <a href="/portfolio" class="text-xs text-accent hover:underline">Add evidence →</a>
          <button type="button" data-remove="${programme.id}"
            class="text-xs text-ink-muted underline underline-offset-2 hover:text-critical">Remove programme</button>
        </div>
      </article>`;
    })
    .join('');
}

/**
 * Rewrites just the generated statement for one programme, leaving the form
 * and its focus untouched.
 */
function refreshStatement(programme: Programme, card: HTMLElement) {
  const template = templateFor(programme.template);
  if (!template) return;

  const weeks = totalWeeks(programme.startsOn, programme.endsOn);
  const lines = template.contextFields
    .map((field) => {
      const value = programme.context[field.id]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => line !== null);
  // Neutral wording: this line is generated for every template, and a
  // professional-development year is not a placement.
  if (weeks) lines.push(`Duration: ${weeks} weeks`);

  const pre = card.querySelector<HTMLElement>(`[data-statement="${programme.id}"]`);
  if (pre) {
    pre.textContent = lines.join('\n');
  } else {
    // First answer on an empty statement: swap the placeholder for the real block.
    const host = card.querySelector<HTMLElement>('details > div:last-of-type');
    if (host && lines.length > 0) {
      const block = document.createElement('pre');
      block.dataset.statement = programme.id;
      block.className = 'whitespace-pre-wrap break-words font-sans text-xs leading-relaxed';
      block.textContent = lines.join('\n');
      host.querySelector('p.text-ink-muted')?.remove();
      host.appendChild(block);
    }
  }

  const summary = card.querySelector<HTMLElement>('details > summary span');
  const answered = template.contextFields.filter((f) => programme.context[f.id]?.trim()).length;
  if (summary) {
    summary.textContent = `— ${answered} of ${template.contextFields.length} filled in`;
    summary.className = answered === template.contextFields.length ? 'text-positive' : 'text-ink-muted';
  }
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
    if (target.dataset.context) {
      const id = target.dataset.context;
      const card = document.querySelector<HTMLElement>(`[data-programme="${id}"]`);
      if (!card) return;

      // Send the complete answer set, so clearing a field really clears it.
      const answers: Record<string, string> = {};
      // No generic parameter here: the Workers runtime types declare their own
      // global `Element` (HTMLRewriter's), and a union of DOM input types fails
      // its constraint. Cast inside the callback instead.
      card.querySelectorAll('[data-context][data-field]').forEach((node) => {
        const input = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const field = input.dataset.field;
        if (field && input.value.trim()) answers[field] = input.value.trim();
      });

      return guard('Saving context', async () => {
        await updateProgramme(id, { context: answers });
        const programme = programmes.find((p) => p.id === id);
        if (programme) {
          programme.context = answers;
          // Updated in place: a full re-render would close the form mid-edit.
          refreshStatement(programme, card);
        }
        setStatus('Context saved.');
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
    const copyId = (event.target as HTMLElement).closest('button')?.dataset.copy;
    if (copyId) {
      const text = document.querySelector<HTMLElement>(`[data-statement="${copyId}"]`)?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(text);
        setStatus('Statement copied.');
      } catch {
        // Clipboard access can be refused; selecting the text still works.
        setStatus('Could not copy automatically — select the text and copy it.');
      }
      return;
    }

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
