/**
 * Final placement: a sustained teaching sequence in one class, evidenced
 * across the full planning-to-appraisal cycle.
 *
 * Items are written in generic professional language on purpose. They describe
 * the evidence a final-year placement produces, not any one provider's task.
 */
import type { ProgrammeTemplate } from './types';

export const finalPlacement: ProgrammeTemplate = {
  key: 'final-placement',
  name: 'Final placement',
  tagline: 'A sustained teaching sequence, evidenced end to end.',
  audience: 'Final-year pre-service teachers on professional experience.',
  defaultWeeks: 6,
  // Facts about the setting. Generic placement context — nothing here is
  // specific to one assessment task, and duration is derived from the
  // programme's own date window rather than asked twice.
  // Questions, never openings. See ProgrammeTemplate.reportPrompts.
  reportPrompts: {
    Context: [
      'What about this setting shaped what was possible in your teaching?',
      'What did you need to know about these learners before you could plan?',
    ],
    Planning: [
      'What did the diagnostic evidence tell you these learners already knew?',
      'Why did you sequence the learning this way rather than another way?',
      'Which learners did you plan differently for, and what did you change?',
    ],
    Teaching: [
      'What did you do when the class did not respond the way you planned?',
      'Which teaching decision would you make differently, and on what evidence?',
      'How did you adjust for the individuals you were tracking?',
    ],
    Assessing: [
      'What did the assessment tell you that you did not already know?',
      'How did you check your judgement against somebody else\'s?',
      'What did learners do with the feedback you gave them?',
    ],
    Reflecting: [
      'What changed in your practice across this placement, and what caused it?',
      'What did you try that did not work, and what did you learn from it?',
    ],
    Appraising: [
      'What is your evidence that these learners moved, and how far?',
      'What would you need to do differently to move them further?',
    ],
  },

  contextFields: [
    { id: 'setting', label: 'School or centre', kind: 'text', hint: 'Optional. Left out if you would rather keep the setting unnamed.' },
    { id: 'sector', label: 'Sector', kind: 'select', options: ['Government', 'Catholic', 'Independent', 'Other'] },
    { id: 'phase', label: 'Education phase', kind: 'select', options: ['Early childhood', 'Primary', 'Secondary', 'Combined', 'Other'] },
    { id: 'postcode', label: 'Postcode', kind: 'text', hint: 'Locates the setting without naming it.' },
    { id: 'schoolSize', label: 'Students in the setting', kind: 'number' },
    { id: 'classSize', label: 'Students in the class', kind: 'number' },
    { id: 'yearBand', label: 'Phase of learning', kind: 'select', options: ['F–Year 3', 'Year 4–Year 6', 'Year 7–Year 10', 'Year 11–Year 12'] },
    { id: 'yearLevel', label: 'Year level', kind: 'text', hint: 'For example: Year 8. For multi-age classes, the level of the individuals you tracked.' },
    { id: 'learningArea', label: 'Learning area', kind: 'select', options: ['English', 'Health and Physical Education', 'Humanities and Social Sciences', 'Languages', 'Mathematics', 'Science', 'Technologies', 'The Arts', 'Other'] },
    { id: 'inSpecialisation', label: 'Your specialisation or major?', kind: 'select', options: ['Yes', 'No'] },
    { id: 'sequenceFocus', label: 'Focus of the learning sequence', kind: 'text', hint: 'For example: Number and algebra.' },
    { id: 'framework', label: 'Pedagogical framework', kind: 'text', hint: 'Any whole-school approach you were teaching within.' },
    { id: 'cohort', label: 'Class characteristics', kind: 'longtext', hint: 'Composition and learning needs, described without identifying anyone.' },
    { id: 'community', label: 'Community context', kind: 'longtext', hint: 'Anything about the community that shaped your teaching.' },
  ],
  items: [
    {
      id: 'context',
      section: 'Context',
      label: 'School and class context',
      detail: 'Notes on the setting, class composition and the school’s pedagogical framework.',
      requires: 1,
      dueBy: 0.15,
      matches: (e) => e.evidenceType === 'observation' || e.evidenceType === 'other',
    },
    {
      id: 'diagnostic',
      section: 'Planning',
      label: 'Whole-class diagnostic data',
      detail: 'Evidence of prior learning and current achievement for the whole class.',
      requires: 1,
      dueBy: 0.2,
      matches: (e) =>
        e.purpose === 'diagnostic' && e.subjectScope === 'cohort' && e.evidenceType === 'assessment-data',
    },
    {
      id: 'individual-baseline',
      section: 'Planning',
      label: 'Individual starting points',
      detail: 'Baseline evidence for the individuals you are tracking across the sequence.',
      requires: 3,
      dueBy: 0.25,
      matches: (e) => e.subjectScope === 'individual' && e.cyclePhase === 'plan',
    },
    {
      id: 'sequence-plan',
      section: 'Planning',
      label: 'Learning sequence plan',
      detail: 'The unit or sequence showing how curriculum, teaching and assessment align.',
      requires: 1,
      dueBy: 0.25,
      matches: (e) => e.evidenceType === 'plan' && e.cyclePhase === 'plan',
    },
    {
      id: 'summative-task',
      section: 'Planning',
      label: 'Summative task and marking criteria',
      detail: 'The end-of-sequence task with its criteria, planned before you teach.',
      requires: 1,
      dueBy: 0.3,
      matches: (e) => e.purpose === 'summative' && (e.evidenceType === 'plan' || e.evidenceType === 'resource'),
    },
    {
      id: 'differentiation',
      section: 'Teaching',
      label: 'Differentiated teaching evidence',
      detail: 'Resources or plans showing adjustments across the range of abilities.',
      requires: 1,
      dueBy: 0.5,
      matches: (e) => e.cyclePhase === 'teach' && (e.evidenceType === 'resource' || e.evidenceType === 'plan'),
    },
    {
      id: 'formative-cohort',
      section: 'Teaching',
      label: 'Formative data across the sequence',
      detail: 'Ongoing checks showing how whole-class learning progressed.',
      requires: 2,
      dueBy: 0.6,
      matches: (e) => e.purpose === 'formative' && e.subjectScope === 'cohort',
    },
    {
      id: 'formative-individual',
      section: 'Teaching',
      label: 'Individual work across the range',
      detail: 'Work samples from the individuals you are tracking, showing progress.',
      requires: 3,
      dueBy: 0.7,
      matches: (e) => e.subjectScope === 'individual' && e.evidenceType === 'work-sample',
    },
    {
      id: 'feedback',
      section: 'Assessing',
      label: 'Feedback given to learners',
      detail: 'Examples of the feedback you provided and how learners used it.',
      requires: 1,
      dueBy: 0.75,
      matches: (e) => e.evidenceType === 'feedback',
    },
    {
      id: 'summative-results',
      section: 'Assessing',
      label: 'Summative results',
      detail: 'Marked work against the criteria you planned.',
      requires: 1,
      dueBy: 0.85,
      matches: (e) => e.purpose === 'summative' && e.evidenceType === 'assessment-data',
    },
    {
      id: 'moderation',
      section: 'Assessing',
      label: 'Moderation of your judgements',
      detail: 'Evidence that a colleague checked your grading against the same criteria.',
      requires: 1,
      dueBy: 0.9,
      matches: (e) => e.cyclePhase === 'assess' && e.selfDesigned === false,
    },
    {
      id: 'reflection',
      section: 'Reflecting',
      label: 'Reflection on practice',
      detail: 'Your account of what you changed during the sequence, and why.',
      requires: 1,
      dueBy: 0.9,
      matches: (e) => e.cyclePhase === 'reflect',
    },
    {
      id: 'appraisal',
      section: 'Appraising',
      label: 'Appraisal of impact',
      detail: 'Evidence comparing where learners started with where they finished.',
      requires: 1,
      dueBy: 1,
      matches: (e) => e.cyclePhase === 'appraise',
    },
  ],
};
