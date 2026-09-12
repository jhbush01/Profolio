/**
 * The written half of a project, shared by the Report tab and both exports.
 *
 * Its own module rather than living in export-ui: the project page needs it
 * too, and importing it from there would pull the whole export-page controller
 * and its state into a bundle that has no export page in it.
 */
import type { Programme } from './db';
import { templateFor } from '../programmes';

/** Written sections in template order, with the unanswered ones dropped. */
export function reportSections(programme: Programme): { section: string; body: string }[] {
  const template = templateFor(programme.template);
  if (!template) return [];
  const written = programme.report ?? {};
  return [...new Set(template.items.map((item) => item.section))]
    .map((section) => ({ section, body: (written[section] ?? '').trim() }))
    .filter((entry) => entry.body.length > 0);
}
