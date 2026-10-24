import type { EmployerDashboardMetrics, EmployerLearnerCard } from '@/api/employerPortal';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { reviewCategory } from '@/lib/reviewCategory';

export type Loadable<T> = { status: 'loading' | 'ready' | 'error'; data?: T; error?: string };
export type DashboardReviews = Record<string, Loadable<LearnerCalendarEvent[]>>;
export const learnerKey = (learner: EmployerLearnerCard) => `${learner.kind}:${learner.id}`;
export const learnerHref = (employerId: string, learner: EmployerLearnerCard, tab?: string) =>
  `/employers/${employerId}/learner/${learner.kind}/${learner.id}${tab ? `?tab=${tab}` : ''}`;
export const londonToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(now));
  return hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,';
}

export function reviewDate(event: LearnerCalendarEvent) {
  const value = event.scheduledDate || event.targetDate || event.date;
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function formatReviewDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`)) : 'Not scheduled';
}

export function relativeReviewDate(value: string | null, today: string) {
  if (!value) return 'Date to be confirmed';
  const days = Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 0 ? `In ${days} days` : `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
}

export function reviewState(event: LearnerCalendarEvent) {
  const states = [event.status, event.bookingStatus, event.importedReview?.status].map(value => (value || '').toLowerCase().replace(/[ _]+/g, '-'));
  if (states.some(value => ['cancelled', 'deleted', 'superseded'].includes(value))) return 'cancelled';
  if (event.employerSignatureRequired && !event.employerSigned && states.some(value => ['completed', 'awaiting-signature'].includes(value))) return 'signature';
  if (states.includes('completed')) return 'completed';
  if (states.includes('awaiting-signature')) return 'signatures';
  if (states.includes('in-progress')) return 'in-progress';
  return states.includes('scheduled') ? 'scheduled' : 'planned';
}

export const reviewLabels = { signature: 'Your signature needed', completed: 'Completed', signatures: 'Waiting for signatures', 'in-progress': 'In progress', scheduled: 'Scheduled', planned: 'Planned', cancelled: 'Cancelled' };
export const isOpenReview = (event: LearnerCalendarEvent) => ['planned', 'scheduled', 'in-progress'].includes(reviewState(event));
export function progressReviews(events: LearnerCalendarEvent[]) {
  return events.filter(event => reviewCategory(event) === 'progress-review' && reviewState(event) !== 'cancelled')
    .sort((a, b) => (reviewDate(a) || '9999').localeCompare(reviewDate(b) || '9999') || a.sequence - b.sequence);
}

/** Match the learner's programme order; appointment order still drives Next review. */
export function orderReviewJourney(events: readonly LearnerCalendarEvent[]) {
  return [...events].sort((a, b) => (a.targetDate || '9999-12-31').localeCompare(b.targetDate || '9999-12-31')
    || (a.occurrenceNumber ?? a.sequence) - (b.occurrenceNumber ?? b.sequence));
}

export function nextReview(events: LearnerCalendarEvent[] = []) {
  return events.find(isOpenReview);
}

export function programmePercent(metrics: EmployerDashboardMetrics | undefined, id: string) {
  const programme = metrics?.learners[id]?.programme;
  return programme?.status === 'ready' && programme.percent != null && Number.isFinite(programme.percent)
    ? Math.max(0, Math.min(100, programme.percent)) : null;
}

export const riskLabels = { 'on-track': 'On track', 'need-attention': 'Needs attention', 'at-risk': 'At risk', unavailable: 'Not available' };
export function riskOf(metrics: EmployerDashboardMetrics | undefined, learner: EmployerLearnerCard) {
  return learner.isActive ? metrics?.learners[learner.id]?.risk || 'unavailable' : 'unavailable';
}

export function programmeAverages(learners: EmployerLearnerCard[], metrics?: EmployerDashboardMetrics) {
  const groups = new Map<string, { values: number[]; total: number }>();
  learners.forEach(learner => {
    const name = learner.programme || 'Not assigned';
    const group = groups.get(name) || { values: [], total: 0 };
    const percent = programmePercent(metrics, learner.id);
    if (percent != null) group.values.push(percent);
    group.total++;
    groups.set(name, group);
  });
  return [...groups].map(([name, group]) => ({ name, total: group.total, available: group.values.length,
    percent: group.values.length ? group.values.reduce((sum, value) => sum + value, 0) / group.values.length : null }));
}

export function reviewMatches(events: LearnerCalendarEvent[], filter: string, today: string) {
  if (filter === 'any') return true;
  if (filter === 'signature') return events.some(event => reviewState(event) === 'signature');
  const open = events.filter(isOpenReview);
  if (filter === 'none') return !open.some(event => reviewDate(event));
  return open.some(event => {
    const date = reviewDate(event);
    if (!date) return false;
    if (filter === 'month') return date.slice(0, 7) === today.slice(0, 7);
    if (filter === 'overdue') return date < today;
    const days = (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
    return days >= 0 && days <= 30;
  });
}
