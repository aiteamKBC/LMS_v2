import { createCachedResource } from './cachedRequest';
import { LearnerReadError, readLearnerJson } from './learnerRead';
import type { TrainingPlanDashboard } from './trainingPlanDashboard';
import type {
  LearnerComponentEntry, LearnerComponentProgress, LearnerDetail, LearnerKind, LearnerVideoProgress,
} from './learnerDetail';

/**
 * The Student Dashboard's Weekly Learning panel, without the full learner
 * workspace payload: a lightweight delivery spine and progress rings for the
 * assigned modules, with activities and completion records for one week only.
 */
export type WeeklyLearningDetail = Pick<LearnerDetail, 'id' | 'programme' | 'cohort' | 'group' | 'quizAttempts'> & {
  selectedWeekId?: string | null;
  selectedWeek?: CanonicalSelectedWeek;
  selectedModuleId?: string | null;
  weekSummaries?: { moduleId: string; weekId?: string; slotNumber: number; progress: { completed: number; total: number; percent: number } }[];
  schedule?: Pick<TrainingPlanDashboard, 'modules' | 'sessions' | 'moduleActivityHours'>;
  /** Older compact fixtures may contain these; the lazy API uses the spine. */
  modules?: LearnerDetail['modules'];
  week?: LearnerDetail['week'];
  components: LearnerComponentEntry[];
  videoProgress: Pick<LearnerVideoProgress, 'kind' | 'componentId' | 'passed'>[];
  componentProgress: Pick<LearnerComponentProgress, 'kind' | 'componentId' | 'passed'>[];
};

export type WeeklyLearningWeek = Pick<WeeklyLearningDetail, 'components' | 'quizAttempts' | 'videoProgress' | 'componentProgress'> & {
  weekId: string;
  moduleId: string;
  selectedWeek?: CanonicalSelectedWeek;
  schedule?: Pick<TrainingPlanDashboard, 'sessions' | 'moduleActivityHours'>;
};

/** Wire contract: calculations and selected activity data come from Coach. */
export type WeeklyLearningResponse = {
  weeks: CanonicalWeek[];
  selectedWeek: CanonicalSelectedWeek | null;
};
export type CanonicalWeek = {
  id: string; moduleId: string; moduleTitle: string; weekId?: string; weekNumber: number; slotNumber: number;
  kind: 'live-session' | 'reading-week'; title: string; startDate: string; endDate: string;
  status: string; progress: number; completedActivities: number; totalActivities: number;
  attended: boolean | null; sessionState: string; holidayNote: string;
  sessionStart?: string; sessionDurationMinutes?: number | null;
  holidays: import('./trainingPlanDashboard').PlanSlotHoliday[];
};
export type CanonicalSelectedWeek = CanonicalWeek & {
  summary: { completedActivities: number; totalActivities: number; progress: number; ksbCount: number;
    achievedKsbCount: number; otjhHours: number | null; plannedOtjhHours: number; untimedActivities: number };
  liveSession: { id: string; title: string; date: string; start: string; durationMinutes: number | null;
    endTime: string | null; status: string; sessionState: string; attended: boolean | null; joinUrl: string | null } | null;
  activities: { id: string; title: string; type: string; completed: boolean; isQuiz: boolean;
    status: 'completed' | 'in-progress' | 'not-started'; expectedHours: number | null; actualHours: number | null;
    durationMinutes: number | null; quizDuration: number | null; quizTimeUnit: string | null;
    ksbCodes: string[]; quizId?: number | null; contentAvailable: boolean; videoUrl?: string | null;
    sessionDate?: string | null; sessionDateTimeUtc?: string | null; teamsLiveSessionId?: string | null }[];
};

const studentWeekId = (week: CanonicalWeek) => `${week.kind === 'reading-week' ? 'reading' : 'slot'}:${week.moduleId}:${week.slotNumber}`;

function validSelectedWeek(value: CanonicalSelectedWeek | null): boolean {
  return value === null || !!(value && typeof value.moduleId === 'string' && typeof value.id === 'string'
    && Number.isInteger(value.slotNumber) && value.summary && Array.isArray(value.activities)
    && value.activities.every(activity => typeof activity.id === 'string' && typeof activity.completed === 'boolean'
      && typeof activity.contentAvailable === 'boolean' && (!activity.isQuiz || typeof activity.quizId === 'number')));
}

