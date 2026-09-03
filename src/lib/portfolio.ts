/**
 * Data access layer.
 *
 * Every page reads through these helpers rather than importing JSON directly,
 * so there is exactly one seam to replace when the data moves off disk.
 *
 * FUTURE: swap the JSON imports for `fetch` against a Cloudflare D1/KV binding
 * (or an Astro content collection) and make these async. Callers already
 * `await` nothing, so add `async` here and `await` at the call sites — the
 * component tree does not change.
 */
import artefactsJson from '../data/artefacts.json';
import portfolioJson from '../data/portfolio.json';
import sequenceJson from '../data/sequence.json';
import standardsJson from '../data/standards.json';
import type { Artefact, Phase, PortfolioMeta, Standard } from '../types';

export const portfolio = portfolioJson as PortfolioMeta;

/** All phases (weeks), ordered. */
export const phases: Phase[] = (sequenceJson as Phase[])
  .slice()
  .sort((a, b) => a.number - b.number);

/** All standards in the active framework, ordered by code. */
export const standards: Standard[] = (standardsJson as Standard[])
  .slice()
  .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

/** All artefacts, newest first. */
export const artefacts: Artefact[] = (artefactsJson as Artefact[])
  .slice()
  .sort((a, b) => b.addedOn.localeCompare(a.addedOn));

export function getPhase(slug: string): Phase | undefined {
  return phases.find((phase) => phase.slug === slug);
}

export function getStandard(code: string): Standard | undefined {
  return standards.find((standard) => standard.code === code);
}

/** Artefacts attached to one phase. */
export function artefactsForPhase(slug: string): Artefact[] {
  return artefacts.filter((artefact) => artefact.week === slug);
}

/** Artefacts tagged with a given standard code. */
export function artefactsForStandard(code: string): Artefact[] {
  return artefacts.filter((artefact) => artefact.standards.includes(code));
}

/**
 * Coverage map: how many artefacts and phases touch each standard.
 * Drives the "what evidence am I still missing?" view.
 */
export function standardCoverage(): Array<Standard & { artefactCount: number; phaseCount: number }> {
  return standards.map((standard) => ({
    ...standard,
    artefactCount: artefactsForStandard(standard.code).length,
    phaseCount: phases.filter((phase) => phase.standards.includes(standard.code)).length,
  }));
}

/** Human-readable label for an artefact type. */
export function artefactTypeLabel(type: Artefact['type']): string {
  const labels: Record<Artefact['type'], string> = {
    'lesson-plan': 'Lesson plan',
    planning: 'Planning',
    'student-work': 'Student work',
    data: 'Data',
    reflection: 'Reflection',
    media: 'Media',
    other: 'Other',
  };
  return labels[type] ?? 'Other';
}
