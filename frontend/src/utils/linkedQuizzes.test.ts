import { describe, expect, it } from 'vitest';
import { splitLinkedQuizWeek } from './linkedQuizzes';

describe('splitLinkedQuizWeek', () => {
  it('separates a four-digit trailing date from the week label', () => {
    expect(splitLinkedQuizWeek('L1 - Definitions and Measurement 3/3/2026')).toEqual({
      label: 'L1 - Definitions and Measurement',
      date: '3/3/2026',
    });
  });

  it('supports the two-digit year used by older plans', () => {
    expect(splitLinkedQuizWeek('L4 - Data to Decisions 24/3/26')).toEqual({
      label: 'L4 - Data to Decisions',
      date: '24/3/26',
    });
  });

  it('keeps labels without a trailing date unchanged', () => {
    expect(splitLinkedQuizWeek('Week 5 - Customer Insight')).toEqual({
      label: 'Week 5 - Customer Insight',
      date: null,
    });
  });
});
