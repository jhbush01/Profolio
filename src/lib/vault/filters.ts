/**
 * Narrowing a list of artefacts down to the ones you are actually after.
 *
 * The reason this exists is the one question the app could not answer: "which
 * of these still need their details filled in?" A badge counted them and a dot
 * marked them, but finding them meant scrolling every folder looking for dots.
 * A count you cannot act on is a nag.
 *
 * Deliberately a small fixed set rather than a query builder. Four facets cover
 * what someone actually wants — what is unfinished, where in the cycle, what
 * kind of thing, which standard — and a fifth would be a filter nobody opens.
 *
 * Shared by the Artefacts page and a project's Evidence tab, so the two cannot
 * disagree about what "needs detail" means.
 */
import { CYCLE_PHASES, EVIDENCE_TYPES, isComplete, missingDimensions } from './dimensions';
import { escapeHtml } from './file-browser';
import { renderKindFor } from './types';
import type { VaultDocument } from './types';

export interface Filters {
  /** 'incomplete' keeps only records missing a dimension; 'complete' the rest. */
  status: '' | 'incomplete' | 'complete';
  /** A `cyclePhase` value, or '' for any. */
  phase: string;
  /** An `evidenceType` value, or '' for any. */
  type: string;
  /** A single APST code, or '' for any. */
  standard: string;
}

export const NO_FILTERS: Filters = { status: '', phase: '', type: '', standard: '' };

export function anyActive(filters: Filters): boolean {
  return Object.values(filters).some(Boolean);
}

export function applyFilters(documents: VaultDocument[], filters: Filters): VaultDocument[] {
  return documents.filter((doc) => {
    if (filters.status === 'incomplete' && isComplete(doc)) return false;
    if (filters.status === 'complete' && !isComplete(doc)) return false;
    if (filters.phase && doc.cyclePhase !== filters.phase) return false;
    if (filters.type && doc.evidenceType !== filters.type) return false;
    if (filters.standard && !doc.standards.includes(filters.standard)) return false;
    return true;
  });
}

/**
 * The bar.
 *
 * The unfinished count leads, and it is a toggle rather than a label — that is
 * the filter people came for. It disappears entirely when there is nothing
 * unfinished, because a control that can only ever return an empty list is
 * clutter.
 */
export function filterBar(documents: VaultDocument[], filters: Filters): string {
  const incomplete = documents.filter((doc) => !isComplete(doc)).length;

  // Only the values actually present. Offering "Appraising impact" on a vault
  // with nothing appraised is offering an empty result.
  const phasesPresent = CYCLE_PHASES.filter((phase) =>
    documents.some((doc) => doc.cyclePhase === phase.value),
  );
  const typesPresent = EVIDENCE_TYPES.filter((type) =>
    documents.some((doc) => doc.evidenceType === type.value),
  );
  const standardsPresent = [...new Set(documents.flatMap((doc) => doc.standards))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );

  const select = (
    name: keyof Filters,
    placeholder: string,
    options: { value: string; label: string }[],
    current: string,
  ) =>
    options.length === 0
      ? ''
      : `<select data-filter="${name}" aria-label="${escapeHtml(placeholder)}"
           class="shrink-0 rounded-md border px-2 py-1 text-xs transition ${
             current ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-muted'
           }">
          <option value="">${escapeHtml(placeholder)}</option>
          ${options
            .map(
              (option) =>
                `<option value="${escapeHtml(option.value)}"${
                  option.value === current ? ' selected' : ''
                }>${escapeHtml(option.label)}</option>`,
            )
            .join('')}
        </select>`;

  // `nowrap` with shrink-0 children, so on a narrow screen this becomes one
  // horizontally scrollable strip inside its container rather than wrapping
  // into a second and third row of controls. Above `lg` there is room and it
  // never scrolls, so the behaviour costs nothing where it is not needed.
  return `<div class="flex w-max items-center gap-2 lg:w-auto">
    ${
      incomplete > 0
        ? `<button type="button" data-filter-status
             aria-pressed="${filters.status === 'incomplete'}"
             class="pf-press shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
               filters.status === 'incomplete'
                 ? 'border-caution bg-caution-surface text-caution'
                 : 'border-line bg-surface text-ink-muted hover:border-caution/40 hover:text-caution'
             }">
             ${incomplete} need detail
           </button>`
        : ''
    }
    ${select('phase', 'Any stage', phasesPresent.map((p) => ({ value: p.value, label: p.label })), filters.phase)}
    ${select('type', 'Any type', typesPresent.map((t) => ({ value: t.value, label: t.label })), filters.type)}
    ${select('standard', 'Any standard', standardsPresent.map((code) => ({ value: code, label: code })), filters.standard)}
    ${
      anyActive(filters)
        ? `<button type="button" data-filter-clear
             class="pf-press shrink-0 rounded-md px-2 py-1 text-xs text-ink-faint underline underline-offset-2 transition hover:text-ink">Clear</button>`
        : ''
    }
  </div>`;
}

/**
 * Reads a filter change out of an event, or null if it was not one.
 *
 * Returns the next state rather than mutating, so the page owns its own state
 * and this stays a pure function of what happened.
 *
 * THE EVENT TYPE MATTERS. Pages bind both `click` and `change` here, and a
 * click on a <select> is the click that OPENS its dropdown. Handling that click
 * meant re-rendering the bar — replacing the <select> element — while its
 * dropdown was open, so the menu appeared and vanished in the same instant and
 * the filter could never be used. Buttons answer to clicks; selects answer to
 * change, and only to change.
 */
export function filterFromEvent(event: Event, current: Filters): Filters | null {
  const target = event.target as HTMLElement;

  if (event.type === 'change') {
    const select = target.closest('select[data-filter]') as HTMLSelectElement | null;
    if (!select) return null;
    const name = select.dataset.filter as keyof Filters;
    return { ...current, [name]: select.value };
  }

  if (target.closest('[data-filter-status]')) {
    return { ...current, status: current.status === 'incomplete' ? '' : 'incomplete' };
  }
  if (target.closest('[data-filter-clear]')) return { ...NO_FILTERS };

  return null;
}

/** "3 of 40 shown" — so a short list never reads as a lost list. */
export function filterSummary(shown: number, total: number, filters: Filters): string {
  if (!anyActive(filters)) return '';
  return shown === 0
    ? 'Nothing matches these filters.'
    : `${shown} of ${total} shown.`;
}

/** The first unfilled field on a record, for a row that wants one word. */
export function firstGap(doc: VaultDocument): string | null {
  return missingDimensions(doc)[0] ?? null;
}

/** Kept here so a filter on "video" and a badge saying "Video" agree. */
export function kindOf(doc: VaultDocument): string {
  return renderKindFor(doc.mime, doc.name);
}
