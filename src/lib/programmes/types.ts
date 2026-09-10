/**
 * Programme templates.
 *
 * A template is a checklist of evidence plus a typical duration. It is a lens
 * over the vault: it never owns documents, so one artefact can satisfy items in
 * several programmes at once.
 *
 * Templates describe evidence in generic professional terms. They deliberately
 * do not reproduce any assessment provider's rubric, criteria or wording — see
 * docs/PRODUCT.md for why that matters.
 */
import type { Dimensions } from '../vault/dimensions';

export interface ChecklistItem {
  id: string;
  /** Grouping heading, e.g. "Context" or "Planning". */
  section: string;
  label: string;
  /** One line on what would satisfy this, in the user's terms. */
  detail: string;
  /** How many matching records satisfy it. */
  requires: number;
  /**
   * Where in the window this should realistically exist, as a fraction of
   * elapsed time. Drives the "you should have this by now" nudge.
   */
  dueBy: number;
  /** Auto-satisfied by any record whose dimensions match. */
  matches: (evidence: Dimensions) => boolean;
}

export interface ProgrammeTemplate {
  key: string;
  name: string;
  tagline: string;
  /** Who it is for, shown on the picker. */
  audience: string;
  /** Suggested window length in weeks; pre-fills the end date. */
  defaultWeeks: number;
  items: ChecklistItem[];
}

/** Progress for one checklist item against a set of evidence. */
export interface ItemProgress {
  item: ChecklistItem;
  matched: number;
  satisfied: boolean;
  /** True when the window has passed this item's dueBy and it is unmet. */
  overdue: boolean;
}
