import {
  type CoachCalendarEvent,
  eventDisplayDate,
  isCompletedEvent,
  isInProgressEvent,
  isScheduledEvent,
  needsScheduling,
  parseLocalDate,
} from '../shared/calendarEvents';

/** Status buckets shared by the tabs, calendar dots and monthly stats. */
export type MeetingStatusKey = 'not-scheduled' | 'scheduled' | 'in-progress' | 'awaiting-signature' | 'completed';

export const MEETING_STATUS_KEYS: MeetingStatusKey[] = ['not-scheduled', 'scheduled', 'in-progress', 'awaiting-signature', 'completed'];

export const MEETING_STATUS_LABELS: Record<MeetingStatusKey, string> = {
  'not-scheduled': 'Not Scheduled',
  scheduled: 'Scheduled',
  'in-progress': 'In Progress',
  'awaiting-signature': 'Awaiting Signature',
  completed: 'Completed',
};

export interface MeetingStatusColors {
  /** Tinted surface, border and text for tabs and status pills. */
  pill: string;
  /** Selected tab emphasis. */
  active: string;
  /** Count chip inside a tab. */
  count: string;
  /** Calendar markers and pill dots. */
  dot: string;
  /** Stat meter fill. */
  bar: string;
  /** Stat number circle. */
  badge: string;
}

/** The single colour map for every status indicator on the Meetings page. */
export const MEETING_STATUS_COLORS: Record<MeetingStatusKey, MeetingStatusColors> = {
  'not-scheduled': { pill: 'border-rose-200 bg-rose-50 text-rose-700', active: 'border-rose-400 ring-2 ring-rose-200', count: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500', bar: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700' },
  scheduled: { pill: 'border-blue-200 bg-blue-50 text-blue-700', active: 'border-blue-400 ring-2 ring-blue-200', count: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', bar: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700' },
  'in-progress': { pill: 'border-violet-200 bg-violet-50 text-violet-700', active: 'border-violet-400 ring-2 ring-violet-200', count: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500', bar: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700' },
  'awaiting-signature': { pill: 'border-orange-200 bg-orange-50 text-orange-800', active: 'border-orange-400 ring-2 ring-orange-200', count: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', bar: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700' },
  completed: { pill: 'border-emerald-200 bg-emerald-50 text-emerald-700', active: 'border-emerald-400 ring-2 ring-emerald-200', count: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-600', bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' },
};

export function getStatusKey(event: CoachCalendarEvent): MeetingStatusKey | null {
  if (needsScheduling(event)) return 'not-scheduled';
  if (isScheduledEvent(event)) return 'scheduled';
  if (isInProgressEvent(event)) return 'in-progress';
  if (event.status === 'awaiting-signature') return 'awaiting-signature';
  if (isCompletedEvent(event)) return 'completed';
  return null;
}

export function getStatusCounts(events: CoachCalendarEvent[]) {
  const counts: Record<MeetingStatusKey, number> = { 'not-scheduled': 0, scheduled: 0, 'in-progress': 0, 'awaiting-signature': 0, completed: 0 };
  for (const event of events) {
    const key = getStatusKey(event);
    if (key) counts[key] += 1;
  }
  return { total: events.length, ...counts };
}

export function formatMonthYear(value: Date) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(value);
}

function dayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export interface CalendarDay {
  key: string;
  day: number;
  inMonth: boolean;
}

/** Monday-first grid of whole weeks covering the selected month. */
export function getCalendarDays(month: Date): CalendarDay[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const days: CalendarDay[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push({ key: dayKey(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === month.getMonth() });
  }
  return days;
}

/** Distinct meeting statuses per day, keyed by the same display date the list uses. */
export function getCalendarDots(events: CoachCalendarEvent[]) {
  const dots = new Map<string, MeetingStatusKey[]>();
  for (const event of events) {
    const date = parseLocalDate(eventDisplayDate(event));
    const status = getStatusKey(event);
    if (!date || !status) continue;
    const key = dayKey(date);
    const current = dots.get(key) || [];
    if (!current.includes(status)) dots.set(key, [...current, status]);
  }
  return dots;
}

export function todayKey() {
  return dayKey(new Date());
}
