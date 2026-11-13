import { SYSTEM_TIME_ZONE } from '@/lib/format';
import { localClockToUtcIso } from '@/lib/timeZones';

export interface DeliveryLiveSession {
  id: string;
  type: string;
  date: string;
  startTime?: string;
  timeZone?: string;
  title?: string;
  status?: string;
  moduleCatalogueId?: string;
  moduleId?: string;
}

const normalise = (value: string | undefined) => String(value ?? '').trim().toLowerCase();

function calendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function deliveryDateLabel(value: string, weekday = false) {
  const date = calendarDate(value);
  return date ? new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short', ...(weekday ? { weekday: 'short' } : { year: 'numeric' }),
  }).format(date) : 'Date unavailable';
}

const businessClockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function deliveryBusinessClock(now: Date) {
  const parts = businessClockFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

function clockMinutes(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return hour * 60 + minute;
}

export function deliverySessionTime(value: string | undefined) {
  const minutes = clockMinutes(value);
  return minutes === null ? 'Time not set' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

type BusinessClock = Pick<DeliveryLiveSession, 'date' | 'startTime' | 'timeZone'> & { instant?: number; timeIssue?: boolean };
// Reuse conversions across chart/week changes, staffing and minute ticks. Weak
// keys release old responses; the signature also guards in-place field updates.
const businessClocks = new WeakMap<DeliveryLiveSession, { signature: string; clock: BusinessClock }>();

function businessSession(session: DeliveryLiveSession) {
  const signature = JSON.stringify([session.date, session.startTime, session.timeZone]);
  const cached = businessClocks.get(session);
  if (cached?.signature === signature) return { ...session, ...cached.clock };
  const zone = String(session.timeZone || SYSTEM_TIME_ZONE).trim() || SYSTEM_TIME_ZONE;
  let clock: BusinessClock = { date: session.date, startTime: session.startTime, timeZone: zone };
  if (calendarDate(session.date)) {
    if (clockMinutes(session.startTime) !== null) {
      try {
        const instant = Date.parse(localClockToUtcIso(`${session.date}T${deliverySessionTime(session.startTime)}`, zone));
        const business = deliveryBusinessClock(new Date(instant));
        clock = { date: business.date, startTime: business.time, timeZone: SYSTEM_TIME_ZONE, instant };
      } catch {
        // Bad/ambiguous zones and DST gaps cannot be labelled as UK instants.
        // Keep the saved row intact and surface a visible scheduling warning.
        clock = { ...clock, startTime: undefined, timeIssue: true };
      }
    } else {
      const ukDayKnown = [SYSTEM_TIME_ZONE, 'GMT Standard Time'].includes(zone);
      clock = { ...clock, startTime: undefined, timeIssue: Boolean(String(session.startTime ?? '').trim()) || !ukDayKnown };
    }
  }
  businessClocks.set(session, { signature, clock });
  return { ...session, ...clock };
}

export function deliveryLiveSessions(sessions: readonly DeliveryLiveSession[]) {
  const seen = new Set<string>();
  return sessions.filter(session => {
    const type = normalise(session.type).replace(/[\s_-]+/g, '');
    if (!['livesession', 'liveteamssession'].includes(type)) return false;
    if (['cancelled', 'canceled', 'superseded', 'deleted'].includes(normalise(session.status))) return false;
    // Only repeated identities are duplicates. Different sessions at the same time remain separate.
    if (session.id && seen.has(session.id)) return false;
    if (session.id) seen.add(session.id);
    return true;
  });
}

export function deliveryWeek(sessions: readonly DeliveryLiveSession[], now: Date, offset = 0) {
  const business = deliveryBusinessClock(now);
  const first = calendarDate(business.date)!;
  first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7 + offset * 7);
  const live = deliveryLiveSessions(sessions).map(businessSession);
  const dated = live.filter(session => calendarDate(session.date) && !session.timeIssue);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    const iso = date.toISOString().slice(0, 10);
    return { date: iso, day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index],
      number: date.getUTCDate(), count: dated.filter(session => session.date === iso).length };
  });
  // This API's completed label is derived from the saved source date, not a
  // persisted completion event. A converted future instant remains upcoming.
  const next = dated.filter(session => session.instant !== undefined
    ? session.instant >= now.getTime() : normalise(session.status) !== 'completed' && session.date >= business.date
  ).sort((a, b) => a.date.localeCompare(b.date) || (a.instant !== undefined && b.instant !== undefined
    ? a.instant - b.instant : (clockMinutes(a.startTime) ?? 1440) - (clockMinutes(b.startTime) ?? 1440)))[0];
  return { days, count: days.reduce((sum, day) => sum + day.count, 0), total: live.length,
    undated: live.filter(session => !calendarDate(session.date)).length,
    invalidTimes: live.filter(session => session.timeIssue).length, next, today: business.date };
}

