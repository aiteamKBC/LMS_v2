import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import { formatHoursMinutes, isComponentComplete, quizAttemptsFor, type JourneyComponent } from '@/utils/learnerJourney';
import type { CurriculumRow } from '@/pages/learner/training-plan-timeline/model';
import { nativeHref, type SubjectEntry } from '@/pages/learner/my-learning/SubjectWorkspace';

/** A week's own window: up to the next slot, or seven days for the final week. */
export function weekWindow(weeks: CurriculumRow[], index: number): { start: string; end: string | null } {
  const next = weeks[index + 1];
  const end = new Date(`${next?.date ?? weeks[index].date}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + (next ? -1 : 6));
  return { start: weeks[index].date, end: end.toISOString().slice(0, 10) };
}

/** The learner's default week: the current one, otherwise the next one or the final past week. */
export function resolveInitialWeek(weeks: CurriculumRow[], today: string): CurriculumRow | undefined {
  if (!weeks.length) return undefined;
  const current = weeks.find((week, index) => {
    const { start, end } = weekWindow(weeks, index);
    return start <= today && (end === null || end >= today);
  });
  if (current) return current;
  return weeks.find(week => week.date > today) || weeks[weeks.length - 1];
}

/** A stable key for a curriculum row, for selection state and React lists. */
export function weekKey(week: Pick<CurriculumRow, 'slotNumber'>): string {
  return String(week.slotNumber);
}

/** This week's activities, from the components a native curriculum week actually authored. */
export function weekComponents(real: LearnerDetail | null, moduleId: string | undefined, weekId: string | undefined, weekNumber?: number): JourneyComponent[] {
  if (!real || !moduleId || (!weekId && weekNumber == null)) return [];
  return real.components
    .filter(component => String(component.moduleId) === String(moduleId)
      && (String(component.weekId) === String(weekId)
        || (component.weekId == null && weekNumber != null && Number(component.week) === Number(weekNumber))))
    .map(component => ({
      ...component,
      title: component.component,
      quizAttempts: component.isQuiz && component.quizMeta
        ? quizAttemptsFor(component, real.quizAttempts)
        : undefined,
    }));
}

export function weekProgress(components: JourneyComponent[], completedIds: Set<string>): { completed: number; total: number; percent: number } {
  const total = components.length;
  const completed = components.filter(component => isComponentComplete(component, completedIds)).length;
  return { completed, total, percent: total ? Math.round((completed / total) * 10000) / 100 : 0 };
}

export type ActivityStatus = 'completed' | 'in-progress' | 'not-started';

export function activityStatus(component: JourneyComponent, completedIds: Set<string>): ActivityStatus {
  if (isComponentComplete(component, completedIds)) return 'completed';
  if (component.isQuiz && (component.quizAttempts?.length ?? 0) > 0) return 'in-progress';
  return 'not-started';
}

export function activityActionLabel(status: ActivityStatus): 'View' | 'Continue' | 'Start' {
  return status === 'completed' ? 'View' : status === 'in-progress' ? 'Continue' : 'Start';
}

/** The route this activity opens, reusing My Learning's own type-to-route rules. */
export function activityHref(component: JourneyComponent, week: string | undefined, kind: LearnerKind, learnerId: string, completed: boolean): string | null {
  const entry: SubjectEntry = {
    id: component.componentId || '', title: component.title, category: component.type || 'activity',
    completed, position: 0, schedule: { date: null, month: 'undated' }, week, native: component,
  };
  const href = nativeHref(entry, kind, learnerId);
  if (href) return href;
  const type = (component.type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (type === 'assignment' && component.componentId) {
    return `/learner/component/${kind}/${learnerId}/${component.componentId}?week=${encodeURIComponent(week || '')}`;
  }
  return null;
}

function formatActivityMinutes(durationMinutes: number): string {
  const totalSeconds = Math.round(durationMinutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}${seconds ? ` ${seconds}s` : ''}`;
  return seconds ? `${minutes ? `${minutes}m ` : ''}${seconds}s` : `${minutes} mins`;
}

export function activityExpectedTimeLabel(component: JourneyComponent): string {
  if (component.isQuiz && component.quizMeta?.duration) {
    const { duration, timeUnit } = component.quizMeta;
    if (duration >= 60 && /^(min|mins|minute|minutes)$/i.test(timeUnit || 'mins')) return formatActivityMinutes(duration);
    return `${duration} ${timeUnit || 'mins'}`;
  }
  if (component.durationMinutes) return formatActivityMinutes(component.durationMinutes);
  if (component.expectedOtjh != null) return formatHoursMinutes(component.expectedOtjh);
  return '—';
}

export function activityKsbCodes(component: JourneyComponent): string[] {
  const directCodes = [
    ...((component as any).ksbCodes || []),
    ...((component as any).ksbs || []),
    ...((component as any).mappedKsbs || []),
    ...((component as any).mapped_ksbs || []),
  ];
  const mappingCodes = [
    ...(component.ksbMappings || []),
    ...((component as any).ksb_mappings || []),
  ].map(mapping => typeof mapping === 'string'
    ? mapping
    : mapping?.code || mapping?.ksbCode || mapping?.ksb_code);
  return [...new Set([...mappingCodes, ...directCodes].map(code => String(code || '').trim().toUpperCase()).filter(Boolean))];
}

/**
 * Minutes behind an activity's "Expected time" label, using the same order:
 * quiz duration, then activity duration, then authored OTJ hours. Null when
 * the label shows no time.
 */
export function activityExpectedMinutes(component: JourneyComponent): number | null {
  if (component.isQuiz && component.quizMeta?.duration) {
    const { duration, timeUnit } = component.quizMeta;
    const unit = (timeUnit || 'mins').trim().toLowerCase();
    if (/^(min|mins|minute|minutes)$/.test(unit)) return duration;
    if (/^(h|hr|hrs|hour|hours)$/.test(unit)) return duration * 60;
    if (/^(s|sec|secs|second|seconds)$/.test(unit)) return duration / 60;
    return null;
  }
  if (component.durationMinutes) return component.durationMinutes;
  if (component.expectedOtjh != null) return component.expectedOtjh * 60;
  return null;
}

/** KSBs mapped to a week's activities; achieved when a completed activity maps them. */
export function weekKsbProgress(components: JourneyComponent[], completedIds: Set<string>) {
  const all = new Set<string>();
  const achieved = new Set<string>();
  for (const component of components) {
    const codes = activityKsbCodes(component);
    codes.forEach(code => all.add(code));
    if (isComponentComplete(component, completedIds)) codes.forEach(code => achieved.add(code));
  }
  const total = all.size;
  return { achieved: achieved.size, total, codes: [...all].sort(), percent: total ? Math.round((achieved.size / total) * 10000) / 100 : 0 };
}

/** Expected hours of a week's activities and the share already completed. */
export function weekExpectedHours(components: JourneyComponent[], completedIds: Set<string>) {
  let plannedMinutes = 0;
  let completedMinutes = 0;
  let untimed = 0;
  for (const component of components) {
    const minutes = activityExpectedMinutes(component);
    if (minutes == null) { untimed += 1; continue; }
    plannedMinutes += minutes;
    if (isComponentComplete(component, completedIds)) completedMinutes += minutes;
  }
  return {
    plannedHours: plannedMinutes / 60,
    completedHours: completedMinutes / 60,
    untimed,
    percent: plannedMinutes ? Math.round((completedMinutes / plannedMinutes) * 10000) / 100 : 0,
  };
}
