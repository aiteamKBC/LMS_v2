import type { PlanSession } from '@/api/trainingPlanDashboard';

export const UK_TIMEZONE = 'Europe/London';
const cancelled = new Set(['cancelled', 'deleted', 'failed', 'superseded']);
export function ukDate(value: number | string) {
  return Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString('en-CA', { timeZone: UK_TIMEZONE }) : '';
}
export function ukTime(value: number | string) {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: UK_TIMEZONE, hour: '2-digit', minute: '2-digit' });
}
export function dateLabel(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: UK_TIMEZONE });
}
export function weekSessions(sessions: PlanSession[], start: string, end: string, now: number) {
  const matching = [...new Map(sessions.filter(session => !cancelled.has(session.status.toLowerCase())
    && ukDate(session.start) >= start && ukDate(session.start) <= end).map(session => [session.id, session])).values()]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return matching.find(session => Date.parse(session.start) >= now) || matching.at(-1) || null;
}
