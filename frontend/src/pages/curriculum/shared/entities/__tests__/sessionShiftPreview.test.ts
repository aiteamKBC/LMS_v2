import { describe, expect, it } from 'vitest';
import { buildHolidayShiftPlan, type HolidayShiftSessionLike } from '../sessionShiftPreview';

function session(date: string, skippedHolidays: string[] = []): HolidayShiftSessionLike {
  return { date, skippedHolidays };
}

const holidayLabelFor = (date: string) => (
  date === '2027-02-03' || date === '2027-03-24' ? 'Easter 27' : ''
);

// Reproduces a real module's holiday-shifted series: one early closure (session
// 1), then a run of clean sessions, then a second, unrelated closure (session
// 7) that pushes session 8 out by a week without session 8 itself clashing
// with anything. Before the fix, buildHolidayShiftPlan reconstructed each
// session's "original" date from a flat, sorted pool of every booked date and
// every skipped date in the whole series, read back out by array position —
// so the first closure permanently shifted that position mapping for every
// session after it: session 7 was shown blocked on session 6's date (17
// March, not the 24 March it actually skipped), and session 8 inherited
// session 7's real clash and was shown blocked too, even though its own
// skippedHolidays was empty.
describe('buildHolidayShiftPlan', () => {
  it('attributes a shift only to the session that actually clashed, never to a neighbour', () => {
    const sessions = [
      session('2027-02-10', ['2027-02-03']),
      session('2027-02-17'),
      session('2027-02-24'),
      session('2027-03-03'),
      session('2027-03-10'),
      session('2027-03-17'),
      session('2027-03-31', ['2027-03-24']),
      session('2027-04-07'),
    ];

    const plan = buildHolidayShiftPlan(sessions, holidayLabelFor);

    // Session 6 (index 5): unaffected, dead ordinary session.
    expect(plan.shifts[5]).toMatchObject({
      sessionNumber: 6, moved: false, originalDate: '2027-03-17', actualDate: '2027-03-17',
    });

    // Session 7 (index 6): the one that actually clashed. Its original date is
    // the date it skipped (24 March), not a neighbour's date.
    expect(plan.shifts[6]).toMatchObject({
      sessionNumber: 7, moved: true, originalDate: '2027-03-24', actualDate: '2027-03-31',
    });
    expect(plan.shifts[6].clashes.map(clash => clash.date)).toEqual(['2027-03-24']);

    // Session 8 (index 7): pushed along by session 7's shift, but clashed with
    // nothing itself, so it must not be reported as blocked.
    expect(plan.shifts[7]).toMatchObject({
      sessionNumber: 8, moved: false, originalDate: '2027-04-07', actualDate: '2027-04-07',
    });
    expect(plan.shifts[7].clashes).toEqual([]);

    // Only the two sessions that genuinely clashed count toward the summary.
    expect(plan.movedCount).toBe(2);
    expect(plan.movedRangeLabel).toBe('Sessions 1, 7');
  });
});
