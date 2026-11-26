import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CoachingMeeting } from '@/api/coachingRecordings';
import MeetingCalendar from './MeetingCalendar';

const meeting = (changes: Partial<CoachingMeeting> = {}): CoachingMeeting => ({
  calendarEventId: 'microsoft-event', coachEmail: 'coach@example.invalid', eventKey: null, candidateEventKeys: [],
  learnerIds: ['learner'], family: null, title: 'Coaching appointment', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z',
  phase: 'ended', match: 'external', media: { state: 'unlinked', recordings: [], readyCount: 0 }, readyToAction: false, ...changes,
});
const defaults = {
  date: '2026-10-20', period: 'month' as const, timeZone: 'UTC', now: Date.parse('2026-10-21T12:00:00Z'),
  coachName: () => 'Selected Coach', learnerName: () => 'Assigned Learner', onSelectDay: vi.fn(),
};

describe('Coach meeting calendar', () => {
  it('keeps a busy month compact with an accessible action to view the full day', () => {
    const select = vi.fn();
    render(<MeetingCalendar {...defaults} onSelectDay={select}
      meetings={Array.from({ length: 20 }, (_, index) => meeting({ calendarEventId: `event-${index}`, title: `Appointment ${index}` }))} />);
    const day = within(screen.getByRole('region', { name: 'Meetings on 2026-10-20' }));
    expect(day.getAllByRole('button', { name: /View Appointment/ })).toHaveLength(3);
    fireEvent.click(day.getByRole('button', { name: '+17 more · View day' }));
    expect(select).toHaveBeenCalledWith('2026-10-20');
  });
  it('places meetings on their actual dates with coach and learner names, including meetings not linked to LMS', () => {
    render(<MeetingCalendar {...defaults} meetings={[meeting(), meeting({ calendarEventId: 'future', title: 'Next meeting',
      startsAt: '2026-10-28T09:00:00Z', endsAt: '2026-10-28T10:00:00Z', phase: 'upcoming' })]} />);
    const past = within(screen.getByRole('region', { name: 'Meetings on 2026-10-20' }));
    expect(past.getByRole('button', { name: 'View Coaching appointment on 2026-10-20' })).toHaveTextContent('Selected Coach');
    expect(past.getByRole('button', { name: 'View Coaching appointment on 2026-10-20' })).toHaveTextContent('Assigned Learner');
    expect(past.getByText('Session match needs review')).toBeInTheDocument();
    expect(past.queryByText('Next meeting')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Meetings on 2026-10-28' })).getByText('Next meeting')).toBeInTheDocument();
  });

  it('uses the selected timezone to place a late UTC meeting on the following local day', () => {
    render(<MeetingCalendar {...defaults} timeZone="Africa/Cairo" meetings={[meeting({ startsAt: '2026-10-20T23:30:00Z', endsAt: '2026-10-21T00:30:00Z' })]} />);
    expect(within(screen.getByRole('region', { name: 'Meetings on 2026-10-20' })).queryByText('Coaching appointment')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Meetings on 2026-10-21' })).getByText('Coaching appointment')).toBeInTheDocument();
  });

  it('continues an overnight meeting onto the next day but treats midnight end as exclusive', () => {
    render(<MeetingCalendar {...defaults} meetings={[
      meeting({ title: 'Ends at midnight', startsAt: '2026-10-20T23:00:00Z', endsAt: '2026-10-21T00:00:00Z' }),
      meeting({ calendarEventId: 'overnight', title: 'Overnight meeting', startsAt: '2026-10-20T23:30:00Z', endsAt: '2026-10-21T00:30:00Z' }),
    ]} />);
    const nextDay = within(screen.getByRole('region', { name: 'Meetings on 2026-10-21' }));
    expect(nextDay.queryByText('Ends at midnight')).not.toBeInTheDocument();
    expect(nextDay.getByRole('button', { name: 'View Overnight meeting on 2026-10-21' })).toHaveTextContent('Continues');
  });

  it('shows the selected week and opens the clicked meeting day', () => {
    const select = vi.fn();
    render(<MeetingCalendar {...defaults} period="week" onSelectDay={select} meetings={[meeting()]} />);
    expect(screen.getByRole('region', { name: 'Meetings on 2026-10-19' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Meetings on 2026-10-25' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Meetings on 2026-10-26' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Coaching appointment on 2026-10-20' }));
    expect(select).toHaveBeenCalledWith('2026-10-20');
  });

  it('keeps cancellation visible and displays only the selected date in day view', () => {
    render(<MeetingCalendar {...defaults} period="day" meetings={[meeting({ phase: 'cancelled' })]} />);
    expect(screen.getByRole('button', { name: 'View Coaching appointment on 2026-10-20' })).toHaveTextContent('Cancelled');
    expect(screen.queryByRole('region', { name: 'Meetings on 2026-10-21' })).not.toBeInTheDocument();
  });

  it('does not describe days outside the loaded month as having no meetings', () => {
    render(<MeetingCalendar {...defaults} meetings={[]} />);
    const outside = within(screen.getByRole('region', { name: 'Meetings on 2026-09-28' }));
    expect(outside.getByText('Select this day to load meetings.')).toBeInTheDocument();
    expect(outside.queryByText('No matching meetings loaded.')).not.toBeInTheDocument();
  });
});
