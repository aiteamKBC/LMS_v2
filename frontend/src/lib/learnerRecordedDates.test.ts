import { describe, expect, it } from 'vitest';
import { learnerRecordedDates } from './learnerRecordedDates';

describe('learner recorded display dates', () => {
  it('uses the learner end even when the delivery end differs by a day', () => {
    const learner = { learnerStartDate: '2025-10-16', learnerEndDate: '2027-02-15',
      programmeStartDate: '2025-10-01', programmeEndDate: '2027-02-14' };
    expect(learnerRecordedDates(learner)).toEqual({ start: '2025-10-16', end: '2027-02-15' });
    expect(learner.programmeEndDate).toBe('2027-02-14');
  });
  it.each([undefined, null, {}, { learnerStartDate: '', learnerEndDate: '   ' }])(
    'leaves missing dates unavailable without inventing a fallback', learner => {
      expect(learnerRecordedDates(learner)).toEqual({ start: null, end: null });
    });
});
