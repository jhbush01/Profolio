/**
 * Export — choosing what goes in the document.
 *
 * Programmes are the sections. A programme only offers the outputs it actually
 * produces, so the options here change with what is ticked: a placement has a
 * context statement, a professional-development year does not.
 *
 * The build itself still runs in the browser; bytes are streamed from R2 one
 * document at a time and never round-trip back up.
 */
import {
  describeError,
  emptyProfile,
  documentBytes,
  isAuthError,
  loadProgrammes,
  loadVault,
  reloadForAuth,
  type Programme,
} from './db';
import { contextLines, reportEntries } from './report';
import type { ExportPlan, ProgrammeSection } from './pdf';
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

function windowLabel(programme: Programme): string | null {
  if (!programme.startsOn || !programme.endsOn) return null;
  return `${isoShortDate(programme.startsOn)} – ${isoShortDate(programme.endsOn)}`;
}

let profile: VaultProfile = emptyProfile;
let folders: VaultFolder[] = [];
let documents: VaultDocument[] = [];
let programmes: Programme[] = [];

/** Ticked programme ids, in the order they will appear in the document. */
let chosen = new Set<string>();
let includeUnassigned = false;
let includeContext = true;
let includeProfileTable = true;

function assignedTo(programmeId: string): VaultDocument[] {
  return documents.filter((doc) => doc.programmes.includes(programmeId));
}

/** Records in none of the ticked programmes. */
function unassignedDocuments(): VaultDocument[] {
  return documents.filter((doc) => !doc.programmes.some((id) => chosen.has(id)));
}

/** True when any ticked programme actually declares a context statement. */
function anyContextAvailable(): boolean {
  return [...chosen].some((id) => {
    const programme = programmes.find((p) => p.id === id);
    return programme ? contextLines(programme).length > 0 : false;
  });
}

function buildPlan(): ExportPlan {
  const sections: ProgrammeSection[] = [];
  for (const programme of programmes) {
    if (!chosen.has(programme.id)) continue;
    sections.push({
      name: programme.name,
      window: windowLabel(programme),
      // The context statement and the data collection table are no longer
      // slabs of their own: they print under the report heading the template
      // gives them, so both toggles are resolved in here.
      report: reportEntries(programme, { includeContext, includeProfileTable }),
      documents: assignedTo(programme.id),
    });
  }
  return {
    sections,
    unassigned: includeUnassigned ? unassignedDocuments() : [],
    includeProfileTable,
  };
}

/** Every record the plan will actually print, deduplicated across sections. */
function planDocuments(plan: ExportPlan): VaultDocument[] {
  const seen = new Set<string>();
  const out: VaultDocument[] = [];
  for (const section of [...plan.sections.map((s) => s.documents), plan.unassigned]) {
    for (const doc of section) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      out.push(doc);
    }
  }
  return out;
}

/* -------------------------------------------------------------- rendering */

function checkbox(on: boolean): string {
  return on
    ? `<span class="flex size-[18px] shrink-0 items-center justify-center rounded-sm bg-accent text-white" aria-hidden="true">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-9"/></svg>
       </span>`
    : '<span class="size-[18px] shrink-0 rounded-sm border border-line bg-surface" aria-hidden="true"></span>';
}

