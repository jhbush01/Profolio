/**
 * Professional development: the recurring, career-long case.
 *
 * Deliberately simple. It exists now, not later, to keep the registry honest:
 * two templates of genuinely different shape prove a programme is an overlay
 * rather than a rename of the placement checklist.
 */
import type { ProgrammeTemplate } from './types';

export const professionalDevelopment: ProgrammeTemplate = {
  key: 'professional-development',
  name: 'Professional development',
  tagline: 'A year of professional learning, kept as you go.',
  audience: 'Registered teachers maintaining evidence between renewals.',
  defaultWeeks: 52,
  items: [
    {
      id: 'certificates',
      section: 'Completed learning',
      label: 'Certificates of completion',
      detail: 'Courses, workshops and modules you have finished this period.',
      requires: 3,
      dueBy: 1,
      matches: (e) => e.evidenceType === 'qualification',
    },
    {
      id: 'compliance',
      section: 'Completed learning',
      label: 'Current compliance training',
      detail: 'Mandatory training that has to stay in date.',
      requires: 1,
      dueBy: 0.5,
      matches: (e) => e.evidenceType === 'qualification' && e.selfDesigned === false,
    },
    {
      id: 'practice-change',
      section: 'Impact',
      label: 'Evidence of changed practice',
      detail: 'Something from your classroom that shows the learning was applied.',
      requires: 1,
      dueBy: 0.7,
      matches: (e) => e.cyclePhase === 'teach' || e.cyclePhase === 'plan',
    },
    {
      id: 'reflection',
      section: 'Impact',
      label: 'Reflection on professional learning',
      detail: 'Your own account of what changed as a result.',
      requires: 1,
      dueBy: 0.9,
      matches: (e) => e.cyclePhase === 'reflect' || e.evidenceType === 'reflection',
    },
    {
      id: 'impact-evidence',
      section: 'Impact',
      label: 'Evidence of impact on learners',
      detail: 'Data or work samples showing the effect on student learning.',
      requires: 1,
      dueBy: 1,
      matches: (e) => e.cyclePhase === 'appraise' || e.evidenceType === 'assessment-data',
    },
  ],
};
