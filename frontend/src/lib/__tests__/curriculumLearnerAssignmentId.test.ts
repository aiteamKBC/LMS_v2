import { describe, expect, it } from 'vitest';
import { curriculumLearnerAssignmentId } from '../curriculumApi';

describe('curriculum learner assignment identity', () => {
  it('prefers the enrolment bridge over the profile id', () => {
    expect(curriculumLearnerAssignmentId({ id: 1102, enrolmentId: 671 })).toBe('671');
  });

  it('keeps legacy profile rows assignable while the bridge is absent', () => {
    expect(curriculumLearnerAssignmentId({ id: '711' })).toBe('711');
  });
});
