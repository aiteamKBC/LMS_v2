import type { Subject, SubjectEntry, CoverMetadata } from './SubjectWorkspace';
import type { PlanModule, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { LearnerDetail } from '@/api/learnerDetail';
import { learnerHeaderPlan } from '@/pages/workspace/learner/learnerHeaderPlan';
import { dateKey, weekKey } from '@/pages/learner/training-plan-timeline/model';
import { hasComponentContent } from '@/utils/learnerJourney';

export type LearningWeek = { id: string; label: string; title: string; start: string | null; end: string | null; activities: SubjectEntry[] };
export const learningToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export const learningDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const subjectPercent = (subject: Subject) => subject.activities.length ? Math.round(subject.activities.filter(a => a.completed).length / subject.activities.length * 10000) / 100 : 0;

/** The delivery date identifies its Monday–Sunday week when the API omits the range. */
function activityWeekRange(entry: SubjectEntry) {
  const start = dateKey(entry.schedule.week_start) || weekKey(entry.schedule.date || '') || null;
  const lastDay = start ? new Date(`${start}T12:00:00Z`) : null;
  if (lastDay) lastDay.setUTCDate(lastDay.getUTCDate() + 6);
  const end = dateKey(entry.schedule.week_end) || lastDay?.toISOString().slice(0, 10) || null;
  return { start, end };
}

/** Calendar weeks remain one card even when their activities cross a month boundary. */
export function subjectWeeks(subject: Subject): LearningWeek[] {
  const groups = new Map<string, LearningWeek>();
  for (const entry of subject.activities) {
    const source = entry.schedule.date_source;
    const special = source === 'introduction' ? 'introduction' : source === 'extra_activity' ? 'extra' : '';
    const { start, end } = activityWeekRange(entry);
    const label = entry.week || entry.legacy?.section_title || '';
    const key = special === 'introduction' ? special : special === 'extra' ? `extra:${label}`
      : start || entry.native?.weekId || label || 'undated';
    const group = groups.get(key) || { id: key, label: special === 'introduction' ? 'Introduction' : special === 'extra' ? 'Extra activities' : '',
      title: label, start: special ? null : start, end: special ? null : end, activities: [] };
    group.activities.push(entry);
    if (!special && end && (!group.end || end > group.end)) group.end = end;
    groups.set(key, group);
  }
  const rank = (week: LearningWeek) => week.id === 'introduction' ? -1 : week.id.startsWith('extra:') ? 2 : week.start ? 0 : 1;
  let number = 0;
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || (a.start || a.id).localeCompare(b.start || b.id, undefined, { numeric: true })).map(week => {
    const activities = [...week.activities].sort((a, b) => (a.schedule.date || '').localeCompare(b.schedule.date || '') || a.position - b.position);
    const label = week.label || (week.id === 'undated' ? 'Undated activities' : (number++, /^week\s*\d+/i.exec(week.title)?.[0] || `Week ${number}`));
    const title = week.title && !/^week\s*\d+\s*$/i.test(week.title) ? week.title
      : activities.find(a => a.legacy?.section_title)?.legacy?.section_title || activities[0]?.title || 'Learning activities';
    return { ...week, label, title, activities };
  });
}

/** Keep assigned weeks visible even before their materials have been published. */
export function subjectMapWeeks(subject: Subject, real?: LearnerDetail | null, metadata?: CoverMetadata | null, schedule?: TrainingPlanDashboard | null) {
  const weeks = subjectWeeks(subject);
  const moduleIds = new Set([
    subject.id.startsWith('current:') ? subject.id.slice(8) : '',
    metadata?.builder_subjects?.[subject.id]?.id, schedule?.moduleLinks?.[subject.id]?.id,
    ...subject.activities.map(a => a.native?.moduleId),
  ].filter(Boolean));
  for (const planned of real?.week || []) {
    const belongs = planned.moduleId ? moduleIds.has(planned.moduleId) : planned.module === subject.title;
    if (!belongs || !planned.week) continue;
    const represented = weeks.some(week => week.activities.some(a => planned.weekId ? a.native?.weekId === planned.weekId : a.week === planned.week)
      || week.title === planned.week || week.label.toLowerCase() === planned.week.toLowerCase());
    if (represented) continue;
    const id = planned.weekId || planned.week;
    if (!weeks.some(week => week.id === id)) weeks.push({ id, label: planned.week, title: planned.week, start: null, end: null, activities: [] });
  }
  return weeks;
}

