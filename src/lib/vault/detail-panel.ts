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

const STANDARDS = standardsJson as Array<{ code: string; focus: string; domain: string }>;

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
 * The summary line, which is the bit you see when the panel is shut.
 *
 * It names what is missing rather than saying "incomplete", because the gap is
 * the actionable part: "missing purpose, standards" tells you what to do, and a
 * count tells you only that there is something to do.
 */
function summaryLine(doc: VaultDocument): string {
  const gaps = missingDimensions(doc);
  if (gaps.length === 0) {
    return `<span class="text-positive" aria-hidden="true">●</span>
      <span class="text-ink-muted">Details complete</span>`;
  }
  return `<span class="text-caution" aria-hidden="true">▲</span>
    <span class="text-caution">Missing ${escapeHtml(gaps.join(', '))}</span>`;
}

export interface PanelOptions {
  /** Open projects, for the membership chips. Empty hides the control. */
  programmes: Programme[];
  /** All folders, for the move control. Omit to leave the file where it is. */
  folders?: VaultFolder[];
}

/** The panel, collapsed by default so a folder of thirty files is thirty lines. */
export function detailPanel(doc: VaultDocument, options: PanelOptions): string {
  const standardChips = STANDARDS.map(
    (standard) => `<label
        title="${escapeHtml(standard.focus)}"
        class="cursor-pointer rounded-sm border border-line px-2 py-0.5 font-mono text-[0.7rem] text-ink-muted transition has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:checked]:text-accent"
      >
        <input
          type="checkbox"
          data-standard="${doc.id}"
          value="${standard.code}"
          ${doc.standards.includes(standard.code) ? 'checked' : ''}
          class="sr-only"
        />${standard.code}
      </label>`,
  ).join('');

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

  return `<details class="mb-2.5 rounded-lg border ${
    isComplete(doc) ? 'border-line' : 'border-caution/40 bg-caution-surface/30'
  }">
    <summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">${summaryLine(doc)}</summary>
    <div class="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
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
      <div class="sm:col-span-2">
        <p class="mb-1 text-[0.7rem] font-medium text-ink-muted">APST focus areas</p>
        <div class="flex flex-wrap gap-1">${standardChips}</div>
      </div>
      <div class="sm:col-span-2">
        <p class="mb-1 text-[0.7rem] font-medium text-ink-muted">Counts toward</p>
        ${programmeChips(doc, options.programmes)}
      </div>
      ${folderControl}
    </div>
  </details>`;
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

  const panel = row.querySelector<HTMLElement>('details');
  if (panel) {
    panel.className = `mb-2.5 rounded-lg border ${
      isComplete(doc) ? 'border-line' : 'border-caution/40 bg-caution-surface/30'
    }`;
  }

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
}

/**
 * Binds every field in every panel under `root`.
 *
 * Delegated, so a re-rendered list needs no rebinding, and so both pages get
 * identical behaviour from one place rather than two copies that drift.
 */
export function wireDetails(root: HTMLElement, context: PanelContext) {
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
