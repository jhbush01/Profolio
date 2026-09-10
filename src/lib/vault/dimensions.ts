/**
 * Vocabularies for the evidence dimensions.
 *
 * Shared by client and server so the two cannot drift, and kept generic on
 * purpose: these describe any practitioner's evidence across a career, not one
 * assessment task. A programme (see docs/PRODUCT.md) maps these to whatever it
 * needs to output.
 */

export const CYCLE_PHASES = [
  { value: 'plan', label: 'Planning' },
  { value: 'teach', label: 'Teaching' },
  { value: 'assess', label: 'Assessing and feedback' },
  { value: 'reflect', label: 'Reflecting' },
  { value: 'appraise', label: 'Appraising impact' },
] as const;

export const EVIDENCE_TYPES = [
  { value: 'plan', label: 'Plan or unit' },
  { value: 'work-sample', label: 'Work sample' },
  { value: 'assessment-data', label: 'Assessment data' },
  { value: 'observation', label: 'Observation or notes' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'resource', label: 'Resource or artefact' },
  { value: 'reflection', label: 'Reflection' },
  { value: 'qualification', label: 'Qualification or certificate' },
  { value: 'other', label: 'Other' },
] as const;

export const PURPOSES = [
  { value: 'diagnostic', label: 'Diagnostic' },
  { value: 'formative', label: 'Formative' },
  { value: 'summative', label: 'Summative' },
  { value: 'other', label: 'Other' },
] as const;

export const SUBJECT_SCOPES = [
  { value: 'cohort', label: 'Whole class or cohort' },
  { value: 'individual', label: 'One individual' },
] as const;

type Option = { readonly value: string; readonly label: string };

export function labelFor(options: readonly Option[], value: string | null): string {
  if (!value) return '';
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * The dimensions a record needs before it can appear in a generated
 * data-collection profile. Everything is optional at upload; this is what the
 * "needs detail" badge measures against.
 */
export interface Dimensions {
  cyclePhase: string | null;
  evidenceType: string | null;
  purpose: string | null;
  source: string | null;
  subjectScope: string | null;
  selfDesigned: boolean | null;
  standards: string[];
  capturedAt: number | null;
}

/** Which dimensions are still missing, as human-readable labels. */
export function missingDimensions(d: Dimensions): string[] {
  const gaps: string[] = [];
  if (!d.cyclePhase) gaps.push('stage of the cycle');
  if (!d.evidenceType) gaps.push('evidence type');
  if (!d.purpose) gaps.push('purpose');
  if (!d.source?.trim()) gaps.push('source');
  if (!d.subjectScope) gaps.push('whole class or individual');
  if (d.selfDesigned === null) gaps.push('who designed it');
  if (d.standards.length === 0) gaps.push('standards');
  return gaps;
}

export function isComplete(d: Dimensions): boolean {
  return missingDimensions(d).length === 0;
}
