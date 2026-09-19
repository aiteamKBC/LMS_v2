import { beforeEach, describe, expect, it, vi } from 'vitest';

const coachFetch = vi.fn();

vi.mock('@/lib/coachFetch', () => ({ coachFetch }));

const booking = {
  learnerId: '101',
  sessionType: 'catch-up',
  scheduledDate: '2099-01-01',
  scheduledTime: '10:00',
  durationMinutes: 60,
  timezoneOffsetMinutes: 0,
  notes: 'Support',
};

describe('Coach calendar booking idempotency', () => {
  beforeEach(() => {
    coachFetch.mockReset();
    coachFetch.mockResolvedValue(new Response(JSON.stringify({ event: { eventKey: 'event-1' } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('derives the same key for the same logical booking', async () => {
    const { calendarBookingIdempotencyKey } = await import('./calendarEvents');
    await expect(calendarBookingIdempotencyKey(booking)).resolves.toBe(
      await calendarBookingIdempotencyKey({ ...booking }),
    );
  });

  it('centralizes the Idempotency-Key header on booking requests', async () => {
    const { bookCoachCalendarEvent } = await import('./calendarEvents');

    await bookCoachCalendarEvent(booking);
    await bookCoachCalendarEvent({ ...booking });

    const firstHeaders = new Headers(coachFetch.mock.calls[0][1].headers);
    const secondHeaders = new Headers(coachFetch.mock.calls[1][1].headers);
    expect(firstHeaders.get('Idempotency-Key')).toMatch(/^coach-book:/);
    expect(secondHeaders.get('Idempotency-Key')).toBe(firstHeaders.get('Idempotency-Key'));
  });

  it('uses a different key when a logical booking field changes', async () => {
    const { calendarBookingIdempotencyKey } = await import('./calendarEvents');

    const first = await calendarBookingIdempotencyKey(booking);
    const second = await calendarBookingIdempotencyKey({ ...booking, scheduledTime: '11:00' });

    expect(second).not.toBe(first);
  });
});

describe('Coach calendar time labels', () => {
  it('renders a booked meeting as a start and end time', async () => {
    const { formatTimeRangeLabel } = await import('./calendarEvents');
    expect(formatTimeRangeLabel({ scheduledTime: '23:30', durationMinutes: 60 } as never)).toBe('23:30 - 00:30');
  });
});

describe('Coach calendar status and month boundaries', () => {
  it('treats only completed as completed while retaining legacy confirmed as a distinct status', async () => {
    const { isCompletedEvent } = await import('./calendarEvents');
    expect(isCompletedEvent({ status: 'completed' } as never)).toBe(true);
    expect(isCompletedEvent({ status: 'confirmed' } as never)).toBe(false);
  });

  it.each([
    ['start of month', '2026-09-01', true],
    ['end of month', '2026-09-30', true],
    ['start of next month', '2026-10-01', false],
  ])('handles %s without crossing the selected month', async (_label, date, expected) => {
    const { isEventInMonth } = await import('./calendarEvents');
    expect(isEventInMonth({ date } as never, new Date('2026-09-15T12:00:00'))).toBe(expected);
  });

  it('keeps due and overdue boundaries on the calendar date', async () => {
    const { isAtRiskEvent, isDueSoonEvent } = await import('./calendarEvents');
    const dueToday = { status: 'not-scheduled', targetDate: '2026-09-14' } as never;
    expect(isAtRiskEvent(dueToday, new Date('2026-09-14T23:59:59'))).toBe(false);
    expect(isAtRiskEvent(dueToday, new Date('2026-09-15T00:00:00'))).toBe(true);
    expect(isDueSoonEvent({ status: 'not-scheduled', targetDate: '2026-09-28' } as never, new Date('2026-09-14T00:00:00'))).toBe(true);
    expect(isDueSoonEvent({ status: 'not-scheduled', targetDate: '2026-09-29' } as never, new Date('2026-09-14T00:00:00'))).toBe(false);
  });

  it('allows Join only for a link-backed meeting on or before today', async () => {
    const { canJoinMeeting } = await import('./calendarEvents');
    const now = new Date('2026-09-14T10:00:00');
    expect(canJoinMeeting({ status: 'scheduled', scheduledDate: '2026-09-20', meetingLink: 'https://teams.test/future' } as never, now)).toBe(false);
    expect(canJoinMeeting({ status: 'scheduled', scheduledDate: '2026-09-14', meetingLink: 'https://teams.test/today' } as never, now)).toBe(true);
    expect(canJoinMeeting({ status: 'completed', scheduledDate: '2026-09-14', meetingLink: 'https://teams.test/completed' } as never, now)).toBe(false);
  });
});
