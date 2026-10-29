import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoachCalendarEvent } from './calendarEvents';
import { ReviewCompletedDate, ReviewScheduledDate } from './ReviewDates';

afterEach(cleanup);
const review = (fields: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent => ({
  id: 'synthetic-review', title: 'Synthetic review', type: 'review', source: 'progress-review',
  status: 'completed', scheduledDate: '2026-10-26', scheduledTime: '23:00', durationMinutes: 60,
  reviewCompletedAt: '2026-10-27T07:00:00Z', ...fields,
});

describe('Coach review dates', () => {
  it('separates the booked date from completion and identifies the next-day end', () => {
    const event = review();
    render(<><ReviewScheduledDate event={event} /><ReviewCompletedDate event={event} /></>);
    expect(screen.getByText('26 Oct 2026')).toBeVisible();
    expect(screen.getByText('23:00 - 00:00 (+1 day)')).toBeVisible();
    expect(screen.getByText('27 Oct 2026')).toBeVisible();
    expect(screen.queryByText('Dates need review')).toBeNull();
  });

  it('shows completion-before-appointment evidence without altering it', () => {
    const event = review({ reviewCompletedAt: '2026-10-24T10:00:00Z' });
    render(<ReviewCompletedDate event={event} />);
    expect(screen.getByText('24 Oct 2026')).toBeVisible();
    expect(screen.getByText('Dates need review')).toHaveAttribute('tabindex', '0');
    expect(event.reviewCompletedAt).toBe('2026-10-24T10:00:00Z');
  });

  it('uses London calendar days for completion instants during British summer time', () => {
    render(<ReviewCompletedDate event={review({ scheduledDate: '2026-07-01', reviewCompletedAt: '2026-07-01T23:30:00Z' })} />);
    expect(screen.getByText('02 Jul 2026')).toBeVisible();
  });

  it.each([null, 'invalid', '2026-10-27T07:00:00'])('does not invent completion for a missing or ambiguous value: %s', value => {
    render(<ReviewCompletedDate event={review({ reviewCompletedAt: value })} />);
    expect(screen.getByText('Not recorded')).toBeVisible();
  });

  it('does not show a previous completion timestamp on a reopened review', () => {
    render(<ReviewCompletedDate event={review({ status: 'in-progress' })} />);
    expect(screen.getByText('—')).toBeVisible();
  });

  it('does not describe imported source dates as a confirmed appointment', () => {
    render(<ReviewScheduledDate event={review({ reviewSource: 'aptem' })} />);
    expect(screen.getByText('Planned for 26 Oct 2026')).toBeVisible();
    expect(screen.queryByText(/23:00/)).toBeNull();
  });

  it('retains a locally booked imported appointment', () => {
    render(<ReviewScheduledDate event={review({ reviewSource: 'aptem', calendarEventKey: 'imported-review:synthetic' })} />);
    expect(screen.getByText('26 Oct 2026')).toBeVisible();
    expect(screen.getByText('23:00 - 00:00 (+1 day)')).toBeVisible();
  });

  it('shows an unbooked target date and a missing date honestly', () => {
    const { rerender } = render(<ReviewScheduledDate event={review({ status: 'not-scheduled', scheduledDate: null, targetDate: '2026-11-01' })} />);
    expect(screen.getByText('Planned for 01 Nov 2026')).toBeVisible();
    rerender(<ReviewScheduledDate event={review({ status: 'not-scheduled', scheduledDate: null })} />);
    expect(screen.getByText('Not scheduled')).toBeVisible();
  });
});
