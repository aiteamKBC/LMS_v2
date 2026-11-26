import { describe, expect, it } from 'vitest';
import { localClockToUtcIso, ukOffsetForDate } from './timeZones';

describe('event-date time zone rules', () => {
  it.each([
    ['2026-10-24', '08:00', '06:00'],
    ['2026-10-28', '09:00', '06:00'],
    ['2026-10-30', '09:00', '07:00'],
    ['2027-03-29', '08:00', '07:00'],
  ])('converts the same local clock independently for London and Cairo on %s', (day, london, cairo) => {
    expect(localClockToUtcIso(`${day}T09:00`, 'Europe/London')).toBe(`${day}T${london}:00.000Z`);
    expect(localClockToUtcIso(`${day}T09:00`, 'Africa/Cairo')).toBe(`${day}T${cairo}:00.000Z`);
  });

  it.each([
    ['2026-03-29T01:30', 'Europe/London'], ['2026-10-25T01:30', 'Europe/London'],
    ['2026-04-24T00:30', 'Africa/Cairo'], ['2026-10-29T23:30', 'Africa/Cairo'],
  ])('requires a real unambiguous clock for %s in %s', (clock, zone) => {
    expect(() => localClockToUtcIso(clock, zone)).toThrow(/clocks/);
  });

  it('keeps explicit offsets, seconds and milliseconds', () => {
    expect(localClockToUtcIso('2026-10-25T01:30:45.123+01:00', 'Europe/London')).toBe('2026-10-25T00:30:45.123Z');
    expect(localClockToUtcIso('2026-10-25T01:30:45.123+00:00', 'Europe/London')).toBe('2026-10-25T01:30:45.123Z');
    expect(localClockToUtcIso('2026-10-30T09:00:45.123', 'Egypt Standard Time')).toBe('2026-10-30T07:00:45.123Z');
  });

  it.each(['2026-02-30T09:00', '2026-10-30T24:00', 'not a date'])('rejects invalid civil values: %s', value => {
    expect(() => localClockToUtcIso(value, 'Europe/London')).toThrow();
  });

  it('never uses the browser current offset for a different booking date', () => {
    expect(ukOffsetForDate('2026-10-23')).toBe(-60);
    expect(ukOffsetForDate('2026-10-30')).toBe(0);
    expect(ukOffsetForDate('2027-03-29')).toBe(-60);
    expect(() => localClockToUtcIso('2026-10-30T09:00', 'Unknown/Zone')).toThrow();
  });
});
