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

/**
 * One field of a programme's context record.
 *
 * Declared by the template, so a new programme type brings its own questions
 * without touching the schema.
 */
export interface ContextField {
  id: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'longtext';
  /** Shown under the input. */
  hint?: string;
  /** For `select` only. */
  options?: readonly string[];
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
  /** Context questions for this programme. Empty means the section is hidden. */
  contextFields: ContextField[];
  /**
   * The report, as an ordered outline. This is the essay a portfolio is,
   * scaffolded: one entry per heading, in the order they are written and
   * exported.
   *
   * TITLES ARE TEMPLATE DATA, ON PURPOSE. An institution whose assessment has
   * its own required headings replaces them here and nothing else changes —
   * the storage is keyed on `id`, so renaming a title never orphans what
   * someone already wrote.
   *
   * PROMPTS ARE QUESTIONS ONLY. Never a starter sentence, an example answer,
   * or a phrase to adapt: docs/PRODUCT.md rules out drafting or suggesting
   * reflective writing, and an assessor is meant to be reading the
   * practitioner's thinking rather than a form letter.
   */
  reportOutline?: readonly ReportHeading[];
}

export interface ReportHeading {
  /** Stable storage key. Changing a title must never orphan written text. */
  id: string;
  /** The heading as it appears on screen and in the export. Replaceable. */
  title: string;
  /** One line on what this heading is for. */
  blurb?: string;
  prompts: readonly string[];
  /** Checklist sections whose evidence is gathered under this heading. */
  sections?: readonly string[];
  /** Render the project's context statement fields here, editable. */
  includesContext?: boolean;
  /** Render the generated data collection table here. */
  includesDataProfile?: boolean;
}

/** Progress for one checklist item against a set of evidence. */
export interface ItemProgress {
  item: ChecklistItem;
  matched: number;
  satisfied: boolean;
  /** True when the window has passed this item's dueBy and it is unmet. */
  overdue: boolean;
}