function render() {
  const host = $('export');
  if (!host) return;

  const plan = buildPlan();
  const printed = planDocuments(plan);
  const draws =
    plan.sections.reduce((sum, section) => sum + section.documents.length, 0) + plan.unassigned.length;

  const programmeRows = programmes
    .map((programme) => {
      const count = assignedTo(programme.id).length;
      const on = chosen.has(programme.id);
      const closed = programme.closedAt !== null;
      const window = windowLabel(programme) ?? 'No dates set';
      return `<button type="button" data-toggle-programme="${programme.id}" aria-pressed="${on}"
        class="flex w-full items-center gap-3.5 border-t border-line py-4 text-left">
        ${checkbox(on)}
        <span class="min-w-0 flex-1">
          <span class="block text-base font-semibold">${escapeHtml(programme.name)}</span>
          <span class="mt-0.5 block font-mono text-xs text-ink-muted">${escapeHtml(window)} · ${count} record${count === 1 ? '' : 's'}</span>
        </span>
        <span class="shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium ${
          closed ? 'bg-canvas text-ink-muted' : 'bg-selected text-positive'
        }">${closed ? 'Closed' : 'Collecting'}</span>
      </button>`;
    })
    .join('');

  const leftovers = unassignedDocuments().length;

  const options = `
    ${
      anyContextAvailable()
        ? `<button type="button" data-toggle-option="context" aria-pressed="${includeContext}"
             class="flex w-full items-center gap-3.5 border-t border-line py-3.5 text-left">
             ${checkbox(includeContext)}
             <span class="flex-1 text-sm">Context statement</span>
           </button>`
        : ''
    }
    <button type="button" data-toggle-option="profile" aria-pressed="${includeProfileTable}"
      class="flex w-full items-center gap-3.5 border-t border-line py-3.5 text-left">
      ${checkbox(includeProfileTable)}
      <span class="flex-1 text-sm">Data collection profile</span>
    </button>`;

  const contents = [
    `<span class="block text-xs">Cover — ${escapeHtml(profile.name || 'Portfolio')}</span>`,
    '<span class="block text-xs">Contents</span>',
    ...plan.sections.flatMap((section) => [
      `<span class="block text-xs font-semibold text-ink">${escapeHtml(section.name)}</span>`,
      ...(section.report.length > 0
        ? ['<span class="block pl-3.5 text-xs">Report</span>']
        : []),
      ...(section.report.some((entry) => entry.includesDataProfile) && section.documents.length > 0
        ? ['<span class="block pl-7 text-xs">Data collection</span>']
        : []),
      `<span class="block pl-3.5 text-xs">${section.documents.length} document${section.documents.length === 1 ? '' : 's'}</span>`,
    ]),
    ...(plan.unassigned.length > 0
      ? [
          '<span class="block text-xs font-semibold text-ink">Other evidence</span>',
          `<span class="block pl-3.5 text-xs">${plan.unassigned.length} document${plan.unassigned.length === 1 ? '' : 's'}</span>`,
        ]
      : []),
    ...programmes
      .filter((p) => !chosen.has(p.id))
      .map((p) => `<span class="block text-xs text-ink-faint">${escapeHtml(p.name)} — not included</span>`),
  ].join('');

  host.innerHTML = `<div class="grid items-start gap-7 lg:grid-cols-[1.6fr_1fr]">
    <div class="flex flex-col gap-5">
      <section class="card p-6">
        <h2 class="pb-1.5 text-xl font-semibold">Projects</h2>
        ${
          programmes.length > 0
            ? programmeRows
            : `<p class="prose-body border-t border-line pt-4 text-sm">
                 No projects yet. <a href="/programmes" class="text-accent underline underline-offset-2">Start one</a>, or export everything below.
               </p>`
        }
        <button type="button" data-toggle-option="unassigned" aria-pressed="${includeUnassigned}"
          class="flex w-full items-center gap-3.5 border-t border-line pt-4 text-left">
          ${checkbox(includeUnassigned)}
          <span class="min-w-0 flex-1">
            <span class="block text-base font-semibold">Evidence not in a project</span>
            <span class="mt-0.5 block text-xs text-ink-muted">${leftovers} record${leftovers === 1 ? '' : 's'}, as a closing section.</span>
          </span>
        </button>
      </section>

      <section class="card p-6">
        <h2 class="text-xl font-semibold">Include with each project</h2>
        <p class="prose-body mb-1.5 mt-1 text-xs">
          Each project only offers what it produces, so this list changes with your selection.
        </p>
        ${options}
      </section>
    </div>

    <div class="flex flex-col gap-5">
      <section class="card p-6">
        <h3 class="mb-3 text-base font-semibold">Contents</h3>
        <div class="flex flex-col gap-2 rounded-md bg-canvas p-4 text-ink-muted">${contents}</div>
        <p class="mt-3 font-mono text-xs text-ink-muted">
          ${printed.length} record${printed.length === 1 ? '' : 's'}
        </p>
        ${
          // A record in two chosen programmes prints in both, so the page count
          // runs ahead of the record count. Say so rather than let it surprise.
          draws > printed.length
            ? `<p class="prose-body mt-1 text-xs">${draws - printed.length} of them sit in more than one section, and print in each.</p>`
            : ''
        }
      </section>

      <section class="card flex flex-col gap-3 p-6">
        <button id="export-run" type="button" ${printed.length === 0 ? 'disabled' : ''}
          class="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
          Export PDF
        </button>
        <p id="export-state" role="status" aria-live="polite" class="text-xs text-ink-muted">
          ${printed.length === 0 ? 'Choose at least one project, or include evidence that is not in one.' : 'Built in your browser. Documents are read one at a time and never sent anywhere else.'}
        </p>
      </section>
    </div>
  </div>`;
}

function setState(message: string, busy = false) {
  const host = $('export-state');
  if (!host) return;
  host.textContent = message;
  host.classList.toggle('animate-pulse', busy);
}

async function runExport() {
  const button = $<HTMLButtonElement>('export-run');
  const plan = buildPlan();
  const printed = planDocuments(plan);
  if (printed.length === 0) return;

  if (button) button.disabled = true;
  setState('Loading the PDF engine…', true);
  try {
    // pdf-lib is ~400KB; only pulled in when someone actually exports.
    const { buildPortfolioPdf } = await import('./pdf');
    setState('Building PDF…', true);
    const bytes = await buildPortfolioPdf(
      profile,
      folders,
      printed,
      (doc) => documentBytes(doc.id),
      (done, total, label) => setState(`Adding ${done + 1} of ${total}: ${label}`, true),
      plan,
    );

    const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stem = (profile.name || 'portfolio')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    link.href = url;
    link.download = `${stem || 'portfolio'}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setState('Exported.');
  } catch (error) {
    setState(`Export failed: ${describeError(error)}`);
  } finally {
    if (button) button.disabled = false;
  }
}

export async function initExport() {
  const host = $('export');
  if (!host) return;

  try {
    const [snapshot, programmeData] = await Promise.all([loadVault(), loadProgrammes()]);
    profile = snapshot.profile;
    folders = snapshot.folders;
    documents = snapshot.documents;
    programmes = programmeData.programmes;

    // Everything that holds evidence starts ticked: the common case is "all of
    // it", and unticking is easier than hunting for what was left out.
    chosen = new Set(programmes.filter((p) => assignedTo(p.id).length > 0).map((p) => p.id));
    includeUnassigned = chosen.size === 0;
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    host.innerHTML = `<p class="card p-6 text-sm text-critical">
      Could not load your record: ${escapeHtml(describeError(error))}
    </p>`;
    return;
  }

  render();

  host.addEventListener('click', async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target) return;

    const programmeId = target.dataset.toggleProgramme;
    if (programmeId) {
      if (chosen.has(programmeId)) chosen.delete(programmeId);
      else chosen.add(programmeId);
      render();
      return;
    }

    const option = target.dataset.toggleOption;
    if (option === 'unassigned') includeUnassigned = !includeUnassigned;
    else if (option === 'context') includeContext = !includeContext;
    else if (option === 'profile') includeProfileTable = !includeProfileTable;
    if (option) {
      render();
      return;
    }

    if (target.id === 'export-run') await runExport();
  });
}
