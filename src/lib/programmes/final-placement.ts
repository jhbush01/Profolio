/**
 * Final placement: a sustained teaching sequence in one class, evidenced
 * across the full planning-to-appraisal cycle.
 *
 * WHAT IS TAKEN FROM THE ASSESSMENT, AND WHAT IS NOT.
 *
 * The headings, the required elements, the context-statement fields, the data
 * table's columns and the per-section word counts are structure: the shape a
 * submission has to have, which a candidate is told and must follow. Those are
 * here, so the app produces a submission that is laid out correctly instead of
 * one the candidate has to rearrange by hand afterwards.
 *
 * Nothing else is. No criteria, no standards descriptors, no rubric, no
 * exemplars, no guidance prose — see docs/PRODUCT.md. Every prompt below is
 * written here, is a question, and is never a sentence to adapt: the whole
 * value of the writing is that an assessor is reading the candidate's thinking.
 *
 * Providers revise this annually. Titles, fields and word counts are data for
 * exactly that reason — a new year is an edit to this file, and the `id` on
 * each heading means nobody's written work moves when a title does.
 */
import type { ProgrammeTemplate } from './types';

/** Section headings on the checklist, and the folders evidence is filed into. */
const PRACTICE = {
  one: 'Practice 1: Planning using data',
  two: 'Practice 2: Teaching and learning',
  three: 'Practice 3: Assessing, feedback and judgement',
  four: 'Practice 4: Reflecting on teaching',
  five: 'Practice 5: Appraising impact',
} as const;

