/**
 * Builds the data-collection profile: one row per evidence record, describing
 * what was collected, when in the cycle, why, from where, and against which
 * standards.
 *
 * Shared by the on-screen view and the PDF exporter so the two cannot drift —
 * a printed table that disagrees with the screen is worse than no table.
 *
 * Generic on purpose. A practitioner reviewing a year's professional learning
 * wants the same summary a final-placement candidate does; only the framing
 * around it differs, and that belongs to the programme layer.
 */
import {
  CYCLE_PHASES,
  EVIDENCE_TYPES,
  isComplete,
  labelFor,
  PURPOSES,
  SUBJECT_SCOPES,
  type Dimensions,
} from './dimensions';

/** Placeholder for a dimension the user has not filled in yet. */
export const BLANK = '—';

export interface ProfileTableRow {
  /** Source document id, so the screen can link back to the record. */
  documentId: string;
  documentName: string;
  /** Where in the teaching cycle the evidence sits. */
  timing: string;
  type: string;
  purpose: string;
  source: string;
  /** APST codes, comma separated. */
  standards: string;
  /** Whole class or an individual. */
  levelOfUse: string;
  /** Whether the practitioner designed the instrument. */
  selfDesigned: string;
  /** False when any dimension is still missing. */
  complete: boolean;
}

interface Sourceish extends Dimensions {
  id: string;
  name: string;
  order: number;
}

// Explicitly Map<string, number>: CYCLE_PHASES is `as const`, so inference
// would narrow the key to the literal union and reject a nullable column value.
const PHASE_ORDER = new Map<string, number>(
  CYCLE_PHASES.map((phase, index) => [phase.value, index]),
);

/**
 * Rows ordered by stage of the cycle, then by the user's own document order.
 * Records with no stage set sort last, so the table reads as a timeline and
 * the unfinished records are visibly parked at the bottom.
 */
export function buildProfileRows(documents: Sourceish[]): ProfileTableRow[] {
  return documents
    .slice()
    .sort((a, b) => {
      const pa = a.cyclePhase ? (PHASE_ORDER.get(a.cyclePhase) ?? 99) : 100;
      const pb = b.cyclePhase ? (PHASE_ORDER.get(b.cyclePhase) ?? 99) : 100;
      return pa - pb || a.order - b.order || a.name.localeCompare(b.name);
    })
    .map((doc) => ({
      documentId: doc.id,
      documentName: doc.name,
      timing: labelFor(CYCLE_PHASES, doc.cyclePhase) || BLANK,
      type: labelFor(EVIDENCE_TYPES, doc.evidenceType) || BLANK,
      purpose: labelFor(PURPOSES, doc.purpose) || BLANK,
      source: doc.source?.trim() || BLANK,
      standards: doc.standards.length > 0 ? doc.standards.join(', ') : BLANK,
      levelOfUse: labelFor(SUBJECT_SCOPES, doc.subjectScope) || BLANK,
      selfDesigned: doc.selfDesigned === null ? BLANK : doc.selfDesigned ? 'Yes' : 'No',
      complete: isComplete(doc),
    }));
}

/** Column headings, in order, shared by both renderers. */
export const PROFILE_COLUMNS = [
  'Stage of the cycle',
  'Type of evidence',
  'Purpose',
  'Source',
  'APST',
  'Level of use',
  'Designed by me',
] as const;

/** The cell values for one row, matching PROFILE_COLUMNS. */
export function rowCells(row: ProfileTableRow): string[] {
  return [
    row.timing,
    row.type,
    row.purpose,
    row.source,
    row.standards,
    row.levelOfUse,
    row.selfDesigned,
  ];
}

/** How many rows are still missing at least one dimension. */
export function incompleteCount(rows: ProfileTableRow[]): number {
  return rows.filter((row) => !row.complete).length;
}
