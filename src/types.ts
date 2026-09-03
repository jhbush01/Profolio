/**
 * Shared domain types for the portfolio.
 *
 * These deliberately describe a *generic* professional evidence portfolio, not
 * a teacher-only one. `Standard` is any professional standard framework
 * (APST for teachers today; NMBA, AITSL-adjacent or design competencies later)
 * and `Phase` is any time-boxed block of practice (a teaching week here).
 * Swapping profession = swapping the JSON in /src/data, not editing components.
 */

/** A single standard/competency descriptor from a professional framework. */
export interface Standard {
  /** Framework code, e.g. "5.4". Used as the join key everywhere. */
  code: string;
  /** Top-level grouping, e.g. "Professional Practice". */
  domain: string;
  /** Short focus-area label. */
  focus: string;
  /** Full descriptor text. */
  descriptor: string;
}

/** One phase of the sequence — a week, in the teaching MVP. */
export interface Phase {
  /** URL segment, e.g. "week-1". Drives /sequence/[week]. */
  slug: string;
  number: number;
  title: string;
  focus: string;
  summary: string;
  learningIntentions: string[];
  plannedEvidence: string[];
  /** Standard codes tagged against this phase. */
  standards: string[];
  reflection: string;
}

/** Broad artefact categories. Extend as new evidence types appear. */
export type ArtefactType =
  | 'lesson-plan'
  | 'planning'
  | 'student-work'
  | 'data'
  | 'reflection'
  | 'media'
  | 'other';

/**
 * A stored piece of evidence.
 *
 * FUTURE: `fileName` / `sizeLabel` stand in for a real storage record. Once
 * uploads are wired to Cloudflare R2 this gains `key`, `contentType`,
 * `bytes` and a signed `url`, and the JSON file is replaced by a D1/KV read.
 */
export interface Artefact {
  id: string;
  title: string;
  type: ArtefactType;
  /** Phase slug this artefact belongs to, or null if unassigned. */
  week: string | null;
  fileName: string;
  sizeLabel: string;
  /** ISO date string. */
  addedOn: string;
  standards: string[];
  caption: string;
}

/** Site-level metadata shown in the header, home page and presentation mode. */
export interface PortfolioMeta {
  owner: string;
  role: string;
  context: string;
  title: string;
  tagline: string;
  /** Short framework key, e.g. "APST". */
  framework: string;
  frameworkName: string;
}
