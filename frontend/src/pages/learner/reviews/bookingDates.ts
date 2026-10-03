import type { BookingCalendarRules } from '@/api/learnerCalendar';

export function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Local noon of a strict `YYYY-MM-DD` calendar day, or null. A date input can
 * report values such as `20261-10-05` (a five-digit year typed into Chrome's
 * year field), which `new Date()` cannot parse; callers must not turn those
 * into instants. */
export function parseBookingDay(value?: string | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const selected = new Date(year, month - 1, day, 12, 0, 0);
  return selected.getFullYear() === year && selected.getMonth() === month - 1 && selected.getDate() === day ? selected : null;
}

export function firstAvailableBookingDate(candidate?: string | null, rules?: BookingCalendarRules | null): string {
  const today = isoDate(new Date());
  const valid = parseBookingDay(candidate) ? candidate! : '';
  const selected = new Date(`${valid && valid >= today ? valid : today}T12:00:00`);
  while (selected.getDay() === 0 || selected.getDay() === 6 || rules?.bankHolidays?.some(day => day.date === isoDate(selected))) {
    selected.setDate(selected.getDate() + 1);
  }
  return isoDate(selected);
}

export function bookingDateRestrictionMessage(value: string, rules: BookingCalendarRules | null): string {
  if (!value) return '';
  const selected = parseBookingDay(value);
  if (!selected) return 'Choose a valid booking date.';
  if (value < isoDate(new Date())) return 'Sessions cannot be booked on a date that has already passed.';
  if (selected.getDay() === 0 || selected.getDay() === 6) return 'Sessions cannot be booked on Saturdays or Sundays.';
  const holiday = rules?.bankHolidays?.find(day => day.date === value);
  if (holiday) return `Sessions cannot be booked on UK bank holidays (${holiday.title}).`;
  if (rules && !(rules.coveredYears || []).includes(selected.getFullYear())) {
    return 'Sessions cannot be booked because the UK bank-holiday calendar is not available for this year.';
  }
  return '';
}
