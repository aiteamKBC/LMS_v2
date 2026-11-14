import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModuleSessionSchedulePreview } from '../createCalendarForm';
import { buildTeamsCalendarInput, emptyTeamsCalendarForm, teamsCalendarOccurrences } from '../createCalendarForm.helpers';

describe('custom module schedule at the Teams boundary', () => {
  it.each([2, 3, 7])('sends all %i weekdays across both weeks in one automatic recurrence', count => {
    const sessions = Array.from({ length: 2 }, (_, week) => Array.from({ length: count }, (_, day) => ({
      date: `2026-09-${String(7 + week * 7 + day).padStart(2, '0')}`, startTime: '09:00', endTime: '11:00',
    }))).flat();
    const row = { catalogueId: 'MOD-CUSTOM', name: 'Custom delivery', sessions, plannedStarts: [], teamsStarts: [], durationMinutes: 120 };
    const input = buildTeamsCalendarInput(row, { ...emptyTeamsCalendarForm(), scheduleTimeZone: 'Europe/London', organizerEmail: 'organizer@example.invalid' });
    expect(input.repeat).toBe('weekly');
    expect(input.seriesMode).toBe('auto');
    expect(input.repeatOccurrences).toBe(count * 2);
    expect(input.scheduledOccurrences).toEqual(sessions.map((session, index) => ({
      sessionNumber: index + 1, startDateTimeUtc: `${session.date}T08:00:00.000Z`, durationMinutes: 120,
    })));
  });

  it('shows Custom and keeps independent per-day times instead of the Group clock', () => {
    const weeklySchedule = [
      { day: 'Monday', startTime: '09:00', endTime: '11:00' },
      { day: 'Thursday', startTime: '18:00', endTime: '19:00' },
    ];
    const row = {
      catalogueId: 'MOD-CUSTOM', scheduleMode: 'custom' as const, weeklySchedule, timeZone: 'Europe/London', name: 'Custom delivery', durationMinutes: 120,
      groupPattern: { name: 'Group default', days: 'Wednesday', startTime: '10:00', endTime: '12:00', durationMinutes: 120 },
      sessions: weeklySchedule.map((slot, index) => ({ ...slot, date: index ? '2026-09-10' : '2026-09-07' })),
      plannedStarts: [] as string[], teamsStarts: [],
    };
    row.plannedStarts = teamsCalendarOccurrences(row).map(session => session.startDateTimeUtc);
    render(<ModuleSessionSchedulePreview row={row} />);
    expect(screen.getByText(/Custom · 2 sessions per week/)).toBeInTheDocument();
    expect(screen.queryByText('Group default')).not.toBeInTheDocument();
    expect(teamsCalendarOccurrences(row).map(session => session.durationMinutes)).toEqual([120, 60]);
  });
});
