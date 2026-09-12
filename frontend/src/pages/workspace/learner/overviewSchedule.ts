import type { OverviewWeek } from '@/api/learnerOverview';
import type { PlanSession, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

export const UK_TIMEZONE = 'Europe/London';
const inactive = new Set(['cancelled', 'deleted', 'failed', 'superseded', 'completed', 'awaiting-signature']);
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
export type UpcomingItem = { id: string; title: string; date: string; time?: string; type: 'live' | 'coaching' | 'review' | 'assignment' | 'checkpoint';
  status: string; detail?: string; eventKey?: string; subjectId?: string };

export function upcomingItems(schedule: TrainingPlanDashboard | null, deadlines: OverviewWeek['deadlines'], now: number) {
  const today = ukDate(now), time = ukTime(now);
  const items: UpcomingItem[] = [];
  for (const session of schedule?.sessions || []) {
    if (inactive.has(session.status.toLowerCase()) || !(Date.parse(session.start) >= now)) continue;
    items.push({ id: `live:${session.id}`, title: session.title || 'Live session', type: 'live', date: ukDate(session.start), time: ukTime(session.start),
      status: 'Scheduled', subjectId: `current:${session.moduleId}` });
  }
  for (const review of schedule?.reviews || []) {
    if (inactive.has(review.status.toLowerCase())) continue;
    const date = review.scheduledDate || review.targetDate || review.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || date < today) continue;
    const bookedTime = review.scheduledDate ? review.scheduledTime || undefined : undefined;
    if (date === today && bookedTime && bookedTime < time) continue;
    const planned = !review.scheduledDate || review.status === 'not-scheduled';
    items.push({ id: `review:${review.eventKey}`, title: `${review.title}${review.sequence ? ` #${review.sequence}` : ''}`,
      type: review.source === 'progress-review' ? 'review' : 'coaching', date, time: bookedTime,
      status: planned ? 'To book' : review.invited === false ? 'Booking pending' : 'Booked',
      detail: review.coachName || undefined, eventKey: review.eventKey });
  }
  for (const deadline of deadlines) {
    if (deadline.date >= today) items.push({ ...deadline, id: `due:${deadline.id}`, status: 'Due' });
  }
  return [...new Map(items.map(item => [item.id, item])).values()]
    .sort((a, b) => `${a.date}T${a.time || '23:59'}`.localeCompare(`${b.date}T${b.time || '23:59'}`) || a.id.localeCompare(b.id))
    .slice(0, 5);
}