/** Adapt data only; the established view, navigation and cache keys stay intact.
 * Canonical status is carried explicitly, without inventing attempt history.
 */
export function adaptWeeklyLearningWeek(week: CanonicalSelectedWeek): WeeklyLearningWeek {
  const live = week.liveSession;
  return {
    weekId: studentWeekId(week), moduleId: week.moduleId, selectedWeek: week,
    components: week.activities.map(activity => ({
      componentId: activity.id, component: activity.title, moduleId: week.moduleId, weekId: week.weekId,
      module: week.moduleTitle, week: week.title, type: activity.type, expectedOtjh: activity.expectedHours,
      durationMinutes: activity.durationMinutes, isQuiz: activity.isQuiz,
      quizMeta: activity.isQuiz && activity.quizId != null ? { quizId: activity.quizId, questions: null,
        duration: activity.quizDuration, timeUnit: activity.quizTimeUnit } : undefined,
      contentAvailable: activity.contentAvailable, videoUrl: activity.videoUrl,
      sessionDate: activity.sessionDate, sessionDateTimeUtc: activity.sessionDateTimeUtc, teamsLiveSessionId: activity.teamsLiveSessionId,
      ksbMappings: activity.ksbCodes.map(code => ({ code, description: null, classification: null, weight: 0 })),
      weeklyCompleted: activity.completed, weeklyStatus: activity.status,
    })),
    quizAttempts: [], videoProgress: [], componentProgress: [],
    schedule: { sessions: live ? [{ id: live.id, moduleId: week.moduleId, title: live.title, start: live.start,
      end: live.durationMinutes == null ? null : new Date(Date.parse(live.start) + live.durationMinutes * 60_000).toISOString(),
      minutes: live.durationMinutes ?? 0, status: live.status, attended: live.attended, joinUrl: live.joinUrl }] : [],
      moduleActivityHours: { [week.moduleId]: { components: Object.fromEntries(week.activities.map(activity => [activity.id, activity.actualHours ?? 0])), quizzes: {} } } },
  };
}

export function adaptWeeklyLearning(data: WeeklyLearningResponse, id: string): WeeklyLearningDetail {
  const modules = new Map<string, NonNullable<WeeklyLearningDetail['schedule']>['modules'][number]>();
  for (const week of data.weeks) {
    let module = modules.get(week.moduleId);
    if (!module) {
      module = { id: week.moduleId, title: week.moduleTitle, description: '', start_date: week.startDate, end_date: week.endDate,
        tutor_name: '', coach_name: '', curriculumSlots: [] };
      modules.set(week.moduleId, module);
    }
    module.end_date = week.endDate;
    module.curriculumSlots!.push({ slotNumber: week.slotNumber, date: week.startDate, day: week.startDate,
      type: week.kind, sessionNumber: week.kind === 'reading-week' ? null : week.weekNumber, weekId: week.weekId,
      weekTitle: week.title, holidays: week.holidays, holidayNote: week.holidayNote });
  }
  const selected = data.selectedWeek ? adaptWeeklyLearningWeek(data.selectedWeek) : null;
  return { id, programme: '', cohort: '', group: '', components: selected?.components ?? [], quizAttempts: [], videoProgress: [], componentProgress: [],
    selectedWeek: selected?.selectedWeek, selectedWeekId: selected?.weekId ?? null, selectedModuleId: selected?.moduleId ?? null,
    weekSummaries: data.weeks.map(week => ({ moduleId: week.moduleId, weekId: studentWeekId(week), slotNumber: week.slotNumber,
      progress: { completed: week.completedActivities, total: week.totalActivities, percent: week.progress } })),
    schedule: { modules: [...modules.values()], sessions: data.weeks.flatMap(week => {
      if (data.selectedWeek?.id === week.id && data.selectedWeek.liveSession) return selected?.schedule?.sessions ?? [];
      // Rail markers are display facts, never routable meeting identities.
      if (week.sessionState === 'unscheduled' || week.kind === 'reading-week') return [];
      if (!week.sessionStart) return [];
      return [{ id: week.id, moduleId: week.moduleId, title: week.title, start: week.sessionStart,
        end: null, minutes: week.sessionDurationMinutes ?? 0, status: 'scheduled', attended: week.attended, joinUrl: null }];
    }), moduleActivityHours: selected?.schedule?.moduleActivityHours ?? {} } };
}

