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
