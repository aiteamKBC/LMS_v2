import { describe, expect, it } from 'vitest';
import { updateProgressSteps } from '../updateProgress';

describe('update progress', () => {
  it('keeps the current stage active and marks completed stages done', () => {
    expect(updateProgressSteps({ stage: 'calendar' }, 2).map(step => step.state)).toEqual([
      'active', 'pending', 'pending',
    ]);
    expect(updateProgressSteps({ stage: 'emails' }, 2).map(step => step.state)).toEqual([
      'done', 'done', 'active',
    ]);
    expect(updateProgressSteps({ stage: 'done' }, 2).map(step => step.state)).toEqual([
      'done', 'done', 'done',
    ]);
  });
});
