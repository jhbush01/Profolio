/**
 * The details on one artefact, and the wiring that saves them.
 *
 * Shared by the Artefacts page and by a project's Evidence tab. It used to live
 * only on Artefacts, which meant that finding a record inside the project you
 * were working on and noticing it was missing its purpose sent you out of the
 * project, into a list of everything you own, to find the same file again. The
 * details belong next to the file wherever the file is shown.
 *
 * Every field writes on change. Nothing here is a form with a Save button,
 * because enriching a placement's evidence is thirty small edits made in gaps
 * between lessons, not one sitting.
 */
import standardsJson from '../../data/standards.json';
import { updateDocument, type Programme } from './db';
import {
  CYCLE_PHASES,
  EVIDENCE_TYPES,
  isComplete,
  missingDimensions,
  PURPOSES,
  SUBJECT_SCOPES,
} from './dimensions';
import { childFolders, escapeHtml } from './file-browser';
import type { VaultDocument, VaultFolder } from './types';

const STANDARDS = standardsJson as Array<{
  code: string;
  focus: string;
  domain: string;
  /** Present only where the verbatim wording is held; see src/types.ts. */
  descriptor?: string;
}>;

type Option = { readonly value: string; readonly label: string };

/** A <select> with a blank "not set" option, since every dimension is optional. */
function selectFor(
  attribute: string,
  id: string,
  options: readonly Option[],
  current: string | null,
  placeholder: string,
): string {
  const items = options
    .map(
      (option) =>
        `<option value="${option.value}"${current === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
    )
    .join('');
  return `<select data-${attribute}="${id}" class="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs">
    <option value=""${current ? '' : ' selected'}>${escapeHtml(placeholder)}</option>${items}
  </select>`;
}

/**
 * Project membership for one record.
 *
 * Closed projects are left out: they cannot take new evidence, and offering a
 * control the server will refuse is worse than not offering it.
 */
function programmeChips(doc: VaultDocument, programmes: Programme[]): string {
  if (programmes.length === 0) {
    return `<p class="text-[0.7rem] text-ink-muted">
      No open projects. <a href="/programmes" class="text-accent underline underline-offset-2">Start one</a> to assign this record.
    </p>`;
  }

  const chips = programmes
    .map((programme) => {
      const on = doc.programmes.includes(programme.id);
      return `<button
        type="button"
        data-programme-toggle="${doc.id}"
        data-programme="${programme.id}"
        aria-pressed="${on}"
        class="rounded-sm border px-2 py-0.5 text-[0.7rem] transition ${
          on ? 'border-mint bg-selected font-medium text-positive' : 'border-line text-ink-muted'
        }"
      >${escapeHtml(programme.name)}</button>`;
    })
    .join('');

  return `<div class="flex flex-wrap gap-1">${chips}</div>`;
}

/**
 * The one line you see when the panel is shut.
 *
 * Quiet on purpose. This was a tinted box with a caution border and a sentence
 * naming every missing field, which is fine on one row and unbearable on
 * twenty — a folder of new uploads became a wall of orange, and the warning
 * stopped meaning anything because everything was warning.
 *
 * So: a small dot and a count. The dot carries the state at a glance, the
 * count says how much work, and the specifics are one click away where they
 * are actionable rather than decorative. The page-level filter is what turns
 * "which ones" into a real answer.
 */
function summaryLine(doc: VaultDocument): string {
  const gaps = missingDimensions(doc);
  if (gaps.length === 0) {
    return `<span class="size-1.5 shrink-0 rounded-full bg-positive" aria-hidden="true"></span>
      <span class="text-ink-faint">Details</span>`;
  }
  return `<span class="size-1.5 shrink-0 rounded-full bg-caution" aria-hidden="true"></span>
    <span class="text-ink-muted">Details</span>
    <span class="text-ink-faint">· ${gaps.length} to fill in</span>`;
}

export interface PanelOptions {
  /** Open projects, for the membership chips. Empty hides the control. */
  programmes: Programme[];
  /** All folders, for the move control. Omit to leave the file where it is. */
  folders?: VaultFolder[];
}

/**
 * The APST picker.
 *
 * It used to be 12 bare numbers. Nobody knows the standards by their codes —
 * "5.4" is a lookup, not a label — so tagging meant opening AITSL in another
 * tab, or guessing, or skipping the field. It is now the full graduate set of
 * 37 focus areas with their titles, grouped by domain, filtered as you type.
 *
 * Selected ones are pulled to the top so a record with four tags does not
 * require scrolling a list of thirty-three to see them.
 */
function standardsPicker(doc: VaultDocument): string {
  const chosen = new Set(doc.standards);
  const picked = STANDARDS.filter((standard) => chosen.has(standard.code));
  const rest = STANDARDS.filter((standard) => !chosen.has(standard.code));

  const chip = (standard: (typeof STANDARDS)[number]) => `<label
      data-standard-chip
      data-search="${escapeHtml(`${standard.code} ${standard.focus} ${standard.domain}`.toLowerCase())}"
      title="${escapeHtml(standard.descriptor ?? standard.focus)}"
      class="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2 py-1.5 text-[0.7rem] leading-snug text-ink-muted transition has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent"
    >
      <input
        type="checkbox"
        data-standard="${doc.id}"
        value="${standard.code}"
        ${chosen.has(standard.code) ? 'checked' : ''}
        class="sr-only"
      />
      <span class="shrink-0 font-mono font-medium">${standard.code}</span>
      <span class="min-w-0">${escapeHtml(standard.focus)}</span>
    </label>`;

  return `<div class="sm:col-span-2">
    <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <p class="text-[0.7rem] font-medium text-ink-muted">
        APST focus areas${picked.length > 0 ? ` · ${picked.length} selected` : ''}
      </p>
      <input type="search" data-standard-search placeholder="Filter…"
        class="w-32 rounded border border-line bg-surface px-2 py-0.5 text-[0.7rem]" />
    </div>
    <div data-standard-list class="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line-subtle bg-canvas p-1.5 sm:grid-cols-2">
      ${[...picked, ...rest].map(chip).join('')}
    </div>
  </div>`;
}

/**
 * The panel's shell: a summary line and an empty body.
 *
 * The body is NOT rendered here. With the APST picker at its full 37 focus
 * areas, rendering every closed panel put 37 checkboxes into the DOM per row —
 * 666 on a page of eighteen files, and several thousand on a real placement.
 * A `<details>` hides its content; it does not avoid building it.
 *
 * So the body is built on first open, by wireDetails, and cached in place. A
 * closed row costs one line again.
 */
export function detailPanel(doc: VaultDocument): string {
  return `<details data-panel class="mb-2.5 rounded-md border border-line-subtle open:border-line open:bg-canvas/40">
    <summary class="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[0.7rem] transition hover:text-ink">${summaryLine(doc)}</summary>
    <div data-panel-body class="border-t border-line-subtle"></div>
  </details>`;
}

/** Everything inside the panel. Built once, the first time it is opened. */
export function detailBody(doc: VaultDocument, options: PanelOptions): string {
  const designed = doc.selfDesigned;

  const folderControl = options.folders
    ? (() => {
        const opts = [`<option value="">Top level</option>`];
        const walk = (parentId: string | null, depth: number) => {
          for (const folder of childFolders(options.folders!, parentId)) {
            opts.push(
              `<option value="${folder.id}"${doc.folderId === folder.id ? ' selected' : ''}>${escapeHtml(
                `${'— '.repeat(depth)}${folder.name}`,
              )}</option>`,
            );
            walk(folder.id, depth + 1);
          }
        };
        walk(null, 0);
        return `<label class="flex items-center gap-2 text-xs text-ink-muted sm:col-span-2">
          <span>Folder</span>
          <select data-move="${doc.id}" class="flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs">
            ${opts.join('')}
          </select>
        </label>`;
      })()
    : '';

  return `<div class="grid gap-2 p-3 sm:grid-cols-2">
      <input
        type="text"
        data-caption="${doc.id}"
        value="${escapeHtml(doc.caption)}"
        placeholder="Caption, printed under this file in the export"
        class="rounded-lg border border-line bg-surface px-2 py-1 text-xs sm:col-span-2"
      />
      ${selectFor('phase', doc.id, CYCLE_PHASES, doc.cyclePhase, 'Stage of the cycle…')}
      ${selectFor('etype', doc.id, EVIDENCE_TYPES, doc.evidenceType, 'Evidence type…')}
      ${selectFor('purpose', doc.id, PURPOSES, doc.purpose, 'Purpose…')}
      ${selectFor('scope', doc.id, SUBJECT_SCOPES, doc.subjectScope, 'Whole class or individual…')}
      <input
        type="text"
        data-source="${doc.id}"
        value="${escapeHtml(doc.source ?? '')}"
        placeholder="Source, e.g. school NAPLAN summary"
        class="rounded-lg border border-line bg-surface px-2 py-1 text-xs sm:col-span-2"
      />
      <label class="flex items-center gap-2 text-xs text-ink-muted sm:col-span-2">
        <span>Who designed it?</span>
        <select data-designed="${doc.id}" class="rounded-lg border border-line bg-surface px-2 py-1 text-xs">
          <option value=""${designed === null ? ' selected' : ''}>Not set</option>
          <option value="yes"${designed === true ? ' selected' : ''}>I designed it</option>
          <option value="no"${designed === false ? ' selected' : ''}>Someone else / commercial</option>
        </select>
      </label>
      ${standardsPicker(doc)}
      <div class="sm:col-span-2">
        <p class="mb-1 text-[0.7rem] font-medium text-ink-muted">Counts toward</p>
        ${programmeChips(doc, options.programmes)}
      </div>
      ${folderControl}
    </div>`;
}

/**
 * Updates one row's warning in place, without re-rendering the list.
 *
 * A full refresh would close the panel somebody is filling in and lose their
 * scroll position, which makes enriching a dozen records miserable.
 */
export function refreshPanelStatus(doc: VaultDocument) {
  const row = document.querySelector<HTMLElement>(`[data-doc-id="${CSS.escape(doc.id)}"]`);
  if (!row) return;

  const badge = row.querySelector<HTMLElement>('[data-needs-detail]');
  if (badge) badge.hidden = isComplete(doc);

  const summary = row.querySelector<HTMLElement>('details > summary');
  if (summary) summary.innerHTML = summaryLine(doc);
}

export interface PanelContext {
  /** Finds a record by id in whatever list the page is holding. */
  find: (id: string) => VaultDocument | undefined;
  /** Shown after each save, and after each failure. */
  setStatus: (message: string) => void;
  /** Runs an action with the page's own error handling around it. */
  guard: (label: string, action: () => Promise<unknown>) => Promise<void>;
  /** Called when a change needs the whole page re-read (a move, a reassignment). */
  reload: () => Promise<void>;
  /** Open projects, for re-rendering the chips after a toggle. */
  programmes: () => Programme[];
  /** Builds the panel body for a record, the first time it is opened. */
  body: (doc: VaultDocument) => string;
}

/**
 * Binds every field in every panel under `root`.
 *
 * Delegated, so a re-rendered list needs no rebinding, and so both pages get
 * identical behaviour from one place rather than two copies that drift.
 */
export function wireDetails(root: HTMLElement, context: PanelContext) {
  // Fill a panel the first time it opens, and never again. `toggle` does not
  // bubble, so this is captured rather than delegated in the usual way.
  root.addEventListener(
    'toggle',
    (event) => {
      const panel = event.target as HTMLDetailsElement;
      if (panel.dataset?.panel === undefined || !panel.open) return;
      const host = panel.querySelector<HTMLElement>('[data-panel-body]');
      if (!host || host.childElementCount > 0) return;
      const id = panel.closest<HTMLElement>('[data-doc-id]')?.dataset.docId;
      const doc = id ? context.find(id) : undefined;
      if (doc) host.innerHTML = context.body(doc);
    },
    true,
  );

  // Filtering the standards list. Local to the open panel and never saved:
  // it is a way of finding 5.4 among thirty-seven, not a preference.
  root.addEventListener('input', (event) => {
    const field = event.target as HTMLInputElement;
    if (field.dataset?.standardSearch === undefined) return;
    const needle = field.value.trim().toLowerCase();
    // Scoped to this record's panel. Reaching up to the nearest <div> found the
    // first list in the document instead, so typing in one row's filter
    // re-revealed every other row's.
    const list = field.closest('[data-doc-id]')?.querySelector('[data-standard-list]');
    for (const chip of list?.querySelectorAll<HTMLElement>('[data-standard-chip]') ?? []) {
      chip.hidden = needle.length > 0 && !(chip.dataset.search ?? '').includes(needle);
    }
  });

  root.addEventListener('click', async (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>('button[data-programme-toggle]');
    if (!toggle) return;

    const id = toggle.dataset.programmeToggle!;
    const programmeId = toggle.dataset.programme!;
    const doc = context.find(id);
    if (!doc) return;

    const next = doc.programmes.includes(programmeId)
      ? doc.programmes.filter((p) => p !== programmeId)
      : [...doc.programmes, programmeId];

    await context.guard('Saving project', async () => {
      await updateDocument(id, { programmes: next });
      doc.programmes = next;
      // Re-render just this record's chips, so an open panel stays open.
      const host = toggle.parentElement;
      if (host) host.outerHTML = programmeChips(doc, context.programmes());
      context.setStatus('Saved.');
    });
  });

  root.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;

    const save = async (
      id: string,
      patch: Record<string, unknown>,
      apply: (doc: VaultDocument) => void,
    ) => {
      await context.guard('Saving detail', async () => {
        await updateDocument(id, patch);
        const doc = context.find(id);
        if (doc) {
          apply(doc);
          refreshPanelStatus(doc);
        }
        context.setStatus('Saved.');
      });
    };

    const blank = (value: string) => (value === '' ? null : value);

    if (target.dataset.phase) {
      const v = blank(target.value);
      // The stage is also what files a record automatically, so the page has to
      // re-read: the row may have just moved into a practice folder.
      await save(target.dataset.phase, { cyclePhase: v }, (d) => (d.cyclePhase = v));
      await context.reload();
      return;
    }
    if (target.dataset.etype) {
      const v = blank(target.value);
      return save(target.dataset.etype, { evidenceType: v }, (d) => (d.evidenceType = v));
    }
    if (target.dataset.purpose) {
      const v = blank(target.value);
      return save(target.dataset.purpose, { purpose: v }, (d) => (d.purpose = v));
    }
    if (target.dataset.scope) {
      const v = blank(target.value);
      return save(target.dataset.scope, { subjectScope: v }, (d) => (d.subjectScope = v));
    }
    if (target.dataset.source) {
      const v = target.value;
      return save(target.dataset.source, { source: v }, (d) => (d.source = v));
    }
    if (target.dataset.designed) {
      const v = target.value === '' ? null : target.value === 'yes';
      return save(target.dataset.designed, { selfDesigned: v }, (d) => (d.selfDesigned = v));
    }
    if (target.dataset.standard) {
      const id = target.dataset.standard;
      const row = root.querySelector<HTMLElement>(`[data-doc-id="${CSS.escape(id)}"]`);
      const codes = [...(row?.querySelectorAll<HTMLInputElement>('[data-standard]') ?? [])]
        .filter((box) => box.checked)
        .map((box) => box.value);
      return save(id, { standards: codes }, (d) => (d.standards = codes));
    }
    if (target.dataset.caption) {
      const id = target.dataset.caption;
      return save(id, { caption: target.value }, (d) => (d.caption = target.value));
    }
    if (target.dataset.move) {
      const id = target.dataset.move;
      await context.guard('Moving file', async () => {
        await updateDocument(id, { folderId: target.value || null });
        await context.reload();
        context.setStatus('Moved.');
      });
    }
  });
}
