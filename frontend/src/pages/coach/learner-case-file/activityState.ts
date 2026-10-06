import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { JourneyComponent, JourneyModule } from '@/utils/learnerJourney';
import { progressCountsAsAchieved } from '@/utils/learnerJourney';
import { buildUnifiedLearningSummary, type CoverMetadata } from '@/pages/learner/my-learning/learningSummary';
import { subjectMapWeeks, subjectLearningStatus } from '@/pages/learner/my-learning/subjectLearning';

export type ActivityStatus = 'completed' | 'in-progress' | 'not-started' | 'unavailable';
export type ActivityUnavailableReason = 'missing_source_component_id' | 'missing_group_id_activity_id'
  | 'no_aptem_result' | 'ambiguous_lineage' | 'activity_source_unavailable';

export interface CaseFileActivityState {
  status: ActivityStatus;
  completedAt: string | null;
  source: 'aptem' | 'native';
  sourceRef: string | null;
  unavailableReason?: ActivityUnavailableReason;
}

export type CaseFileActivityStates = Record<string, CaseFileActivityState>;

const componentKey = (component: JourneyComponent) => String(component.componentId || '').trim();
type ScopedJourneyComponent = JourneyComponent & {
  aptemGroupId?: number;
  aptemActivityId?: number;
  sourceIssue?: ActivityUnavailableReason;
  canonicalState?: CaseFileActivityState;
};

/** Project the canonical My Learning subjects; never infer module membership here. */
export function buildFullCaseFileJourney(
  current: JourneyModule[],
  aptemActivity: StudentActivityResponse | null,
  detail: LearnerDetail | null = null,
  metadata: CoverMetadata | null = null,
  hasAptemId = Boolean(detail?.studentActivityAvailable),
): JourneyModule[] {
  if (!hasAptemId) return current;
  // Failed/loading reads cannot justify reconstructing a different module set.
  if (!aptemActivity || !metadata || !detail) return [];
  const { subjects } = buildUnifiedLearningSummary(aptemActivity, detail, metadata);
  return subjects.map(subject => ({
    id: subject.id,
    module: subject.title,
    weeks: subjectMapWeeks(subject, detail, metadata).map(week => {
      const components: ScopedJourneyComponent[] = week.activities.map(entry => {
        const legacy = entry.legacy;
        const native = entry.native;
        const nativeState = native?.componentId ? buildCaseFileActivityStates(
          [{ module: subject.title, weeks: [{ week: week.label, otjh: 0, components: [native] }] }],
          { ...detail, studentActivityAvailable: false }, null,
        )[native.componentId] : null;
        const status = entry.completed ? 'completed'
          : nativeState?.status === 'in-progress' || subjectLearningStatus({ ...subject, activities: [entry] }) === 'In progress' ? 'in-progress' : 'not-started';
        return {
          ...(native || { expectedOtjh: legacy?.planned ?? null }),
          // Historical records need a subject-scoped key; keep native IDs intact.
          componentId: legacy ? `aptem:${subject.id}:${entry.id}` : native?.componentId || `${subject.id}:${entry.id}`,
          title: entry.title,
          type: native?.type || entry.category,
          canonicalState: {
            status,
            completedAt: legacy ? null : nativeState?.completedAt || null,
            source: legacy ? 'aptem' : 'native',
            sourceRef: legacy ? `aptem:${legacy.group_id}:${legacy.catalogue_kind || 'material'}:${legacy.activity_id}`
              : native?.componentId ? `component:${native.componentId}` : null,
          },
        };
      });
      return { week: week.label, components,
        otjh: components.reduce((sum, component) => sum + (
          component.canonicalState?.source === 'native' && (component.isQuiz || component.type === 'quiz')
            ? 0 : component.expectedOtjh || 0
        ), 0) };
    }),
  }));
}

function latestIso(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) || null;
}

