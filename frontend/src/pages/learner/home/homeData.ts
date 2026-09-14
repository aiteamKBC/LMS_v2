import type { OverviewWeek } from '@/api/learnerOverview';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

export const homeActions = [
  { title: 'Monthly Submission', text: 'Submit your work and keep on track', href: '/learner/monthly-submission', icon: 'file' },
  { title: 'Dashboard', text: 'View your progress, grades and targets', href: '/workspace/learner/dashboard', icon: 'chart' },
  { title: 'Attend or Report Absence', text: 'Let us know your attendance status', href: '/learner/attendance', icon: 'calendar' },
  { title: 'Book for Monthly Coaching Session', text: 'Schedule your 1:1 with your coach', href: '/learner/monthly-coaching', icon: 'people' },
] as const;

export interface HomeEvent {
  id: string; kind: 'lecture' | 'assignment' | 'review'; title: string;
  date: string | null; detail: string; href: string;
}
type DatedHomeEvent = HomeEvent & { date: string; time?: string };
const inactive = new Set(['cancelled', 'canceled', 'completed', 'deleted', 'failed', 'superseded', 'awaiting-signature']);

/** One nearest event per category, in lecture / assignment / review order. */
export function upcomingEvents(schedule?: TrainingPlanDashboard | null, week?: OverviewWeek | null, now = new Date()): HomeEvent[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const events: DatedHomeEvent[] = [
    ...(schedule?.sessions ?? []).filter(item => !inactive.has(item.status.trim().toLowerCase())).map(item => ({
      id: `session-${item.id}`, kind: 'lecture' as const, title: item.title, date: item.start, detail: 'Learning session', href: '/learner/attendance' })),
    ...(week?.deadlines ?? []).filter(item => item.type === 'assignment').map(item => ({
      id: `deadline-${item.id}`, kind: 'assignment' as const, title: item.title, date: item.date,
      detail: 'Assignment due', href: '/learner/monthly-submission' })),
    ...(schedule?.reviews ?? []).filter(item => item.source === 'progress-review' && !inactive.has(item.status.trim().toLowerCase())).map(item => ({
      id: `review-${item.id}`, title: item.title, date: item.scheduledDate || item.targetDate || item.date || '',
      kind: 'review' as const, time: item.scheduledDate ? item.scheduledTime || undefined : undefined,
      detail: item.scheduledDate ? 'Progress review' : 'Review to be booked', href: '/learner/calendar' })),
  ];
  const upcoming = events.filter(item => item.date && Number.isFinite(Date.parse(item.date))
    && (/^\d{4}-\d{2}-\d{2}$/.test(item.date)
      ? item.date > today || item.date === today && (!item.time || item.time.slice(0, 5) >= time)
      : Date.parse(item.date) >= now.getTime()))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)
      || (a.time || '23:59').localeCompare(b.time || '23:59') || a.id.localeCompare(b.id));
  const slots: HomeEvent[] = [
    { id: 'next-lecture', kind: 'lecture', title: 'Next lecture', date: null, detail: 'No upcoming lecture scheduled', href: '/learner/attendance' },
    { id: 'next-assignment', kind: 'assignment', title: 'Next assignment', date: null, detail: 'No upcoming assignment due', href: '/learner/monthly-submission' },
    { id: 'next-review', kind: 'review', title: 'Next review', date: null, detail: 'No upcoming review scheduled', href: '/learner/calendar' },
  ];
  return slots.map(slot => upcoming.find(event => event.kind === slot.kind) || slot);
}

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(now));
  return hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,';
}
