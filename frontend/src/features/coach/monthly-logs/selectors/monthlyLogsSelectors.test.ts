import { describe, expect, it } from 'vitest';
import { filterCoachMonthlyLogLearners } from './monthlyLogsSelectors';

describe('Coach Monthly Logs selectors', () => {
  it('keeps the existing case-insensitive name and programme search', () => {
    const learners = [
      { id: 1, name: 'Example Learner', programme: 'Data Technician' },
      { id: 2, name: 'Second Learner', programme: 'Marketing' },
    ];
    expect(filterCoachMonthlyLogLearners(learners, 'DATA')).toEqual([learners[0]]);
  });
});