const weekKeys = new Set<string>();
const weekResource = createCachedResource<WeeklyLearningWeek>('learner-dashboard-week-detail', async key => {
  const [kind, id, moduleId, weekId] = JSON.parse(key) as string[];
  const response = await readLearnerJson<{ selectedWeek: CanonicalSelectedWeek | null }>(`/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/weekly/${encodeURIComponent(weekId)}/?moduleId=${encodeURIComponent(moduleId)}`);
  if (!response.selectedWeek || !validSelectedWeek(response.selectedWeek)
    || studentWeekId(response.selectedWeek) !== weekId || response.selectedWeek.moduleId !== moduleId) {
    throw new LearnerReadError('The week response was incomplete. Please try again.', 200, 'invalid_week');
  }
  const data = adaptWeeklyLearningWeek(response.selectedWeek);
  return data;
}, Number.POSITIVE_INFINITY);

const detailKey = (kind: LearnerKind, id: string, moduleId: string, weekId: string) => JSON.stringify([kind, id, moduleId, weekId]);

export function fetchWeeklyLearningWeek(kind: LearnerKind, id: string, moduleId: string, weekId: string) {
  const key = detailKey(kind, id, moduleId, weekId);
  weekKeys.add(key);
  return weekResource.read(key);
}

export function peekWeeklyLearningWeek(kind: LearnerKind, id: string, moduleId: string, weekId: string) {
  return weekResource.peek(detailKey(kind, id, moduleId, weekId));
}

export function primeWeeklyLearningWeek(kind: LearnerKind, id: string, data: WeeklyLearningDetail) {
  if (!data.selectedWeekId || !data.selectedModuleId) return;
  const key = detailKey(kind, id, data.selectedModuleId, data.selectedWeekId);
  weekKeys.add(key);
  weekResource.prime(key, { ...data, weekId: data.selectedWeekId, moduleId: data.selectedModuleId });
}

const initialKeys = new Set<string>();
const initialKey = (kind: LearnerKind, id: string, moduleId?: string | null) => `${kind}:${id}${moduleId ? `|${encodeURIComponent(moduleId)}` : ''}`;
const weeklyResource = createCachedResource<WeeklyLearningDetail>('learner-dashboard-weekly', async key => {
  const [learner, moduleId] = key.split('|');
  const response = await readLearnerJson<WeeklyLearningResponse>(`/learner_api/dashboard/${learner.replace(':', '/')}/weekly/${moduleId ? `?moduleId=${moduleId}` : ''}`);
  if (!Array.isArray(response.weeks) || !validSelectedWeek(response.selectedWeek)) {
    throw new LearnerReadError('The weekly schedule response was incomplete. Please try again.', 200, 'invalid_weekly');
  }
  const data = adaptWeeklyLearning(response, learner.slice(learner.indexOf(':') + 1));
  // A refreshed spine may contain externally updated progress. Drop the old
  // detail snapshots before the hook seeds the newly selected server week.
  invalidateWeekDetails(learner);
  return data;
});

export function fetchWeeklyLearning(kind: LearnerKind, id: string, options: { revalidate?: boolean; moduleId?: string | null } = {}): Promise<WeeklyLearningDetail> {
  const key = initialKey(kind, id, options.moduleId);
  initialKeys.add(key);
  return weeklyResource.read(key, { revalidate: options.revalidate });
}

/** A live entry, or with `staleForMs` a recent one to show while revalidating. */
export function peekWeeklyLearning(kind: LearnerKind, id: string, staleForMs = 0, moduleId?: string | null): WeeklyLearningDetail | undefined {
  return weeklyResource.peek(initialKey(kind, id, moduleId), staleForMs);
}

/** Called by invalidateLearnerDetailCache: the same saves change this plan. */
export function invalidateWeeklyLearning(key?: string): void {
  weeklyResource.invalidate(key);
  for (const initial of initialKeys) {
    if (!key || initial.split('|')[0] === key) { weeklyResource.invalidate(initial); initialKeys.delete(initial); }
  }
  invalidateWeekDetails(key);
}

function invalidateWeekDetails(key?: string): void {
  for (const detail of weekKeys) {
    const [kind, id] = JSON.parse(detail) as string[];
    if (!key || `${kind}:${id}` === key) { weekResource.invalidate(detail); weekKeys.delete(detail); }
  }
}
