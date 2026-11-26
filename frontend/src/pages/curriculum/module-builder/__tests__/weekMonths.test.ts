import { describe, expect, it } from 'vitest';
import { groupWeeksByMonth, type ModuleWeek } from '../moduleAuthoringData';

/**
 * A module is authored week by week but delivered — and reported on — by month.
 * A six-week module that crosses a closed Christmas is really "one week in
 * December, five in January", and the week list has to be able to say so, so the
 * split follows each week's own session date rather than counting four weeks to
 * a month.
 */
function week(number: number, sessionDate?: string): ModuleWeek {
  return {
    id: `WEEK-${number}`,
    moduleId: 'MOD-1',
    weekNumber: number,
    title: `Week ${number}`,
    summary: '',
    learningOutcomes: [],
    components: [],
    ksbMappings: [],
    sessionDate,
  };
}

describe('grouping a module’s weeks into months', () => {
  it('splits where the module actually crosses into the next month', () => {
    // The dates a Saturday module lands on once 19 and 26 December are closed.
    const groups = groupWeeksByMonth([
      week(1, '2026-12-12'),
      week(2, '2027-01-02'),
      week(3, '2027-01-09'),
      week(4, '2027-01-16'),
      week(5, '2027-01-23'),
      week(6, '2027-01-30'),
    ]);

    expect(groups.map(group => group.label)).toEqual(['December 2026', 'January 2027']);
    expect(groups.map(group => group.weeks.length)).toEqual([1, 5]);
    expect(groups[1].weeks[0].weekNumber).toBe(2);
  });

  it('says nothing at all when the module has no dates yet', () => {
    // A single "Not scheduled yet" heading over the whole list tells a reader
    // nothing they cannot already see.
    expect(groupWeeksByMonth([week(1), week(2)])).toEqual([]);
  });

  it('keeps an undated week with the run it follows', () => {
    const groups = groupWeeksByMonth([week(1, '2027-01-09'), week(2), week(3, '2027-02-06')]);

    expect(groups.map(group => group.label)).toEqual(['January 2027', 'February 2027']);
    expect(groups[0].weeks.map(item => item.weekNumber)).toEqual([1, 2]);
  });

  it('never reorders the weeks to merge a month it has already left', () => {
    // Dates are generated in order, so a month that comes back is bad data —
    // and re-filing week 3 under the first heading would move it up the list.
    const groups = groupWeeksByMonth([week(1, '2027-01-09'), week(2, '2027-02-06'), week(3, '2027-01-23')]);

    expect(groups.map(group => group.weeks.map(item => item.weekNumber))).toEqual([[1], [2], [3]]);
  });
});
