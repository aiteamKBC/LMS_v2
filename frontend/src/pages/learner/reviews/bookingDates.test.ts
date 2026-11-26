import { afterEach, expect, it, vi } from 'vitest';
import { bookingDateRestrictionMessage, firstAvailableBookingDate } from './bookingDates';

afterEach(() => vi.useRealTimers());

it('returns no suggestion beyond the published calendar horizon', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
  const rules = { division: 'england-and-wales' as const, today: '2026-10-01', coveredYears: [2026], bankHolidays: [] };
  expect(firstAvailableBookingDate('2027-02-28', rules)).toBe('');
  expect(firstAvailableBookingDate('2026-10-01', { ...rules, coveredYears: [] })).toBe('');
});

it('skips weekends and holidays without jumping to the 20th', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
  const rules = { division: 'england-and-wales' as const, today: '2026-10-01', coveredYears: [2026],
    bankHolidays: [{ date: '2026-10-05', title: 'Synthetic holiday' }] };
  expect(firstAvailableBookingDate('2026-10-04', rules)).toBe('2026-10-06');
});

it.each(['2026-04-30', '2026-10-06', '2026-10-19', '2028-02-29', '2026-12-31', '2027-01-04'])('retains an available weekday throughout the month: %s', day => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T09:00:00Z'));
  expect(firstAvailableBookingDate(day)).toBe(day);
});

it('retains an available date before the 20th', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
  expect(firstAvailableBookingDate('2026-10-06')).toBe('2026-10-06');
});

it('retains weekend, holiday and past-date restrictions throughout the month', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T09:00:00Z'));
  const rules = { division: 'england-and-wales' as const, today: '2026-09-12', coveredYears: [2026],
    bankHolidays: [{ date: '2026-09-21', title: 'Synthetic holiday' }] };
  expect(firstAvailableBookingDate('2026-09-19', rules)).toBe('2026-09-22');
  expect(bookingDateRestrictionMessage('2026-09-20', rules)).toContain('Sundays');
  expect(bookingDateRestrictionMessage('2026-09-21', rules)).toContain('bank holidays');
  expect(bookingDateRestrictionMessage('2026-09-01', rules)).toContain('passed');
});
