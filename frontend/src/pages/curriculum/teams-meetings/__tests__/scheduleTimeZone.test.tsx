import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildTeamsCalendarInput, emptyTeamsCalendarForm, ModuleSessionSchedulePreview, teamsCalendarOccurrences } from '../createCalendarForm';
import { calendarReviewHtml } from '../calendarReview';

const row = {
  catalogueId: 'MOD-ZONE', name: 'Synthetic schedule', durationMinutes: 120,
  plannedStarts: [], teamsStarts: [],
  sessions: ['2026-10-23', '2026-10-26', '2026-10-30'].map(date => ({ date, startTime: '09:00', endTime: '11:00' })),
};

describe('Egypt schedule and England display', () => {
  it('keeps 9 AM in Egypt across both countries clock changes and reviews the exact instants sent', () => {
    const input = buildTeamsCalendarInput(row, { ...emptyTeamsCalendarForm(), organizerEmail: 'organizer@example.invalid' });
    expect(input.scheduleTimeZone).toBe('Africa/Cairo');
    expect(input.scheduledOccurrences?.map(item => item.startDateTimeUtc)).toEqual([
      '2026-10-23T06:00:00.000Z', '2026-10-26T06:00:00.000Z', '2026-10-30T07:00:00.000Z',
    ]);
    const html = calendarReviewHtml(input, 'Africa/Cairo');
    expect(html).toContain('Egypt: Fri, 23 Oct 2026, 09:00 AM');
    expect(html).toContain('England: Fri, 23 Oct 2026, 07:00 AM');
    expect(html).toContain('England: Mon, 26 Oct 2026, 06:00 AM');
    expect(html).toContain('England: Fri, 30 Oct 2026, 07:00 AM');
    expect(input.scheduledOccurrences?.every(item => item.durationMinutes === 120)).toBe(true);
  });

  it('shows each country date when midnight in Egypt is the previous day in England', () => {
    const midnight = { ...row, timeZone: 'Africa/Cairo', sessions: [{ date: '2026-09-18', startTime: '00:30', endTime: '02:30' }] };
    const plannedStarts = teamsCalendarOccurrences(midnight).map(item => item.startDateTimeUtc);
    render(<ModuleSessionSchedulePreview row={{ ...midnight, plannedStarts }} />);
    expect(screen.getByText('Egypt: Fri, 18 Sept 2026, 12:30 AM')).toBeInTheDocument();
    expect(screen.getByText('England: Thu, 17 Sept 2026, 10:30 PM')).toBeInTheDocument();
  });

  it('preserves the stored calendar zone for subsequent updates and other modules', () => {
    const cairo = { ...row, sessions: row.sessions.map(session => ({ ...session, timeZone: 'Africa/Cairo' })) };
    const england = { ...row, sessions: row.sessions.map(session => ({ ...session, timeZone: 'Europe/London' })) };
    expect(teamsCalendarOccurrences(cairo)[0].startDateTimeUtc).toBe('2026-10-23T06:00:00.000Z');
    expect(teamsCalendarOccurrences(england)[0].startDateTimeUtc).toBe('2026-10-23T08:00:00.000Z');
    expect(row.sessions[0].startTime).toBe('09:00');
  });

  it('retains a booked instant and elapsed duration across midnight and clock changes', () => {
    const saved = { ...row, sessions: [{ date: '2026-10-29', startTime: '23:30', endTime: '00:30',
      startDateTimeUtc: '2026-10-29T20:30:00Z', durationMinutes: 120, sessionNumber: 4 }] };
    const input = buildTeamsCalendarInput(saved, { ...emptyTeamsCalendarForm(), organizerEmail: 'organizer@example.invalid' });
    expect(input.scheduledOccurrences).toEqual([{ sessionNumber: 4, startDateTimeUtc: '2026-10-29T20:30:00Z', durationMinutes: 120 }]);
  });
});