/** Resolve Builder links before names, including courses merged with imported history. */
export function resolveLearningSubject(subjects: Subject[], requested?: string | null, metadata?: CoverMetadata | null, schedule?: TrainingPlanDashboard | null) {
  if (!requested) return undefined;
  const exact = subjects.find(s => s.id === requested);
  if (exact) return exact;
  const moduleId = requested.replace(/^current:/, '');
  const links = { ...metadata?.builder_subjects, ...schedule?.moduleLinks };
  const matches = subjects.filter(s => links[s.id]?.id === moduleId || s.activities.some(a => a.native?.moduleId === moduleId)
    || s.activities.some(a => a.legacy && Object.values(metadata?.activity_sources || {}).some(source => source.module_id === moduleId && source.group_id === a.legacy!.group_id)));
  if (matches.length === 1) return matches[0];
  const title = metadata?.current_subjects?.find(s => s.id === moduleId)?.title || schedule?.modules?.find(m => m.id === moduleId)?.title;
  const named = title ? subjects.filter(s => s.title.trim().toLowerCase() === title.trim().toLowerCase()) : [];
  return named.length === 1 ? named[0] : undefined;
}

type LearningPlanSelection = {
  status: 'current' | 'next' | 'previous' | 'undated' | 'empty' | 'unavailable';
  entries: { subject: Subject; module: PlanModule }[];
};

/** Only the assigned training-plan teaching period can make a module current.
 * Keep the header's placement rules and its next/previous choices, but preserve
 * that distinction instead of labelling every fallback as current. */
export function learningPlanSelection(subjects: Subject[], real: LearnerDetail | null, metadata?: CoverMetadata | null, schedule?: TrainingPlanDashboard | null, today = learningToday()): LearningPlanSelection {
  if (!schedule) return { status: 'unavailable', entries: [] };
  const plan = learnerHeaderPlan(schedule.modules || [], real || {}, today);
  const first = plan.modules[0];
  if (!first) return { status: 'empty', entries: [] };
  const start = dateKey(first.start_date), end = dateKey(first.end_date);
  const status = start && end && start <= today && end >= today ? 'current'
    : start && start > today ? 'next' : end && end < today ? 'previous' : 'undated';
  const entries = plan.modules.flatMap(module => {
    const subject = resolveLearningSubject(subjects, `current:${module.id}`, metadata, schedule);
    return subject ? [{ subject, module }] : [];
  });
  return { status, entries };
}

export function currentLearningSubject(subjects: Subject[], real: LearnerDetail | null, metadata?: CoverMetadata | null, schedule?: TrainingPlanDashboard | null, today = learningToday()) {
  const selection = learningPlanSelection(subjects, real, metadata, schedule, today);
  return selection.status === 'current' ? selection.entries[0]?.subject : undefined;
}

export function nextLearningWeek(subject: Subject, today = learningToday()) {
  const weeks = subjectWeeks(subject);
  const pending = weeks.filter(w => w.activities.some(a => !a.completed));
  return pending.find(w => w.start && w.start <= today && (w.end || w.start) >= today) || pending[0] || weeks[0];
}

export function currentLearningWeek(subject: Subject, today = learningToday()) {
  return subjectWeeks(subject).find(week => week.start && week.end && week.start <= today && week.end >= today
    && week.activities.some(entry => !entry.schedule.date_needs_review
      && !['original_created_at', 'source_date'].includes(entry.schedule.date_source || '')));
}

/** Continue follows the dated current week; completion only chooses an activity within it. */
export function continuingLearningWeek(subject: Subject, today = learningToday()) {
  return currentLearningWeek(subject, today) || nextLearningWeek(subject, today);
}

/** Open the current teaching week even when it is already complete. */
export function subjectOpeningActivity(subject: Subject, requestedWeek?: LearningWeek, today = learningToday()) {
  const week = requestedWeek || continuingLearningWeek(subject, today);
  const available = week?.activities.filter(entry => entry.native && hasComponentContent(entry.native)) || [];
  return available.find(entry => !entry.completed) || available[0];
}

export function learningHref(view: 'catalogue' | 'map', kind?: string, learnerId?: string, subject?: string, week?: string) {
  const base = view === 'map' ? '/learner/learning-plan/modules' : '/learner/my-learning';
  const path = kind && learnerId ? `${base}/${encodeURIComponent(kind)}/${encodeURIComponent(learnerId)}` : base;
  const query = new URLSearchParams();
  if (subject) query.set('subject', subject);
  if (week) query.set('week', week);
  return `${path}${query.size ? `?${query}` : ''}`;
}
