/**
 * The written half of a project, shared by the Report tab and both exports.
 *
 * Its own module rather than living in export-ui: the project page needs it
 * too, and importing it from there would pull the whole export-page controller
 * and its state into a bundle that has no export page in it.
 */
import type { Programme } from './db';
import type { ReportEntry } from './pdf';
import { outlineFor, templateFor, writtenFor } from '../programmes';

interface EntryOptions {
  /** False drops the context lines from wherever the outline puts them. */
  includeContext?: boolean;
  /** False stops any heading from claiming the data collection table. */
  includeProfileTable?: boolean;
}

/**
 * The report as the export should print it: outline order, outline titles, with
 * the context statement and the data collection table attached to whichever
 * heading the template says they belong under.
 *
 * A heading survives if it has any of the three. A heading with nothing written,
 * no context and no table is a bare title, which is worse than an absence.
 */
export function reportEntries(programme: Programme, options: EntryOptions = {}): ReportEntry[] {
  const { includeContext = true, includeProfileTable = true } = options;
  const template = templateFor(programme.template);
  if (!template) return [];

  const written = programme.report ?? {};
  const lines = includeContext ? contextLines(programme) : [];

  return outlineFor(template)
    .map((heading) => ({
      section: heading.title,
      body: writtenFor(written, heading).trim(),
      contextLines: heading.includesContext ? lines : [],
      includesDataProfile: includeProfileTable && heading.includesDataProfile === true,
    }))
    .filter(
      (entry) =>
        entry.body.length > 0 || entry.contextLines.length > 0 || entry.includesDataProfile,
    );
}

/** The context statement as "Label: value" lines, unanswered fields dropped. */
export function contextLines(programme: Programme): string[] {
  const template = templateFor(programme.template);
  if (!template) return [];
  return template.contextFields
    .map((field) => {
      const value = programme.context[field.id]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => line !== null);
}
