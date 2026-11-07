import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingInstant, bookingToday } from './bookingDates';
import { ukOffsetForDate } from '@/api/learnerCalendar';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe.each(['Europe/London', 'Africa/Cairo', 'America/Los_Angeles'])('UK bookings from %s', zone => {
  it('keeps the same meeting instant and payload offset in summer and winter', () => {
    vi.stubEnv('TZ', zone);
    expect(new Date(bookingInstant('2026-07-01', '09:00')).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(new Date(bookingInstant('2026-12-17', '09:00')).toISOString()).toBe('2026-12-17T09:00:00.000Z');
    expect(ukOffsetForDate('2026-07-01')).toBe(-60);
    expect(ukOffsetForDate('2026-12-17')).toBe(0);
  });
  it('uses the UK date at midnight even when the device is on another day', () => {
    vi.stubEnv('TZ', zone); vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T23:30:00Z'));
    expect(bookingToday()).toBe('2026-07-02');
  });
});

it('uses 23 and 25 hours for personal-calendar ranges spanning UK clock changes', () => {
  expect((bookingInstant('2026-03-30', '00:00') - bookingInstant('2026-03-29', '00:00')) / 3_600_000).toBe(23);
  expect((bookingInstant('2026-10-26', '00:00') - bookingInstant('2026-10-25', '00:00')) / 3_600_000).toBe(25);
});

it('does not offer an invented booking instant in a missing or repeated hour', () => {
  expect(bookingInstant('2026-03-29', '01:30')).toBeNaN();
  expect(bookingInstant('2026-10-25', '01:30')).toBeNaN();
});