export function cohortSegments(cohorts: readonly { status?: string }[]) {
  const states = [
    { key: 'active', label: 'Active', color: '#8850d6' },
    { key: 'planned', label: 'Planned', color: '#d7ad60' },
    { key: 'completed', label: 'Completed', color: '#28a28b' },
  ];
  const segments = states.map(state => ({ ...state, value: cohorts.filter(cohort => normalise(cohort.status) === state.key).length }));
  const other = cohorts.length - segments.reduce((sum, segment) => sum + segment.value, 0);
  return other ? [...segments, { key: 'other', label: 'Other', color: '#cfc3de', value: other }] : segments;
}

/** A group's activity follows its assigned catalogue modules, never its editable status. */
export function deliveryActiveGroupIds(
  groups: readonly { id: string; moduleIds?: string[] }[],
  modules: readonly { id: string; moduleCatalogueId?: string; groupId?: string }[],
  activeModuleIds: ReadonlySet<string>,
) {
  const assigned = new Map<string, Set<string>>();
  for (const module of modules) {
    if (!module.groupId) continue;
    const ids = assigned.get(module.groupId) ?? new Set<string>();
    ids.add(module.moduleCatalogueId || module.id);
    assigned.set(module.groupId, ids);
  }
  return new Set(groups.filter(group => [...(group.moduleIds ?? []), ...(assigned.get(group.id) ?? [])]
    .some(id => activeModuleIds.has(id))).map(group => group.id));
}

/** Staffing is a display-only view of the current assignments, never a saved readiness rule. */
export function deliveryStaffing(
  modules: readonly { id: string; moduleCatalogueId?: string; tutor?: string; isFreeCourse?: boolean }[],
  groups: readonly { id?: string; status?: string; coach?: string }[],
  sessions: readonly DeliveryLiveSession[], activeModuleIds: ReadonlySet<string>, today: string,
  activeGroupIds: ReadonlySet<string> | undefined, now: Date,
) {
  const end = calendarDate(today)!;
  end.setUTCDate(end.getUTCDate() + 13);
  const endDate = end.toISOString().slice(0, 10);
  const upcoming = new Set(deliveryLiveSessions(sessions).map(businessSession)
    .filter(session => !session.timeIssue && calendarDate(session.date) && session.date >= today && session.date <= endDate
      && (session.instant !== undefined ? session.instant >= now.getTime() : normalise(session.status) !== 'completed'))
    .map(session => session.moduleCatalogueId || session.moduleId));
  const missing = (value?: string) => ['', 'unassigned', 'not assigned', 'tbc'].includes(normalise(value));
  return {
    needsTutor: modules.filter(module => !module.isFreeCourse && missing(module.tutor)
      && (activeModuleIds.has(module.moduleCatalogueId || module.id) || upcoming.has(module.moduleCatalogueId || module.id))).length,
    needsCoach: groups.filter(group => (activeGroupIds ? activeGroupIds.has(group.id ?? '') : normalise(group.status) === 'active') && missing(group.coach)).length,
  };
}
