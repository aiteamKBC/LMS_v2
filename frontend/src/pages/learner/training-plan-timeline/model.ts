import type { TrainingPlanDashboard, PlanSession } from '@/api/trainingPlanDashboard';
import type { Subject } from '../my-learning/SubjectWorkspace';

export function dateKey(value: string | null | undefined) {
  if (!value) return '';
  const date = value.slice(0, 10);
  const parsed = Date.parse(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(date) ? date : '';
}
export function weekKey(value: string) {
  const key = dateKey(value);
  if (!key) return '';
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export function sessionDay(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) : '';
}
export function percent(done: number, total: number) { return total > 0 ? Math.min(100, Math.round(done / total * 10000) / 100) : 0; }
export function reviewDate(review: TrainingPlanDashboard['reviews'][number]) { return review.scheduledDate || review.targetDate || review.date || ''; }

export function timelineYears(dates: string[], currentYear: number, selectedYear: number) {
  const years = [currentYear, selectedYear, ...dates.map(dateKey).filter(Boolean).map(date => Number(date.slice(0, 4)))];
  const first = Math.min(...years), last = Math.max(...years);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export function reviewToBook(reviews: TrainingPlanDashboard['reviews']) {
  return reviews.filter(review => review.source === 'progress-review' && review.status === 'not-scheduled' && dateKey(reviewDate(review)))
    .sort((a, b) => reviewDate(a).localeCompare(reviewDate(b)))[0] || null;
}

export function buildPlanModules(subjects: Subject[], data: TrainingPlanDashboard) {
  return subjects.map(subject => {
    const moduleId = data.moduleLinks[subject.id]?.id || (subject.id.startsWith('current:') ? subject.id.slice(8) : null);
    const detail = data.modules.find(module => module.id === moduleId);
    const sessions = data.sessions.filter(session => session.moduleId === moduleId).map(session => {
      const matches = subject.activities.filter(activity => Date.parse(activity.native?.sessionDateTimeUtc || '') === Date.parse(session.start)
        || (activity.category === 'live_session' && activity.schedule.date === sessionDay(session.start)));
      return matches.length === 1 ? { ...session, title: matches[0].title } : session;
    });
    const activityDates = subject.activities.filter(a => !a.schedule.date_needs_review).map(a => dateKey(a.schedule.date)).filter(Boolean);
    const dates = [...new Set([...activityDates, ...sessions.map(session => sessionDay(session.start))])].filter(Boolean).sort();
    const start = dateKey(detail?.start_date) || dates[0] || '';
    const end = dateKey(detail?.end_date) || dates.at(-1) || start;
    const done = subject.activities.filter(activity => activity.completed).length;
    const groupId = subject.id.startsWith('legacy:') ? subject.id.slice(7) : '';
    const actual = data.actual.filter(row => groupId && row.groupId === groupId);
    return { ...subject, moduleId, detail, sessions, dates, start, end,
      weeks: new Set(dates.map(weekKey)).size, done, progress: percent(done, subject.activities.length),
      actual: actual.length ? actual.reduce((sum, row) => sum + row.hours, 0) : null };
  });
}
export type TimelineModule = ReturnType<typeof buildPlanModules>[number];

export function uniquePlanSessions(modules: TimelineModule[]) {
  return [...new Map(modules.flatMap(module => module.sessions).map(session => [session.id, session])).values()];
}

export function monthMetrics(month: string, modules: TimelineModule[], data: TrainingPlanDashboard) {
  const dates = modules.flatMap(module => module.dates).filter(date => date.startsWith(month));
  const weeks = new Set(dates.map(weekKey)).size;
  const planned = data.months[month]?.planned ?? null;
  const actual = data.actualAvailable === false ? null : data.actual.filter(row => row.month === month).reduce((sum, row) => sum + row.hours, 0);
  const explicit = data.months[month]?.weeklyTarget;
  return { planned, actual, remaining: planned === null || actual === null ? null : Math.max(0, planned - actual), weeks,
    weekly: explicit ?? (planned !== null && weeks > 0 ? planned / weeks : null), progress: planned === null || actual === null ? null : percent(actual, planned) };
}

export function nextSession(sessions: PlanSession[], now: number) {
  return sessions.filter(session => !['cancelled', 'deleted', 'completed'].includes(session.status) && Date.parse(session.start) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || null;
}

export function barPosition(start: string, end: string, year: number) {
  const from = Date.UTC(year, 0, 1), to = Date.UTC(year + 1, 0, 1);
  const first = Date.parse(start), last = Date.parse(end) + 86400000;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first >= to || last <= from || last < first) return null;
  // Equal month columns: place dates within their own month's real day count.
  const position = (time: number) => {
    if (time <= from) return 0;
    if (time >= to) return 100;
    const date = new Date(time), month = date.getUTCMonth();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return (month + (date.getUTCDate() - 1) / days) / 12 * 100;
  };
  return { left: position(first), width: position(last) - position(first) };
}
