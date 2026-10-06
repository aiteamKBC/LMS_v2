import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityItem, StudentActivityResponse } from '@/api/studentActivity';
import { completedComponentIds, isComponentComplete, quizAttemptsFor, type JourneyComponent } from '@/utils/learnerJourney';

export type Schedule = Pick<StudentActivityItem, 'date' | 'month' | 'week_start' | 'week_end' | 'date_needs_review' | 'date_source'> & { due_timing?: string };
export type SubjectEntry = { id: string; title: string; category: string; completed: boolean; position: number; schedule: Schedule; week?: string; legacy?: StudentActivityItem; native?: JourneyComponent; bestScorePercent?: number | null };
export type Subject = { id: string; title: string; source: 'legacy' | 'current'; activities: SubjectEntry[]; recordedHistory?: boolean; catalogueCount?: number; acceptedHours?: number };
type BuilderSubject = { id: string; title: string };
type ActivitySource = { module_id: string; group_id: number; activity_id: number };
export type CoverMetadata = { covers: Record<string, string>; activity_dates?: Record<string, Schedule>; current_subjects?: BuilderSubject[]; builder_subjects?: Record<string, BuilderSubject>; activity_sources?: Record<string, ActivitySource> };
export type UnifiedLearningSummary = {
  subjects: Subject[];
  subjectCount: number;
  activityCount: number;
  completedActivityCount: number;
  percent: number;
};

export function subjectRefs(data: StudentActivityResponse | null, real: LearnerDetail | null) {
  return [...new Set([
    ...(data?.subjects || []).map(subject => `legacy:${subject.id}`),
    ...(data?.activities || []).map(activity => `legacy:${activity.group_id}`),
    ...(real?.components || []).flatMap(component => component.moduleId ? [`current:${component.moduleId}`] : []),
  ])].sort().join(',');
}


function scheduleForDate(value?: string | null): Schedule {
  const date = value?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date: null, month: 'undated' };
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return { date: null, month: 'undated' };
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const week_start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  return { date, month: date.slice(0, 7), week_start, week_end: day.toISOString().slice(0, 10) };
}


function nativeActivitySchedule(schedule: Schedule | undefined, sessionDate?: string | null): Schedule {
  // Older metadata used the upload date. It cannot override a session date or
  // move a whole future programme into the month its components were created.
  if (!schedule || ['original_created_at', 'source_date', 'undated'].includes(schedule.date_source || '')) {
    return scheduleForDate(sessionDate);
  }
  return schedule;
}


