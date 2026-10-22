import type { CurriculumHoliday } from '@/lib/curriculumApi';

const DAY = 86_400_000;
export function dateDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0,10) === value ? instant / DAY : null;
}
export function holidayRange(holiday: CurriculumHoliday) {
  const start = dateDay(holiday.startDate || ''), end = dateDay(holiday.endDate || holiday.startDate || '');
  return start !== null && end !== null && end >= start ? { start, end } : null;
}
export function periodDays(holiday: CurriculumHoliday) {
  const range = holidayRange(holiday);
  return range ? range.end - range.start + 1 : null;
}
/** Merge stored date-only intervals; overlapping closures never double-count a day. */
export function uniqueClosedDays(holidays: CurriculumHoliday[]): number | null {
  const ranges = holidays.map(holidayRange);
  if (ranges.some(range => !range)) return null;
  const sorted = ranges.filter((range): range is NonNullable<typeof range> => Boolean(range)).sort((a,b) => a.start - b.start);
  let total = 0, start: number | null = null, end = 0;
  for (const range of sorted) {
    if (start === null) { start = range.start; end = range.end; }
    else if (range.start <= end + 1) end = Math.max(end, range.end);
    else { total += end - start + 1; start = range.start; end = range.end; }
  }
  return total + (start === null ? 0 : end - start + 1);
}
export type DateStatus = 'upcoming' | 'current' | 'past' | 'unavailable';
export function holidayDateStatus(holiday: CurriculumHoliday, today: string): DateStatus {
  const range = holidayRange(holiday), day = dateDay(today);
  if (!range || day === null) return 'unavailable';
  return range.start > day ? 'upcoming' : range.end < day ? 'past' : 'current';
}
export function holidayMonth(holiday: CurriculumHoliday) { return holidayRange(holiday) ? holiday.startDate.slice(0,7) : 'unavailable'; }
export function monthLabel(month: string) {
  return month === 'unavailable' ? 'Dates unavailable' : new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
}
export function regionLabel(holiday: CurriculumHoliday) {
  if (holiday.source !== 'gov.uk') return '';
  const prefix = String(holiday.id).split(':');
  return prefix.length > 1 && /^[a-z]+(?:-[a-z]+)+$/i.test(prefix[0]) ? prefix[0].replace(/-/g,' ').replace(/^\w/, first => first.toUpperCase()) : '';
}
