/**
 * Template registry.
 *
 * Adding a programme — graduate teacher, registration renewal, a school's own
 * review cycle — is a new file plus one entry here. No schema change, and
 * nothing in the vault needs to know it exists.
 */
import { finalPlacement } from './final-placement';
import { professionalDevelopment } from './professional-development';
import type { ItemProgress, ProgrammeTemplate } from './types';
import type { Dimensions } from '../vault/dimensions';

export type { ChecklistItem, ItemProgress, ProgrammeTemplate } from './types';

export const TEMPLATES: ProgrammeTemplate[] = [finalPlacement, professionalDevelopment];

export function templateFor(key: string): ProgrammeTemplate | undefined {
  return TEMPLATES.find((template) => template.key === key);
}

/** How far through its window a programme is, 0–1. Null when undated. */
export function elapsedFraction(
  startsOn: string | null,
  endsOn: string | null,
  now = Date.now(),
): number | null {
  if (!startsOn || !endsOn) return null;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T23:59:59Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** Which week of the programme today falls in, 1-based. Null when undated. */
export function currentWeek(startsOn: string | null, endsOn: string | null, now = Date.now()): number | null {
  if (!startsOn) return null;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  if (!Number.isFinite(start)) return null;
  const week = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
  if (week < 1) return null;
  const total = totalWeeks(startsOn, endsOn);
  return total ? Math.min(week, total) : week;
}

/** Length of the window in whole weeks, rounded up. Null when undated. */
export function totalWeeks(startsOn: string | null, endsOn: string | null): number | null {
  if (!startsOn || !endsOn) return null;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T23:59:59Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.ceil((end - start) / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Scores every checklist item against the evidence supplied.
 *
 * `elapsed` is the fraction of the window that has passed; pass null for an
 * undated programme, and nothing is ever reported overdue.
 */
export function scoreProgramme(
  template: ProgrammeTemplate,
  evidence: Dimensions[],
  elapsed: number | null,
): ItemProgress[] {
  return template.items.map((item) => {
    const matched = evidence.filter((record) => {
      try {
        return item.matches(record);
      } catch {
        // A bad predicate must not take the whole checklist down.
        return false;
      }
    }).length;
    const satisfied = matched >= item.requires;
    return {
      item,
      matched,
      satisfied,
      overdue: !satisfied && elapsed !== null && elapsed >= item.dueBy,
    };
  });
}
