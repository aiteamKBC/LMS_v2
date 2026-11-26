import type { MonthlyAssignment } from '@/api/monthlyAssignment';
import { type BookingCalendarRules } from '@/api/learnerCalendar';


export function assignmentDateRestriction(date: string, rules: BookingCalendarRules | null) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return 'Weekend';
  if (!rules || !rules.coveredYears.includes(Number(date.slice(0, 4)))) return 'Holiday calendar unavailable';
  const holiday = rules.bankHolidays.find(item => item.date === date)?.title;
  if (holiday) return holiday;
  return rules.today && date > rules.today ? 'Future dates unavailable' : '';
}


export function assignmentMonthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { min: `${month}-01`, max: `${month}-${days}` };
}


export function shiftAssignmentMonth(month: string, offset: number) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  const [year, number] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, number - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}


export function clampAssignmentCalendarMonth(month: string, latestMonth: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return latestMonth;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(latestMonth) && month > latestMonth) return latestMonth;
  return month;
}


export function assignmentTimeHours(entries: MonthlyAssignment['timeEntries']) {
  return (entries || []).reduce((sum, row) => {
    const hours = Number(row.hours);
    return sum + (Number.isFinite(hours) && hours > 0 ? hours : 0);
  }, 0);
}
