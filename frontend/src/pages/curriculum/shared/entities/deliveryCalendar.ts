import type { CurriculumHoliday, DeliveryCalendarPolicy } from '@/lib/curriculumApi';

export const CALENDAR_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const CALENDAR_COUNTRIES = [
  ['GB', 'England (existing default)', ['Saturday', 'Sunday']],
  ['EG', 'Egypt', ['Friday', 'Saturday']],
  ['SA', 'Saudi Arabia', ['Friday', 'Saturday']],
  ['AE', 'United Arab Emirates', ['Saturday', 'Sunday']],
  ['QA', 'Qatar', ['Friday', 'Saturday']],
  ['KW', 'Kuwait', ['Friday', 'Saturday']],
  ['BH', 'Bahrain', ['Friday', 'Saturday']],
  ['OM', 'Oman', ['Friday', 'Saturday']],
  ['US', 'United States (federal holidays)', ['Saturday', 'Sunday']],
  ['CA', 'Canada (national holidays)', ['Saturday', 'Sunday']],
  ['AU', 'Australia (national holidays)', ['Saturday', 'Sunday']],
] as const;

export function calendarPreset(country = 'GB'): DeliveryCalendarPolicy {
  const preset = CALENDAR_COUNTRIES.find(item => item[0] === country) || CALENDAR_COUNTRIES[0];
  return { country: preset[0], weekendDays: [...preset[2]], observePublicHolidays: true, excludedHolidayIds: [], manualHolidays: [] };
}

export function effectiveCalendarHolidays(policy: DeliveryCalendarPolicy | null, rows: CurriculumHoliday[]): CurriculumHoliday[] {
  if (!policy) return rows;
  const excluded = new Set(policy.excludedHolidayIds);
  const unique = new Map<string, CurriculumHoliday>();
  [...rows, ...policy.manualHolidays].forEach(row => {
    if (!excluded.has(String(row.id)) && (policy.observePublicHolidays || row.source === 'authored')) unique.set(String(row.id), row);
  });
  return [...unique.values()];
}

export function calendarSessionClashes(dates: string[], policy: DeliveryCalendarPolicy | null, holidays: CurriculumHoliday[]) {
  const weekends = policy?.weekendDays || calendarPreset().weekendDays;
  return [...new Set(dates)].sort().flatMap(day => {
    const parsed = new Date(`${day}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return [];
    const weekday = CALENDAR_DAYS[(parsed.getUTCDay() + 6) % 7];
    const holiday = holidays.find(row => row.startDate <= day && (row.endDate || row.startDate) >= day);
    const reason = weekends.includes(weekday) ? `${weekday}: weekly rest day` : holiday ? `${holiday.source === 'authored' ? 'Manual closure' : 'Public holiday'}: ${holiday.label}` : '';
    return reason ? [{ date: day, reason }] : [];
  });
}
