import { describe, expect, it } from 'vitest';
import * as automatic from './learner-log-pro-copy/lib/ukCalendar';
import * as hoursTest from './learner-log-pro-hours-test/lib/ukCalendar';
import { workingRuleFailure } from '@/lib/completionValidation';

describe.each([['automatic', automatic], ['hours test', hoursTest]] as const)('%s journal working hours', (_, calendar) => {
  it('accepts the same early UK activity as the learner completion screen', () => {
    expect(calendar.WORK_DAY_START).toBe('08:00:00');
    expect(calendar.WORK_DAY_END).toBe('17:00:00');
    expect(calendar.workingTimeRange('08:15:00', 0.25)).toEqual({ label: '08:15:00–08:30:00' });
    expect(workingRuleFailure('2026-10-30', '08:30')).toBeNull();
    expect(calendar.workingTimeRange('', 0.5)).toEqual({ label: '08:00:00–08:30:00' });
  });

  it('explains an interval before opening and an interval after closing', () => {
    expect(calendar.workingTimeRange('07:59:59', 0.5)).toEqual({ error: 'The start time cannot be before 08:00:00 UK time.' });
    expect(calendar.workingTimeRange('16:30:00', 0.5)).toEqual({ label: '16:30:00–17:00:00' });
    expect(calendar.workingTimeRange('16:30:00', 1801 / 3600)).toHaveProperty('error');
    expect(calendar.workingTimeRange('17:00:00', 0.5)).toHaveProperty('error');
  });

  it('retains actual-duration validation', () => {
    for (const duration of [0, -1, NaN, Infinity]) expect(calendar.workingTimeRange('08:00:00', duration)).toHaveProperty('error');
  });

  it('preserves UK working dates, holidays and the selected report month', () => {
    expect(calendar.dateRestriction('2026-06-15', '2026-06')).toBeNull();
    expect(calendar.dateRestriction('2026-06-20', '2026-06')).toMatch(/Weekends/);
    expect(calendar.dateRestriction('2026-08-31', '2026-08')).toMatch(/bank holidays/);
    expect(calendar.dateRestriction('2026-06-15', '2026-07')).toMatch(/report month/);
    expect(calendar.monthBounds('2024-02')).toEqual({ min: '2024-02-01', max: '2024-02-29' });
  });
});