export const finalPlacement: ProgrammeTemplate = {
  key: 'final-placement',
  name: 'Final placement',
  tagline: 'A sustained teaching sequence, evidenced end to end.',
  audience: 'Final-year pre-service teachers on professional experience.',
  defaultWeeks: 6,

  // Evidence files itself by the stage of the cycle it was set to, into a
  // folder per practice inside a folder named after the project.
  autoFolderByPhase: {
    plan: PRACTICE.one,
    teach: PRACTICE.two,
    assess: PRACTICE.three,
    reflect: PRACTICE.four,
    appraise: PRACTICE.five,
  },

  reportOutline: [
    {
      id: 'context',
      title: 'Professional experience context statement',
      blurb: 'Goes at the front of the submission. Every field is required.',
      legacyKeys: ['Context'],
      includesContext: true,
      prompts: [],
    },
    {
      id: 'planning',
      title: 'Practice 1: Planning using data at whole class and individual levels',
      blurb:
        'What you collected, what it told you, and the sequence you built from it — for the whole class and for your three focus students.',
      sections: [PRACTICE.one],
      legacyKeys: ['Planning'],
      wordRange: [800, 1000],
      // Mandatory Inclusion 3 is embedded in Practice 1. It is not an appendix.
      includesDataProfile: true,
      prompts: [
        'What data did you collect before you planned, and why that data rather than other data?',
        'What did it tell you these learners already knew, and what did you assume beyond it?',
        'How did your three focus students differ, and what did you plan differently for each?',
        'Where do curriculum, your assessment and your teaching line up in this sequence?',
        'What did you decide about the summative task before you started teaching?',
      ],
    },
    {
      id: 'teaching',
      title: 'Practice 2: Teaching and learning',
      blurb: 'The sequence as enacted, and the decisions you made while it was happening.',
      sections: [PRACTICE.two],
      legacyKeys: ['Teaching'],
      wordRange: [800, 1000],
      prompts: [
        'Which teaching strategies did you choose, and on what basis?',
        'Where did the enacted sequence differ from the planned one, and what caused the change?',
        'Give an instance of a decision you made mid-lesson. What prompted it and what followed?',
        'How did you adjust for the full range of abilities in the class?',
        'Where did you teach literacy, numeracy or another general capability explicitly?',
      ],
    },
    {
      id: 'assessing',
      title: 'Practice 3: Assessing, feedback and professional judgement',
      blurb:
        'Formative and summative assessment, the feedback you gave, and how your judgements held up under moderation.',
      sections: [PRACTICE.three],
      legacyKeys: ['Assessing'],
      wordRange: [800, 1000],
      prompts: [
        'How did you make what "good" looks like visible to these learners?',
        'What did learners actually do with the feedback you gave them?',
        'Why was your summative task fit for what you had taught?',
        'For each focus student: what in the work led you to the grade you gave?',
        'What changed in your judgement after moderation, and what did that teach you?',
      ],
    },
    {
      id: 'reflecting',
      title: 'Practice 4: Reflecting on teaching as planned and enacted',
      blurb: 'Whether your data was enough, what you changed because of it, and what you would do next.',
      sections: [PRACTICE.four],
      legacyKeys: ['Reflecting'],
      wordRange: [800, 1000],
      prompts: [
        'Was your initial data collection sufficient? What would you collect that you did not?',
        'Which changes to your teaching came from data, and which came from something else?',
        'What did ongoing data tell you about these learners that your first read had missed?',
        'If you were their class teacher next term, what would you teach next, and why?',
      ],
    },
    {
      id: 'appraising',
      title: 'Practice 5: Appraising impact of teaching',
      blurb: 'Two scenarios — one whole class, one individual or small group — with the evidence behind each.',
      sections: [PRACTICE.five],
      legacyKeys: ['Appraising'],
      wordRange: [800, 1000],
      prompts: [
        'Scenario one, whole class: what did you do, and what is your evidence it worked?',
        'Scenario two, an individual or small group: the same two questions.',
        'Comparing first and last work samples, where did learning move and where did it not?',
        'Which of your Practice 1 assumptions turned out to be wrong?',
        'What got in the way of learning that you could not shift?',
      ],
    },
    {
      id: 'references',
      title: 'Reference list',
      blurb:
        'Everything you cited — curriculum, school documents, policy, theory and research — in the referencing style your provider requires.',
      prompts: [],
    },
  ],

  /*
   * The context statement's fields, in the order the submission asks for them.
   *
   * Placement duration is not here: it is worked out from the project's own
   * dates, so it cannot disagree with them.
   *
   * Nor is the school's name. The submission does not ask for it, and this app
   * warns on identifiers in a filename — asking for the one identifier that
   * matters most, in a free-text box, and then printing it at the front of the
   * export would be the app undermining its own rule.
   */
  contextFields: [
    { id: 'sector', label: 'Employing sector', kind: 'select', options: ['State', 'State–Independent Public School', 'Catholic', 'Independent School'] },
    { id: 'phase', label: 'Education phase', kind: 'select', options: ['Early Childhood', 'Primary', 'Secondary', 'F/P–10', 'F/P–12', 'Other'] },
    { id: 'postcode', label: 'School or learning centre postcode', kind: 'text', hint: 'Locates the setting without naming it.' },
    { id: 'schoolSize', label: 'Size of school or learning centre', kind: 'number' },
    { id: 'classSize', label: 'Size of class', kind: 'number' },
    { id: 'demographics', label: 'Other demographics', kind: 'longtext', hint: 'Community partnerships, specialised programs, ICSEA, the cultural and linguistic make-up of the student population.' },
    { id: 'framework', label: 'Pedagogical framework', kind: 'text', hint: 'Any whole-school approach you were teaching within.' },
    { id: 'yearBand', label: 'Year level (phase of learning)', kind: 'select', options: ['F/P–Year 3', 'Year 4–Year 6', 'Year 7–Year 10', 'Year 11–Year 12'] },
    { id: 'yearLevel', label: 'Year level (grade)', kind: 'text', hint: 'For example: Year 8. For a multi-age class, the year level of your three focus students.' },
    { id: 'learningArea', label: 'Teaching area', kind: 'select', options: ['English', 'Health and Physical Education', 'Humanities and Social Sciences', 'Languages', 'Mathematics', 'Science', 'Technologies', 'The Arts', 'Other'] },
    { id: 'inSpecialisation', label: 'Your specialisation or major?', kind: 'select', options: ['Yes', 'No'] },
    { id: 'sequenceFocus', label: 'Focus of the learning sequence or unit', kind: 'text', hint: 'For example: Number and algebra.' },
    { id: 'cohort', label: 'Student characteristics in this class', kind: 'longtext', hint: 'Individual education plans, disability, gifted and talented, cultural and linguistic backgrounds. Describe without identifying anyone.' },
    { id: 'aiUse', label: 'Did you use AI?', kind: 'select', options: ['No', 'Yes'] },
    { id: 'aiHow', label: 'If yes, how did you use it?', kind: 'longtext' },
    { id: 'pathway', label: 'Employment-based pathway', kind: 'text', hint: 'Leave blank if you are not on one. Otherwise name it.' },
  ],

  items: [
    {
      id: 'diagnostic',
      section: PRACTICE.one,
      label: 'Whole-class data before you planned',
      detail: 'Evidence of prior learning and current achievement for the whole class.',
      requires: 1,
      dueBy: 0.2,
      matches: (e) =>
        e.purpose === 'diagnostic' && e.subjectScope === 'cohort' && e.evidenceType === 'assessment-data',
    },
    {
      id: 'individual-baseline',
      section: PRACTICE.one,
      label: 'Starting points for your three focus students',
      detail: 'Baseline evidence for each of the three students you track across the sequence.',
      requires: 3,
      dueBy: 0.25,
      matches: (e) => e.subjectScope === 'individual' && e.cyclePhase === 'plan',
    },
    {
      id: 'sequence-plan',
      section: PRACTICE.one,
      label: 'The learning sequence or unit',
      detail: 'Planning documents showing how curriculum, teaching and assessment align.',
      requires: 1,
      dueBy: 0.25,
      matches: (e) => e.evidenceType === 'plan' && e.cyclePhase === 'plan',
    },
    {
      id: 'summative-task',
      section: PRACTICE.one,
      label: 'Summative task and its marking criteria',
      detail: 'The end-of-sequence task with its criteria, planned before you teach.',
      requires: 1,
      dueBy: 0.3,
      matches: (e) => e.purpose === 'summative' && (e.evidenceType === 'plan' || e.evidenceType === 'resource'),
    },
    {
      id: 'differentiation',
      section: PRACTICE.two,
      label: 'Annotated resources from your teaching',
      detail: 'Materials you made or adapted, showing adjustments across the range of abilities.',
      requires: 1,
      dueBy: 0.5,
      matches: (e) => e.cyclePhase === 'teach' && (e.evidenceType === 'resource' || e.evidenceType === 'plan'),
    },
    {
      id: 'formative-cohort',
      section: PRACTICE.two,
      label: 'Ongoing data across the sequence',
      detail: 'Formative checks showing how whole-class learning progressed.',
      requires: 2,
      dueBy: 0.6,
      matches: (e) => e.purpose === 'formative' && e.subjectScope === 'cohort',
    },
    {
      id: 'formative-individual',
      section: PRACTICE.two,
      label: 'Focus student work across the sequence',
      detail: 'Work samples from your three focus students, showing progress.',
      requires: 3,
      dueBy: 0.7,
      matches: (e) => e.subjectScope === 'individual' && e.evidenceType === 'work-sample',
    },
    {
      id: 'feedback',
      section: PRACTICE.three,
      label: 'Feedback given to learners',
      detail: 'Annotated work showing the feedback you provided and what learners did with it.',
      requires: 1,
      dueBy: 0.75,
      matches: (e) => e.evidenceType === 'feedback',
    },
    {
      id: 'summative-results',
      section: PRACTICE.three,
      label: 'Marked summative work',
      detail: 'De-identified work samples marked against the criteria you planned.',
      requires: 3,
      dueBy: 0.85,
      matches: (e) => e.purpose === 'summative' && e.evidenceType === 'assessment-data',
    },
    {
      id: 'commentary',
      section: PRACTICE.three,
      label: 'A commentary on each judgement',
      detail: 'Your written account of how you arrived at the grade for each focus student.',
      requires: 3,
      dueBy: 0.85,
      matches: (e) => e.cyclePhase === 'assess' && e.subjectScope === 'individual' && e.evidenceType === 'reflection',
    },
    {
      id: 'moderation',
      section: PRACTICE.three,
      label: 'Record of moderation',
      detail: 'Signed evidence that a colleague graded the same work against the same criteria.',
      requires: 1,
      dueBy: 0.9,
      matches: (e) => e.cyclePhase === 'assess' && e.selfDesigned === false,
    },
    {
      id: 'reflection',
      section: PRACTICE.four,
      label: 'Reflection on practice',
      detail: 'Your account of what you changed during the sequence, and why.',
      requires: 1,
      dueBy: 0.9,
      matches: (e) => e.cyclePhase === 'reflect',
    },
    {
      id: 'appraisal',
      section: PRACTICE.five,
      label: 'Before-and-after evidence of learning',
      detail: 'Work from the start and the end of the sequence, for the same learners.',
      requires: 2,
      dueBy: 1,
      matches: (e) => e.cyclePhase === 'appraise',
    },
  ],
};
