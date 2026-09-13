import type { BookingCalendarRules } from '@/api/learnerCalendar';

export function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function firstAvailableBookingDate(candidate?: string | null, rules?: BookingCalendarRules | null): string {
  const today = isoDate(new Date());
  const selected = new Date(`${candidate && candidate >= today ? candidate : today}T12:00:00`);
  while (selected.getDay() === 0 || selected.getDay() === 6 || rules?.bankHolidays.some(day => day.date === isoDate(selected))) {
    selected.setDate(selected.getDate() + 1);
  }
  return isoDate(selected);
}

export function bookingDateRestrictionMessage(value: string, rules: BookingCalendarRules | null): string {
  if (!value) return '';
  const selected = new Date(`${value}T12:00:00`);
  if (Number.isNaN(selected.getTime())) return 'Choose a valid booking date.';
  if (value < isoDate(new Date())) return 'Sessions cannot be booked on a date that has already passed.';
  if (selected.getDay() === 0 || selected.getDay() === 6) return 'Sessions cannot be booked on Saturdays or Sundays.';
  const holiday = rules?.bankHolidays.find(day => day.date === value);
  if (holiday) return `Sessions cannot be booked on UK bank holidays (${holiday.title}).`;
  if (rules && !rules.coveredYears.includes(selected.getFullYear())) {
    return 'Sessions cannot be booked because the UK bank-holiday calendar is not available for this year.';
  }
  return '';
}
