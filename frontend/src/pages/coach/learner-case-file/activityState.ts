import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import type { JourneyComponent, JourneyModule } from '@/utils/learnerJourney';
import { progressCountsAsAchieved } from '@/utils/learnerJourney';

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
};

/** Mirror overview_week.merged_activities: every historical assignment plus
 * only current Builder components that have no stable historical placement. */
export function buildFullCaseFileJourney(current: JourneyModule[], aptemActivity: StudentActivityResponse | null): JourneyModule[] {
  if (!aptemActivity) return current;
  const currentComponents = current.flatMap(module => module.weeks.flatMap(week => week.components));
  const currentById = new Map(currentComponents.map(component => [componentKey(component), component]));
  const mappedBySource = new Map<string, string>();
  for (const [componentId, link] of Object.entries(aptemActivity.activity_sources || {})) {
    mappedBySource.set(`${link.group_id}:${link.activity_id}`, componentId);
  }
  const seen = new Set<string>();
  const moduleRows = new Map<number, Map<string, ScopedJourneyComponent[]>>();
  for (const item of aptemActivity.activities || []) {
    const sourceKey = `${item.group_id}:${item.source_activity_id}`;
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    const currentComponent = currentById.get(mappedBySource.get(sourceKey) || '');
    const week = item.section_title?.trim() || 'Activities';
    const weeks = moduleRows.get(item.group_id) || new Map<string, ScopedJourneyComponent[]>();
    const components = weeks.get(week) || [];
    components.push({
      ...(currentComponent || { expectedOtjh: item.planned ?? null }),
      componentId: currentComponent?.componentId || `aptem:${sourceKey}`,
      title: item.activity,
      type: currentComponent?.type || item.category,
      aptemGroupId: item.group_id,
      aptemActivityId: item.source_activity_id,
    });
    weeks.set(week, components);
    moduleRows.set(item.group_id, weeks);
  }
  const result: JourneyModule[] = (aptemActivity.subjects || []).map(subject => ({
    module: subject.name,
    weeks: Array.from(moduleRows.get(subject.id) || []).map(([week, components]) => ({
      week, otjh: components.reduce((total, component) => total + (component.expectedOtjh || 0), 0), components,
    })),
  })).filter(module => module.weeks.length > 0);

  for (const module of current) {
    for (const week of module.weeks) {
      for (const component of week.components) {
        const id = componentKey(component);
        if (!id) continue;
        const link = aptemActivity.activity_sources?.[id];
        if (link && seen.has(`${link.group_id}:${link.activity_id}`)) continue;
        let target = result.find(item => item.module === module.module && item.weeks.some(itemWeek => itemWeek.week === week.week));
        // This title lookup controls presentation only; identity and de-duplication
        // above use component/group/activity IDs exclusively.
        if (!target) {
          target = { module: module.module, weeks: [] };
          result.push(target);
        }
        let targetWeek = target.weeks.find(itemWeek => itemWeek.week === week.week);
        if (!targetWeek) {
          targetWeek = { week: week.week, otjh: 0, components: [] };
          target.weeks.push(targetWeek);
        }
        targetWeek.components.push({ ...component,
          sourceIssue: link ? 'no_aptem_result'
            : aptemActivity.activity_source_issues?.[id] || 'missing_source_component_id' } as ScopedJourneyComponent);
        targetWeek.otjh += component.expectedOtjh || 0;
      }
    }
  }
  return result;
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