export function subjectsFrom(data: StudentActivityResponse | null, real: LearnerDetail | null, metadata?: CoverMetadata | null): Subject[] {
  const { activity_dates: dates = {}, current_subjects: currentSubjects = [], builder_subjects: builderSubjects = {} } = metadata || {};
  const activitySources = data?.activity_sources ?? metadata?.activity_sources ?? {};
  const recordedHistory = data?.progress_basis === 'recorded_activities';
  const historicalModules = new Set(recordedHistory ? (data?.subjects || []).flatMap(s => s.module_id ? [s.module_id] : []) : []);
  const subjects = new Map<string, Subject>();
  for (const subject of data?.subjects || []) subjects.set(`legacy:${subject.id}`, { id: `legacy:${subject.id}`, title: subject.name, source: 'legacy', activities: [], recordedHistory, catalogueCount: subject.catalogue_count, acceptedHours: subject.accepted_hours });
  for (const item of data?.activities || []) {
    const key = `legacy:${item.group_id}`;
    const subject = subjects.get(key) || { id: key, title: item.group_name || 'Unnamed subject', source: 'legacy' as const, activities: [] };
    if (!subject.activities.some((entry) => entry.id === item.activity_id)) subject.activities.push({ id: item.activity_id, title: item.activity, category: item.category, completed: item.completed, position: item.position || 0, schedule: item.month ? item : scheduleForDate(item.date), legacy: item });
    subjects.set(key, subject);
  }
  const legacyByBuilder = new Map<string, string[]>();
  for (const subject of subjects.values()) {
    const builder = builderSubjects[subject.id];
    if (builder) legacyByBuilder.set(builder.id, [...(legacyByBuilder.get(builder.id) || []), subject.id]);
  }
  for (const source of Object.values(activitySources)) {
    const key = `legacy:${source.group_id}`;
    if (!subjects.has(key)) continue;
    legacyByBuilder.set(source.module_id, [...new Set([...(legacyByBuilder.get(source.module_id) || []), key])]);
  }
  const currentKey = (moduleId: string) => {
    if (recordedHistory) return `current:${moduleId}`;
    const matches = legacyByBuilder.get(moduleId);
    if (matches?.length === 1) return matches[0];
    return `current:${moduleId}`;
  };
  const completed = completedComponentIds(real);
  for (const subject of currentSubjects) {
    if (historicalModules.has(subject.id)) continue;
    const key = currentKey(subject.id);
    if (!subjects.has(key)) subjects.set(key, { id: key, title: subject.title, source: 'current', activities: [] });
  }
  // Removed quizzes the learner passed follow the live plan, so they keep their
  // module and count as completed work there.
  const planEntries = [...(real?.components || []), ...(real?.retiredQuizComponents || [])];
  for (const [index, item] of planEntries.entries()) {
    if (item.moduleId && historicalModules.has(item.moduleId)) continue;
    const key = item.moduleId ? currentKey(item.moduleId) : `unlinked:${item.module}`;
    const subject = subjects.get(key) || { id: key, title: item.module || 'Unnamed subject', source: 'current' as const, activities: [] };
    const component: JourneyComponent = { ...item, title: item.component,
      quizAttempts: item.isQuiz && item.quizMeta ? quizAttemptsFor(item, real?.quizAttempts) : undefined };
    const id = item.componentId || `quiz:${item.quizMeta?.quizId ?? `${item.week}:${index}`}`;
    const isComplete = isComponentComplete(component, completed);
    const scores = (component.quizAttempts || []).map((attempt) => attempt.grade * 100).filter(Number.isFinite);
    const bestScorePercent = scores.length ? Math.max(...scores) : null;
    const source = activitySources[id];
    const previous = source && source.module_id === item.moduleId && key === `legacy:${source.group_id}`
      ? subject.activities.find((entry) => entry.legacy?.source_activity_id === source.activity_id) : undefined;
    if (previous) {
      // One original activity can have results in both systems. Preserve its
      // original player/history and any later achievement without counting twice.
      previous.completed ||= isComplete;
      const legacy = previous.legacy!;
      const historicalScore = legacy.best_score_percent ?? (legacy.quiz_score != null && legacy.quiz_maximum_score ? legacy.quiz_score / legacy.quiz_maximum_score * 100 : null);
      const knownScores = [previous.bestScorePercent, historicalScore, bestScorePercent].filter((score): score is number => score != null);
      previous.bestScorePercent = knownScores.length ? Math.max(...knownScores) : null;
      previous.native = component;
      previous.week = item.week || undefined;
      const currentSchedule = nativeActivitySchedule(dates[id], component.sessionDate);
      if (currentSchedule.date && !currentSchedule.date_needs_review) previous.schedule = currentSchedule;
      continue;
    }
    if (!subject.activities.some((entry) => entry.id === id)) subject.activities.push({
      id, title: component.title, category: component.type || 'activity', completed: isComplete, bestScorePercent, position: index,
      schedule: nativeActivitySchedule(dates[id], component.sessionDate), week: item.week || undefined, native: component,
    });
    subjects.set(key, subject);
  }
  for (const title of real?.modules || []) {
    if ([...subjects.values()].some(subject => subject.title.trim().toLowerCase() === title.trim().toLowerCase())) continue;
    subjects.set(`unlinked:${title}`, { id: `unlinked:${title}`, title, source: 'current', activities: [] });
  }
  return [...subjects.values()].map((subject) => ({ ...subject, title: builderSubjects[subject.id]?.title || subject.title }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** One roll-up for imported history and all later current-platform progress. */
export function buildUnifiedLearningSummary(
  data: StudentActivityResponse | null,
  real: LearnerDetail | null,
  metadata?: CoverMetadata | null,
): UnifiedLearningSummary {
  const subjects = subjectsFrom(data, real, metadata);
  // Deduplicate only when the placement has an explicit stable identity. A
  // title or position is never an identity fallback.
  const seen = new Set<string>();
  for (const subject of subjects) {
    subject.activities = subject.activities.filter((entry) => {
      const key = entry.legacy?.source_activity_id != null
        ? `legacy:${entry.legacy.group_id}:${entry.legacy.catalogue_kind || "material"}:${entry.legacy.activity_id}`
        : entry.native?.componentId ? `component:${entry.native.componentId}`
          : entry.native?.quizMeta?.quizId ? `quiz:${entry.native.quizMeta.quizId}` : null;
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const activityCount = subjects.reduce((sum, subject) => sum + subject.activities.length, 0);
  const completedActivityCount = subjects.reduce(
    (sum, subject) => sum + subject.activities.filter((entry) => entry.completed).length,
    0,
  );
  return {
    subjects,
    subjectCount: subjects.length,
    activityCount,
    completedActivityCount,
    percent: activityCount ? Math.round(completedActivityCount / activityCount * 10000) / 100 : 0,
  };
}

