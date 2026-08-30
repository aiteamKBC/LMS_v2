import { describe, expect, it } from 'vitest';
import { isLearnerFlowAccount, isLearnerFlowPath } from '../learnerFlowAccess';

describe('learner flow access', () => {
  it('recognises only the 3 provisioned demo accounts', () => {
    expect(isLearnerFlowAccount('LEARNER-ME@LEARNER.LOCAL')).toBe(true);
    expect(isLearnerFlowAccount(' learner-mm@learner.local ')).toBe(true);
    expect(isLearnerFlowAccount('learner-pcp@learner.local')).toBe(true);
    expect(isLearnerFlowAccount('learner@learner.local')).toBe(false);
  });

  it('rejects the retired 9 cohort-style demo accounts', () => {
    expect(isLearnerFlowAccount('learner-me-l4-jul25@learner.local')).toBe(false);
    expect(isLearnerFlowAccount('learner-mm-l6-oct25@learner.local')).toBe(false);
    expect(isLearnerFlowAccount('learner-pcp-l6-feb26@learner.local')).toBe(false);
  });

  it.each([
    '/learner/materials',
    '/learner/materials/',
    '/learner/component/apprenticeship/82/COMP-1',
    '/learner/video/commercial/42/COMP-2',
    '/learner/quiz/apprenticeship/82/17',
  ])('allows the focused learner path %s', (path) => {
    expect(isLearnerFlowPath(path)).toBe(true);
  });

  it.each([
    '/learner/training-plan/apprenticeship/82',
    '/learner/my-learning',
    '/learner/calendar',
    '/learner/progress',
    '/learner/messages',
    '/workspace/learner',
    '/workspace/learner/apprenticeship/82',
  ])('rejects the additional learner path %s', (path) => {
    expect(isLearnerFlowPath(path)).toBe(false);
  });
});
