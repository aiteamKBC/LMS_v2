import { describe, expect, it } from 'vitest';
import { selectLearnerProfileSubtitle } from './learnerProfileSelectors';
import type { CoachLearnerCaseFileData } from '../types/learnerProfile.types';

describe('learner profile selectors', () => {
  it('preserves the current programme, cohort and group subtitle contract', () => {
    const data = { programme: 'Programme A', cohort: 'C1', group: 'G1' } as CoachLearnerCaseFileData;
    expect(selectLearnerProfileSubtitle(data)).toBe('Programme A - Cohort C1 - Group G1');
    expect(selectLearnerProfileSubtitle(null)).toBe('');
  });
});