/** Build the case-file state using stable learner and activity identities only. */
export function buildCaseFileActivityStates(
  modules: JourneyModule[],
  detail: LearnerDetail | null,
  aptemActivity: StudentActivityResponse | null,
): CaseFileActivityStates {
  const states: CaseFileActivityStates = {};
  const components = modules.flatMap(module => module.weeks.flatMap(week => week.components));

  if (detail?.studentActivityAvailable) {
    const sourceByComponent = aptemActivity?.activity_sources || {};
    for (const component of components) {
      const id = componentKey(component);
      if (!id) continue;
      const scoped = component as ScopedJourneyComponent;
      if (scoped.canonicalState) {
        states[id] = scoped.canonicalState;
        continue;
      }
      const link = scoped.aptemGroupId != null && scoped.aptemActivityId != null
        ? { group_id: scoped.aptemGroupId, activity_id: scoped.aptemActivityId }
        : sourceByComponent[id];
      const evidence = link && aptemActivity?.activities.find(item =>
        item.group_id === link.group_id && item.source_activity_id === link.activity_id);
      const started = Boolean(evidence && (
        evidence.video_started || evidence.reading_viewed || evidence.quiz_attempted
        || (evidence.status && !['not_started', 'not started'].includes(evidence.status.trim().toLowerCase()))
      ));
      states[id] = {
        status: scoped.sourceIssue || !aptemActivity
          ? 'unavailable'
          : !link || !evidence ? 'unavailable'
            : evidence.completed ? 'completed' : started ? 'in-progress' : 'not-started',
        // The historical activity date is a schedule date, not completion evidence.
        completedAt: null,
        source: 'aptem',
        sourceRef: evidence ? `aptem:${evidence.group_id}:${evidence.source_activity_id}` : null,
        ...((scoped.sourceIssue || !aptemActivity || !link || !evidence) ? {
          unavailableReason: scoped.sourceIssue || (!aptemActivity ? 'activity_source_unavailable' : 'no_aptem_result'),
        } : {}),
      };
    }
    return states;
  }

  const nativeRecords = [
    ...(detail?.quizAttempts || []).map(record => ({ ...record, kind: 'quiz' as const })),
    ...(detail?.videoProgress || []),
    ...(detail?.componentProgress || []),
  ];
  for (const component of components) {
    const id = componentKey(component);
    if (!id) continue;
    const canonicalState = (component as ScopedJourneyComponent).canonicalState;
    if (canonicalState) {
      states[id] = canonicalState;
      continue;
    }
    const records = nativeRecords.filter(record => String(record.componentId || '') === id);
    const marking = detail?.componentMarkingStatus?.[id];
    const completed = records.filter(record => progressCountsAsAchieved(record))
      .filter(() => !component.tutorValidationRequired || marking?.status === 'accepted');
    const feedStarted = (detail?.activityFeed || []).some(entry => String(entry.componentId || '') === id);
    states[id] = {
      status: completed.length ? 'completed' : records.length || feedStarted ? 'in-progress' : 'not-started',
      completedAt: completed.length
        ? latestIso([marking?.reviewedAt, ...completed.map(record => record.submittedAt)])
        : null,
      source: 'native',
      sourceRef: records.length ? `component:${id}` : null,
    };
  }
  return states;
}

export function moduleActivitySummary(module: JourneyModule, states: CaseFileActivityStates) {
  const activities = module.weeks.flatMap(week => week.components);
  const counts = activities.reduce((result, component) => {
    const status = states[componentKey(component)]?.status || 'not-started';
    result[status] += 1;
    return result;
  }, { completed: 0, 'in-progress': 0, 'not-started': 0, unavailable: 0 });
  const total = activities.length;
  return {
    ...counts,
    total,
    percent: total ? Math.round((counts.completed / total) * 100) : 0,
    status: (total > 0 && counts.completed === total ? 'completed'
      : counts.completed > 0 || counts['in-progress'] > 0 ? 'in-progress'
        : counts.unavailable > 0 ? 'unavailable'
        : 'not-started') as ActivityStatus,
  };
}
