import { afterEach, expect, it, vi } from 'vitest';
import { bookingDateRestrictionMessage, firstAvailableBookingDate, mcmBookingDateRestrictionMessage } from './bookingDates';

afterEach(() => vi.useRealTimers());

it.each(['2026-04', '2026-10', '2027-02', '2028-02', '2026-12'])('uses fixed inclusive MCM boundaries in %s', month => {
  expect(mcmBookingDateRestrictionMessage(`${month}-19`)).toContain('20th');
  expect(mcmBookingDateRestrictionMessage(`${month}-20`)).toBe('');
  expect(mcmBookingDateRestrictionMessage(`${month}-05`)).toBe('');
  expect(mcmBookingDateRestrictionMessage(`${month}-06`)).toContain('20th');
});

it.each(['2026-04-30', '2026-10-31', '2027-02-28', '2028-02-29', '2026-12-31', '2027-01-01'])('includes month ends and the year rollover: %s', day => {
  expect(mcmBookingDateRestrictionMessage(day)).toBe('');
});

it('advances an MCM default to the 20th and retains the default for other reviews', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
  expect(firstAvailableBookingDate('2026-10-06', null, true)).toBe('2026-10-20');
  expect(firstAvailableBookingDate('2026-10-06')).toBe('2026-10-06');
});

it('retains weekend, holiday and past-date restrictions within an MCM window', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T09:00:00Z'));
  const rules = { division: 'england-and-wales' as const, today: '2026-09-12', coveredYears: [2026],
    bankHolidays: [{ date: '2026-09-21', title: 'Synthetic holiday' }] };
  expect(firstAvailableBookingDate('2026-09-19', rules, true)).toBe('2026-09-22');
  expect(bookingDateRestrictionMessage('2026-09-20', rules)).toContain('Sundays');
  expect(bookingDateRestrictionMessage('2026-09-21', rules)).toContain('bank holidays');
  expect(bookingDateRestrictionMessage('2026-09-01', rules)).toContain('passed');
});
