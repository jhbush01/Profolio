/**
 * Identifier detection for uploads.
 *
 * Evidence in this domain includes children's work, so a filename like
 * "Year 8 Sarah Smith draft.pdf" is a privacy incident waiting to be exported
 * into a PDF and emailed to an assessor.
 *
 * This warns; it does not block. Blocking on a heuristic would be wrong — a
 * false positive on a legitimate filename is far more likely than a user who
 * ignores a clear warning. The one hard gate is the recorded acknowledgement
 * before a user's first upload (see profiles.deid_ack_at).
 *
 * Detection is deliberately conservative: it looks for shapes that are almost
 * never legitimate in a de-identified artefact name.
 */

export type FindingKind = 'name' | 'email' | 'long-number' | 'date-of-birth';

export interface Finding {
  kind: FindingKind;
  /** The matched text, for showing the user what was spotted. */
  match: string;
  /** Plain-language explanation shown in the warning. */
  reason: string;
}

/**
 * Words that get capitalised in artefact names and are not personal names.
 * Kept lowercase for comparison.
 */
const NOT_NAMES = new Set([
  // Curriculum and schooling
  'year', 'term', 'week', 'semester', 'grade', 'class', 'lesson', 'unit',
  'english', 'maths', 'mathematics', 'science', 'history', 'geography',
  'biology', 'chemistry', 'physics', 'hass', 'health', 'physical', 'education',
  'arts', 'music', 'drama', 'dance', 'media', 'visual', 'technologies',
  'design', 'digital', 'languages', 'literature', 'business', 'economics',
  'civics', 'legal', 'studies', 'psychology', 'religion', 'philosophy',
  // Assessment and evidence
  'diagnostic', 'formative', 'summative', 'pre', 'post', 'test', 'quiz',
  'exit', 'ticket', 'rubric', 'criteria', 'standards', 'marking', 'moderation',
  'assessment', 'task', 'sheet', 'plan', 'planning', 'sequence', 'work',
  'sample', 'samples', 'data', 'results', 'observation', 'notes', 'reflection',
  'feedback', 'annotated', 'draft', 'final', 'copy', 'version',
  // GTPA / APST structure
  'gtpa', 'apst', 'practice', 'focus', 'student', 'whole', 'group', 'cohort',
  'context', 'statement', 'profile', 'coversheet', 'evidence', 'appendix',
  'placement', 'professional', 'experience', 'mentor', 'supervising', 'teacher',
  // Generic
  'the', 'and', 'for', 'with', 'from', 'my', 'new', 'old', 'copy', 'of',
  'school', 'college', 'primary', 'secondary', 'high', 'state', 'catholic',
  'independent', 'public', 'report', 'summary', 'overview', 'table', 'figure',
  'photo', 'image', 'scan', 'document', 'file', 'untitled', 'screenshot',
  // Qualifications and compliance documents — a teacher's vault is full of
  // these, and "First Aid" was a live false positive before this list grew.
  'first', 'aid', 'certificate', 'certification', 'cpr', 'anaphylaxis',
  'asthma', 'blue', 'card', 'working', 'children', 'check', 'clearance',
  'police', 'mandatory', 'reporting', 'induction', 'training', 'course',
  'workshop', 'module', 'development', 'learning', 'registration', 'renewal',
  'accreditation', 'qualification', 'transcript', 'academic', 'record',
  'university', 'faculty', 'code', 'conduct', 'ethics', 'policy', 'procedure',
  'letter', 'reference', 'referee', 'testimonial', 'resume', 'curriculum',
  'vitae', 'application', 'employment', 'contract', 'award', 'completion',
  'attendance', 'hours', 'log', 'logbook', 'evidence', 'portfolio',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);

/** Strips extension and turns separators into spaces. */
function readable(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Two adjacent capitalised words, neither of which is schooling vocabulary,
 * is the shape of a person's name ("Sarah Smith", "J Nguyen").
 */
function probableNames(text: string): string[] {
  const found: string[] = [];
  const words = text.split(' ');

  for (let i = 0; i < words.length - 1; i += 1) {
    const first = words[i]!;
    const second = words[i + 1]!;

    // Require Titlecase (or a single capital initial) on both sides.
    const looksName = (w: string) =>
      /^[A-Z][a-z]{1,20}$/.test(w) || /^[A-Z]$/.test(w) || /^[A-Z]'[A-Z][a-z]+$/.test(w);
    if (!looksName(first) || !looksName(second)) continue;

    // Schooling vocabulary is not a name, in either position.
    if (NOT_NAMES.has(first.toLowerCase()) || NOT_NAMES.has(second.toLowerCase())) continue;

    found.push(`${first} ${second}`);
  }
  return found;
}

/** Scans one piece of user-supplied text for likely identifiers. */
export function scanText(raw: string): Finding[] {
  const findings: Finding[] = [];
  const text = readable(raw);

  for (const match of probableNames(text)) {
    findings.push({
      kind: 'name',
      match,
      reason: 'looks like a person’s name',
    });
  }

  const email = /[\w.+-]+@[\w-]+\.[\w.]{2,}/.exec(raw);
  if (email) {
    findings.push({ kind: 'email', match: email[0], reason: 'is an email address' });
  }

  // Student/enrolment numbers. Six or more digits in a row, but not a plain
  // year and not a date already caught below.
  const digits = /\d{6,}/.exec(raw.replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g, ''));
  if (digits) {
    findings.push({
      kind: 'long-number',
      match: digits[0],
      reason: 'could be a student or enrolment number',
    });
  }

  const dob = /\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b/.exec(raw);
  if (dob) {
    findings.push({ kind: 'date-of-birth', match: dob[0], reason: 'could be a date of birth' });
  }

  return findings;
}

export interface FileFinding {
  fileName: string;
  findings: Finding[];
}

/** Scans a set of files about to be uploaded. */
export function scanFiles(files: File[]): FileFinding[] {
  return files
    .map((file) => ({ fileName: file.name, findings: scanText(file.name) }))
    .filter((entry) => entry.findings.length > 0);
}

/** Human-readable summary for a confirmation dialog. */
export function describeFindings(entries: FileFinding[]): string {
  const lines = entries.map((entry) => {
    const detail = entry.findings.map((f) => `“${f.match}” ${f.reason}`).join('; ');
    return `• ${entry.fileName}\n    ${detail}`;
  });

  return [
    entries.length === 1
      ? 'One file looks like it may identify a student:'
      : `${entries.length} files look like they may identify a student:`,
    '',
    ...lines,
    '',
    'Student work must be de-identified before it goes into a portfolio.',
    'Cancel and rename the files, or continue if these are not identifiers.',
  ].join('\n');
}
