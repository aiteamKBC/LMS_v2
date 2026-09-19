import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import { formatHoursMinutes, isComponentComplete, type JourneyComponent } from '@/utils/learnerJourney';
import type { CurriculumRow } from '@/pages/learner/training-plan-timeline/model';
import { nativeHref, type SubjectEntry } from '@/pages/learner/my-learning/SubjectWorkspace';

/** A week's own window: from its slot date up to (but excluding) the next slot's date. */
export function weekWindow(weeks: CurriculumRow[], index: number): { start: string; end: string | null } {
  const next = weeks[index + 1];
  if (!next) return { start: weeks[index].date, end: null };
  const end = new Date(`${next.date}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { start: weeks[index].date, end: end.toISOString().slice(0, 10) };
}

/** The learner's default week: the one covering today, otherwise the next one, otherwise the first. */
export function resolveInitialWeek(weeks: CurriculumRow[], today: string): CurriculumRow | undefined {
  if (!weeks.length) return undefined;
  const current = weeks.find((week, index) => {
    const { start, end } = weekWindow(weeks, index);
    return start <= today && (end === null || end >= today);
  });
  if (current) return current;
  return weeks.find(week => week.date > today) || weeks[0];
}

/** A stable key for a curriculum row, for selection state and React lists. */
export function weekKey(week: Pick<CurriculumRow, 'slotNumber'>): string {
  return String(week.slotNumber);
}

/** This week's activities, from the components a native curriculum week actually authored. */
export function weekComponents(real: LearnerDetail | null, moduleId: string | undefined, weekId: string | undefined): JourneyComponent[] {
  if (!real || !moduleId || !weekId) return [];
  return real.components
    .filter(component => component.moduleId === moduleId && component.weekId === weekId)
    .map(component => ({
      ...component,
      title: component.component,
      quizAttempts: component.isQuiz && component.quizMeta
        ? real.quizAttempts.filter(attempt => String(attempt.quizId) === String(component.quizMeta!.quizId))
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

export function activityExpectedTimeLabel(component: JourneyComponent): string {
  if (component.isQuiz && component.quizMeta?.duration) return `${component.quizMeta.duration} ${component.quizMeta.timeUnit || 'mins'}`;
  if (component.durationMinutes) return `${component.durationMinutes} mins`;
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
