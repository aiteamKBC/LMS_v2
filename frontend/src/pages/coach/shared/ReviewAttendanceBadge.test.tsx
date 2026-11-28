import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewAttendanceBadge } from './ReviewAttendanceBadge';
import type { CoachCalendarEvent } from './calendarEvents';

afterEach(cleanup);
const event = (values: Partial<CoachCalendarEvent> = {}): CoachCalendarEvent => ({
  id: 'synthetic', title: 'Review', type: 'review', source: 'mcr', status: 'in-progress', ...values,
});

describe('Coach attendance alongside form status', () => {
  it.each(['curriculum', 'aptem'])('shows a red missed badge without changing %s status', reviewSource => {
    const row = event({ reviewSource, reviewAttendance: 'missed' });
    render(<ReviewAttendanceBadge event={row} />);
    expect(screen.getByText('Learner missed')).toHaveClass('bg-red-50', 'text-red-700');
    expect(row.status).toBe('in-progress');
  });
  it.each([
    ['pending', 'Awaiting attendance report'], ['unavailable', 'Attendance unavailable'], ['attended', 'Learner attended'],
  ] as const)('distinguishes %s from absence', (reviewAttendance, label) => {
    render(<ReviewAttendanceBadge event={event({ reviewAttendance })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText('Learner missed')).not.toBeInTheDocument();
  });
  it.each(['completed', 'awaiting-signature', 'cancelled', 'not-scheduled'] as const)('preserves %s lifecycle', status => {
    const { container } = render(<ReviewAttendanceBadge event={event({ status, reviewAttendance: 'missed' })} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('clears the previous absence when a replacement booking is loaded', () => {
    const { rerender, container } = render(<ReviewAttendanceBadge event={event({ reviewAttendance: 'missed' })} />);
    expect(screen.getByText('Learner missed')).toBeInTheDocument();
    rerender(<ReviewAttendanceBadge event={event({ scheduledDate: '2026-12-01', reviewAttendance: null })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
