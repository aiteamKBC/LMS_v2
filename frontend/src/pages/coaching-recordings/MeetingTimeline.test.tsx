import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CoachingMeeting } from '@/api/coachingRecordings';
import MeetingTimeline from './MeetingTimeline';

const row = (index: number, coach = index): CoachingMeeting => ({
  coachEmail: `coach-${coach}@example.invalid`, calendarEventId: `event-${index}`, eventKey: null, candidateEventKeys: [],
  learnerIds: [], title: `Original meeting ${index}`, family: null, startsAt: '2026-10-22T09:00:00Z', endsAt: '2026-10-22T10:00:00Z',
  phase: 'ended', match: 'external', readyToAction: true, media: { state: 'ready', readyCount: 1, recordings: [] },
});
const props = { start: '2026-10-22', end: '2026-10-22', timeZone: 'UTC', now: Date.parse('2026-10-23T12:00:00Z'),
  coachName: (email: string) => `Coach ${email.split('@')[0].split('-')[1]}`, learnerName: () => 'Assigned learner', onSelect: vi.fn() };

describe('Busy coach timeline', () => {
  it('shows recording availability on a short appointment as well as in its details', () => {
    render(<MeetingTimeline {...props} meetings={[{ ...row(0), endsAt: '2026-10-22T09:30:00Z' }]} />);
    const card = screen.getByRole('button', { name: 'View Original meeting 0 on 2026-10-22' });
    expect(within(card).getByText('Recording available')).not.toHaveClass('sr-only');
  });
  it('keeps 23 simultaneous calendars in named coach lanes with local paging and intact occurrence identities', () => {
    const meetings = Array.from({ length: 23 }, (_, index) => row(index));
    const select = vi.fn();
    render(<MeetingTimeline {...props} meetings={meetings} onSelect={select} />);
    expect(screen.getByText(/Coaches 1–4 of 23/)).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Previous coaches' })).toBeDisabled();
    const seen: string[] = [];
    for (let page = 0; page < 6; page++) {
      for (const article of screen.getAllByRole('article')) {
        const button = within(article).getByRole('button');
        seen.push(button.getAttribute('aria-label')!);
        fireEvent.click(button);
      }
      if (page < 5) fireEvent.click(screen.getByRole('button', { name: 'Next coaches' }));
    }
    expect(new Set(seen).size).toBe(23);
    expect(select.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(meetings));
    expect(screen.getByRole('button', { name: 'Next coaches' })).toBeDisabled();
    expect(screen.getByText(/Coaches 21–23 of 23/)).toBeInTheDocument();
  });

  it('retains same-title invitations in separate coach calendars and packs only same-coach conflicts together', () => {
    const first = row(0), second = { ...row(1), title: first.title }, conflict = row(2, 0);
    render(<MeetingTimeline {...props} meetings={[first, second, conflict]} />);
    const coach = screen.getByRole('region', { name: 'Meetings for Coach 0 on 2026-10-22' });
    expect(within(coach).getAllByRole('article')).toHaveLength(2);
    const other = screen.getByRole('region', { name: 'Meetings for Coach 1 on 2026-10-22' });
    expect(within(other).getAllByRole('article')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'View Original meeting 0 on 2026-10-22' })).toHaveLength(2);
  });

  it('returns to the first coach page when a date or coach filter changes', () => {
    const meetings = Array.from({ length: 9 }, (_, index) => row(index));
    const view = render(<MeetingTimeline {...props} meetings={meetings} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next coaches' }));
    expect(screen.getByText(/Coaches 5–8 of 9/)).toBeInTheDocument();
    view.rerender(<MeetingTimeline {...props} meetings={meetings.slice(0, 6)} />);
    expect(screen.getByText(/Coaches 1–4 of 6/)).toBeInTheDocument();
    view.rerender(<MeetingTimeline {...props} meetings={meetings.slice(0, 1)} />);
    expect(screen.queryByRole('button', { name: 'Next coaches' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Meetings on 2026-10-22' })).toBeInTheDocument();
  });
});
