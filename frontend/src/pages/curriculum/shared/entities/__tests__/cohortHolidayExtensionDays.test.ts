import { describe, expect, it } from 'vitest';

import { cohortHolidayExtensionDays } from '../model';

/**
 * The read-only screens show a cohort's contracted duration next to a practical
 * end date the holidays have moved, which reads as a contradiction unless the
 * gap is named. This is the derivation those annotations hang off, so it has to
 * be zero whenever there is nothing to explain -- an annotation appearing on a
 * cohort no holiday touched would be worse than none at all.
 */

describe('cohortHolidayExtensionDays', () => {
  it('reports the days between the duration rule and the stored end date', () => {
    expect(cohortHolidayExtensionDays({
      baseEndDate: '2028-01-31',
      practicalEndDate: '2028-03-08',
    })).toBe(37);
  });

  it('is zero when no holiday moved the date', () => {
    expect(cohortHolidayExtensionDays({
      baseEndDate: '2028-01-31',
      practicalEndDate: '2028-01-31',
    })).toBe(0);
  });

  it('falls back to endDate when practicalEndDate is absent', () => {
    // Older readers carry the practical end under the endDate name.
    expect(cohortHolidayExtensionDays({
      baseEndDate: '2028-01-31',
      endDate: '2028-02-07',
    })).toBe(7);
  });

  it('prefers practicalEndDate over endDate when both are present', () => {
    expect(cohortHolidayExtensionDays({
      baseEndDate: '2028-01-31',
      practicalEndDate: '2028-02-07',
      endDate: '2028-01-31',
    })).toBe(7);
  });

  it('is zero when the base end date is missing', () => {
    // A cohort served before baseEndDate existed must not be annotated at all,
    // rather than annotated with a number derived from nothing.
    expect(cohortHolidayExtensionDays({ practicalEndDate: '2028-03-08' })).toBe(0);
  });

  it('is zero when the stored date is earlier than the rule', () => {
    // A hand-set date pulled earlier is not a holiday extension; reporting a
    // negative would render as "+-12 days".
    expect(cohortHolidayExtensionDays({
      baseEndDate: '2028-01-31',
      practicalEndDate: '2028-01-19',
    })).toBe(0);
  });

  it('is zero for unparseable dates rather than NaN', () => {
    expect(cohortHolidayExtensionDays({
      baseEndDate: 'not a date',
      practicalEndDate: '2028-03-08',
    })).toBe(0);
  });

  it('counts a single day', () => {
    expect(cohortHolidayExtensionDays({
      baseEndDate: '2028-01-31',
      practicalEndDate: '2028-02-01',
    })).toBe(1);
  });
});
