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
    // Egypt is named here rather than inherited: the form's default is England,
    // and this case exists for the Egyptian clock specifically.
    const input = buildTeamsCalendarInput(row, { ...emptyTeamsCalendarForm(), scheduleTimeZone: 'Africa/Cairo', organizerEmail: 'organizer@example.invalid' });
    expect(input.scheduleTimeZone).toBe('Africa/Cairo');
    expect(input.scheduledOccurrences?.map(item => item.startDateTimeUtc)).toEqual([
      '2026-10-23T06:00:00.000Z', '2026-10-26T06:00:00.000Z', '2026-10-30T07:00:00.000Z',
    ]);
    const html = calendarReviewHtml(input, 'Africa/Cairo');
    // Said once for the table, and again only on 26 October, where England's
    // clocks have gone back but Egypt's have not.
    expect(html).toContain('Every session is Egypt 09:00 AM · England 07:00 AM');
    expect(html).toContain('those sessions say so');
    expect(html.match(/Egypt 09:00 AM · England 06:00 AM/g)).toHaveLength(1);
    expect(html).not.toContain('Egypt: Fri, 23 Oct 2026, 09:00 AM');
    expect(input.scheduledOccurrences?.every(item => item.durationMinutes === 120)).toBe(true);
  });

  it('shows each country date when midnight in Egypt is the previous day in England', () => {
    const midnight = { ...row, timeZone: 'Africa/Cairo', sessions: [{ date: '2026-09-18', startTime: '00:30', endTime: '02:30' }] };
    const plannedStarts = teamsCalendarOccurrences(midnight).map(item => item.startDateTimeUtc);
    render(<ModuleSessionSchedulePreview row={{ ...midnight, plannedStarts }} />);
    // Said once for the list, not repeated per row. The previous English day is
    // the point: a 12:30 AM session in Egypt is the evening before in England.
    expect(screen.getByRole('note', { name: 'Session start times in Egypt and England' }))
      .toHaveTextContent('Egypt: 12:30 AM · England: 10:30 PM (previous day)');
    expect(screen.queryByText(/Egypt: Fri, 18 Sept/)).not.toBeInTheDocument();
  });

  it('repeats the clock pair only on a session a clock change moves off it', () => {
    // 23, 26 and 30 October in Egypt: England is 07:00, then 06:00 once its
    // clocks go back, then 07:00 again once Egypt's do. Only the middle
    // session differs from the pair stated for the list.
    const schedule = { ...row, timeZone: 'Africa/Cairo' };
    const plannedStarts = teamsCalendarOccurrences(schedule).map(item => item.startDateTimeUtc);
    render(<ModuleSessionSchedulePreview row={{ ...schedule, plannedStarts }} />);
    expect(screen.getByRole('note', { name: 'Session start times in Egypt and England' }))
      .toHaveTextContent('Egypt: 9:00 AM · England: 7:00 AM');
    expect(screen.getAllByText('Egypt: 9:00 AM · England: 6:00 AM')).toHaveLength(1);
    expect(screen.queryAllByText('Egypt: 9:00 AM · England: 7:00 AM')).toHaveLength(1);
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

  it('states just the soonest clock pair in the badge, not every DST-driven pairing', () => {
    const schedule = { ...row, timeZone: 'Africa/Cairo' };
    const plannedStarts = teamsCalendarOccurrences(schedule).map(item => item.startDateTimeUtc);
    render(<ModuleSessionSchedulePreview row={{ ...schedule, plannedStarts }} showAlternateTimeZones={false} />);
    const badge = screen.getByRole('note', { name: 'Session start times in Egypt and England' });
    expect(badge.children).toHaveLength(1);
    expect(screen.getAllByText('Egypt: 9:00 AM · England: 7:00 AM')).toHaveLength(1);
    expect(screen.queryByText('Egypt: 9:00 AM · England: 6:00 AM')).not.toBeInTheDocument();
    expect(screen.getByText(/England changes between BST and GMT/)).toBeInTheDocument();
    expect(badge.parentElement).toHaveTextContent('3 sessions');
    expect(badge.parentElement).toHaveTextContent('120 min each');
    expect(screen.queryByText(/Egypt:.*Oct/)).not.toBeInTheDocument();
    expect(teamsCalendarOccurrences(schedule).map(item => item.startDateTimeUtc)).toEqual(plannedStarts);
  });

  it('identifies the previous England day in a compact midnight badge', () => {
    const midnight = { ...row, timeZone: 'Africa/Cairo', sessions: [{ date: '2026-09-18', startTime: '00:30', endTime: '02:30' }] };
    const plannedStarts = teamsCalendarOccurrences(midnight).map(item => item.startDateTimeUtc);
    render(<ModuleSessionSchedulePreview row={{ ...midnight, plannedStarts }} showAlternateTimeZones={false} />);
    expect(screen.getByRole('note', { name: 'Session start times in Egypt and England' }))
      .toHaveTextContent('Egypt: 12:30 AM · England: 10:30 PM (previous day)');
  });
});
