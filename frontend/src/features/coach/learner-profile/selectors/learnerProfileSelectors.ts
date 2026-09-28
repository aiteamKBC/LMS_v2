import type { CoachLearnerCaseFileData } from '../types/learnerProfile.types';

export function selectLearnerProfileSubtitle(data: CoachLearnerCaseFileData | null) {
  if (!data) return '';
  return [data.programme, data.cohort ? `Cohort ${data.cohort}` : '', data.group ? `Group ${data.group}` : '']
    .filter(Boolean)
    .join(' - ');
}
