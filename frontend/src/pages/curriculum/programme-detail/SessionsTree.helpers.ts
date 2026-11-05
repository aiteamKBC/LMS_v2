import { SYSTEM_TIME_ZONE, systemDateParts } from '@/lib/format';
import type { DeliverySession } from './page';


// --------------------------------------------------------------- date helpers

/** Month bucket for a session, from its best instant. Sessions with no instant
 *  at all collapse into one "Unscheduled" bucket that always sorts last. For a
 *  recording that instant is its week's start date — see `buildSessionTree`. */
export function sessionMonthBucket(dateIso: string): { key: string; label: string; order: number } {
  const trimmed = (dateIso || '').trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = trimmed ? new Date(dateOnly ? `${trimmed.slice(0, 10)}T12:00:00Z` : trimmed) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { key: 'unscheduled', label: 'Unscheduled', order: Number.MAX_SAFE_INTEGER };
  }
  const parts = dateOnly
    ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
    : systemDateParts(date);
  if (!parts) return { key: 'unscheduled', label: 'Unscheduled', order: Number.MAX_SAFE_INTEGER };
  const year = parts.year;
  const month = parts.month - 1;
  const label = date.toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: dateOnly ? 'UTC' : SYSTEM_TIME_ZONE,
  });
  return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label, order: year * 12 + month };
}


// ------------------------------------------------------------------- tree model

export interface WeekGroup {
  key: string;
  week: number;
  weekTitle: string;
  weekStartDate: string;
  sessions: DeliverySession[];
}

export interface MonthGroup {
  key: string;
  label: string;
  order: number;
  weeks: WeekGroup[];
  count: number;
}

export interface ModuleGroup {
  key: string;
  module: string;
  count: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  missing: number;
  months: MonthGroup[];
}


export function statusClass(status: string): 'scheduled' | 'completed' | 'cancelled' | 'missing' | 'other' {
  const value = status.toLowerCase();
  if (value === 'completed') return 'completed';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  if (value === 'scheduled') return 'scheduled';
  if (value === 'not-created') return 'missing';
  return 'other';
}


/** Group flat sessions into the Module → Month → Week tree, preserving the
 *  programme's module order and sorting months/weeks/sessions chronologically. */
export function buildSessionTree(sessions: DeliverySession[]): ModuleGroup[] {
  const modules = new Map<string, ModuleGroup>();
  for (const session of sessions) {
    const moduleName = session.module || 'Unassigned module';
    let moduleGroup = modules.get(moduleName);
    if (!moduleGroup) {
      moduleGroup = { key: moduleName, module: moduleName, count: 0, scheduled: 0, completed: 0, cancelled: 0, missing: 0, months: [] };
      modules.set(moduleName, moduleGroup);
    }
    moduleGroup.count += 1;
    const bucketClass = statusClass(session.status);
    if (bucketClass === 'completed') moduleGroup.completed += 1;
    else if (bucketClass === 'cancelled') moduleGroup.cancelled += 1;
    else if (bucketClass === 'scheduled') moduleGroup.scheduled += 1;
    else if (bucketClass === 'missing') moduleGroup.missing += 1;

    // A recording has no date of its own — it is authored into a week, not
    // onto a day — so its place in the calendar is that week's first teaching
    // date. A live session is the opposite: its own date *is* the schedule, so
    // an undated one stays in Unscheduled, where the empty month is a real gap
    // — except a "no meeting yet" placeholder, which has no schedule to lose but
    // does belong to a real week, and sorting it into Unscheduled would scatter
    // the very gaps this view exists to surface away from the week they're in.
    const bucketDateIso = session.dateIso || (session.kind === 'recorded' || session.status === 'not-created' ? session.weekStartDate : '');
    const bucket = sessionMonthBucket(bucketDateIso);
    let monthGroup = moduleGroup.months.find(item => item.key === bucket.key);
    if (!monthGroup) {
      monthGroup = { key: bucket.key, label: bucket.label, order: bucket.order, weeks: [], count: 0 };
      moduleGroup.months.push(monthGroup);
    }
    monthGroup.count += 1;
    const weekKey = String(session.week);
    let weekGroup = monthGroup.weeks.find(item => item.key === weekKey);
    if (!weekGroup) {
      weekGroup = { key: weekKey, week: session.week, weekTitle: session.weekTitle, weekStartDate: session.weekStartDate, sessions: [] };
      monthGroup.weeks.push(weekGroup);
    }
    weekGroup.sessions.push(session);
  }

  for (const moduleGroup of modules.values()) {
    moduleGroup.months.sort((a, b) => a.order - b.order);
    for (const monthGroup of moduleGroup.months) {
      monthGroup.weeks.sort((a, b) => a.week - b.week);
      for (const weekGroup of monthGroup.weeks) {
        weekGroup.sessions.sort((a, b) => (a.dateIso || '').localeCompare(b.dateIso || '') || a.title.localeCompare(b.title));
      }
    }
  }
  return [...modules.values()];
}
