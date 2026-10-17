import { traceWeeklyLearning } from './weeklyLearningDiagnostics';
import { createCachedResource } from './cachedRequest';
import { LearnerReadError, readLearnerJson, invalidateLearnerReads } from './learnerRead';
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
  /** Canonical facts consumed directly by the Dashboard; no legacy schedule. */
  wire?: WeeklyLearningResponse;
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
  attendance?: 'present' | 'absent' | 'upcoming' | 'unmarked';
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

export const studentWeekId = (week: CanonicalWeek) => `${week.kind === 'reading-week' ? 'reading' : 'slot'}:${week.moduleId}:${week.slotNumber}`;

type Attendance = NonNullable<CanonicalWeek['attendance']>;
type WireWeek = Omit<CanonicalWeek, 'moduleTitle' | 'attended'> & { attendance: Attendance };
type WireSelected = {
  weekId: string;
  summary: Omit<CanonicalSelectedWeek['summary'], 'completedActivities' | 'totalActivities' | 'progress'>;
  liveSession: (Omit<NonNullable<CanonicalSelectedWeek['liveSession']>, 'date' | 'endTime' | 'attended'> & { attendance: Attendance }) | null;
  activities: Omit<CanonicalSelectedWeek['activities'][number], 'completed'>[];
};
export type WeeklyLearningV2 = { version: 2; modules?: { id: string; title: string }[]; weeks?: WireWeek[];
  week?: WireWeek; selectedWeek: WireSelected | null };

/** Resolve references once; no components, progress histories or timeline rebuild. */
export function decodeWeeklyLearning(response: WeeklyLearningResponse | WeeklyLearningV2): WeeklyLearningResponse {
  if (!('version' in response)) return response;
  if (response.version !== 2) throw new LearnerReadError('Unsupported weekly response.', 200, 'invalid_weekly');
  const invalid = () => { throw new LearnerReadError('The week response was incomplete. Please try again.', 200, 'invalid_week'); };
  if (response.selectedWeek === undefined || (!Array.isArray(response.weeks) && !response.week)
    || (response.weeks && !Array.isArray(response.modules))) invalid();
  const titles = new Map(response.modules?.map(module => [module.id, module.title]));
  const attendance = (value: Attendance) => value === 'present' ? true : value === 'absent' ? false : null;
  const week = (row: WireWeek): CanonicalWeek => {
    if (!row || typeof row.id !== 'string' || typeof row.moduleId !== 'string' || !Number.isInteger(row.slotNumber)
      || !Array.isArray(row.holidays) || !['present', 'absent', 'upcoming', 'unmarked'].includes(row.attendance)) invalid();
    return { ...row, moduleTitle: titles.get(row.moduleId) ?? '', attended: attendance(row.attendance) };
  };
  const weeks = response.weeks?.map(week) ?? (response.week ? [week(response.week)] : []);
  const selected = response.selectedWeek;
  if (!selected) return { weeks, selectedWeek: null };
  if (!selected.summary || !Array.isArray(selected.activities) || selected.liveSession === undefined) invalid();
  const navigation = weeks.find(row => row.id === selected.weekId);
  if (!navigation) throw new LearnerReadError('The week response was incomplete. Please try again.', 200, 'invalid_week');
  return { weeks, selectedWeek: { ...navigation,
    summary: { ...selected.summary, completedActivities: navigation.completedActivities,
      totalActivities: navigation.totalActivities, progress: navigation.progress },
    liveSession: selected.liveSession ? { ...selected.liveSession, date: navigation.startDate, endTime: null,
      attended: attendance(selected.liveSession.attendance) } : null,
    activities: selected.activities.map(activity => ({ ...activity, completed: activity.status === 'completed' })),
  } };
}

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
  return { id, wire: data, programme: '', cohort: '', group: '', components: selected?.components ?? [], quizAttempts: [], videoProgress: [], componentProgress: [],
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
let activeWeekRequests = 0;
const weekResource = createCachedResource<WeeklyLearningWeek>('learner-dashboard-week-detail', async key => {
  activeWeekRequests += 1;
  try {
    const [kind, id, moduleId, weekId] = JSON.parse(key) as string[];
    const raw = await readLearnerJson<WeeklyLearningResponse | WeeklyLearningV2>(`/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/weekly/${encodeURIComponent(weekId)}/?moduleId=${encodeURIComponent(moduleId)}&version=2`);
    const response = decodeWeeklyLearning(raw);
    if (!response.selectedWeek || !validSelectedWeek(response.selectedWeek)
      || studentWeekId(response.selectedWeek) !== weekId || response.selectedWeek.moduleId !== moduleId) {
      throw new LearnerReadError('The week response was incomplete. Please try again.', 200, 'invalid_week');
    }
    const data = 'version' in raw ? { weekId, moduleId, selectedWeek: response.selectedWeek,
      components: [], quizAttempts: [], videoProgress: [], componentProgress: [] } : adaptWeeklyLearningWeek(response.selectedWeek);
    return data;
  } finally {
    activeWeekRequests -= 1;
  }
}, 5 * 60_000);

const detailKey = (kind: LearnerKind, id: string, moduleId: string, weekId: string) => JSON.stringify([kind, id, moduleId, weekId]);

export function fetchWeeklyLearningWeek(kind: LearnerKind, id: string, moduleId: string, weekId: string) {
  const key = detailKey(kind, id, moduleId, weekId);
  weekKeys.add(key);
  return weekResource.read(key);
}

export async function prefetchWeeklyLearningWeek(kind: LearnerKind, id: string, moduleId: string, weekId: string) {
  if (activeWeekRequests || peekWeeklyLearningWeek(kind, id, moduleId, weekId)) return;
  try {
    await fetchWeeklyLearningWeek(kind, id, moduleId, weekId);
  } catch {
    traceWeeklyLearning('request-error', `${kind}:${id}`, 'Adjacent week prefetch failed; selection will retry.');
  }
}

export function peekWeeklyLearningWeek(kind: LearnerKind, id: string, moduleId: string, weekId: string, staleForMs = 0) {
  return weekResource.peek(detailKey(kind, id, moduleId, weekId), staleForMs);
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
  traceWeeklyLearning('request-start', key);
  let raw: WeeklyLearningResponse | WeeklyLearningV2;
  try {
    raw = await readLearnerJson<WeeklyLearningResponse | WeeklyLearningV2>(`/learner_api/dashboard/${learner.replace(':', '/')}/weekly/?${moduleId ? `moduleId=${moduleId}&` : ''}version=2`);
    traceWeeklyLearning('request-success', key);
  } catch (error) {
    traceWeeklyLearning('request-error', key);
    throw error;
  }
  const response = decodeWeeklyLearning(raw);
  if (!Array.isArray(response.weeks) || !validSelectedWeek(response.selectedWeek)) {
    throw new LearnerReadError('The weekly schedule response was incomplete. Please try again.', 200, 'invalid_weekly');
  }
  const selected = response.selectedWeek;
  const data: WeeklyLearningDetail = { id: learner.slice(learner.indexOf(':') + 1), wire: response,
    programme: '', cohort: '', group: '', components: [], quizAttempts: [], videoProgress: [], componentProgress: [],
    selectedWeek: selected ?? undefined, selectedWeekId: selected ? studentWeekId(selected) : null,
    selectedModuleId: selected?.moduleId ?? null };
  return data;
});

export function fetchWeeklyLearning(kind: LearnerKind, id: string, options: { revalidate?: boolean; moduleId?: string | null } = {}): Promise<WeeklyLearningDetail> {
  const key = initialKey(kind, id, options.moduleId);
  traceWeeklyLearning('read', key, `revalidate=${!!options.revalidate}; fresh=${!!weeklyResource.peek(key)}`);
  initialKeys.add(key);
  const previous = weeklyResource.peek(key, 5 * 60_000);
  return weeklyResource.read(key, { revalidate: options.revalidate }).then(data => {
    // Side effects belong only to the accepted read, never an invalidated one.
    if (weeklyResource.peek(key) !== data || previous === data) return data;
    const navigation = new Map(data.wire?.weeks.map(week => [studentWeekId(week), week]));
    const before = new Map(previous?.wire?.weeks.map(week => [studentWeekId(week), week]));
    for (const detail of weekKeys) {
      const [detailKind, detailId, , weekId] = JSON.parse(detail) as string[];
      if (`${detailKind}:${detailId}` !== `${kind}:${id}`) continue;
      if (!navigation.has(weekId) || (before.has(weekId) && JSON.stringify(before.get(weekId)) !== JSON.stringify(navigation.get(weekId)))) {
        weekResource.invalidate(detail);
        weekKeys.delete(detail);
      }
    }
    return data;
  });
}

/** A live entry, or with `staleForMs` a recent one to show while revalidating. */
export function peekWeeklyLearning(kind: LearnerKind, id: string, staleForMs = 0, moduleId?: string | null): WeeklyLearningDetail | undefined {
  return weeklyResource.peek(initialKey(kind, id, moduleId), staleForMs);
}

/** Called by invalidateLearnerDetailCache: the same saves change this plan. */
export type WeeklyProgressScope = { activityId?: string; quizId?: number };

export function invalidateWeeklyLearning(key?: string, scope?: WeeklyProgressScope): void {
  traceWeeklyLearning('invalidate', key ?? 'all');
  weeklyResource.invalidate(key);
  for (const initial of initialKeys) {
    if (!key || initial.split('|')[0] === key) { weeklyResource.invalidate(initial); initialKeys.delete(initial); }
  }
  invalidateWeekDetails(key, scope);
}

/** Mutation boundary: invalidate this learner before notifying mounted reads. */
export function invalidateWeeklyProgress(kind: LearnerKind, id: string, activityId?: string): void {
  invalidateWeeklyLearning(`${kind}:${id}`, activityId ? { activityId } : undefined);
  invalidateLearnerReads();
}

function invalidateWeekDetails(key?: string, scope?: WeeklyProgressScope): void {
  const { activityId, quizId } = scope ?? {};
  const known = activityId || quizId != null ? [...weekKeys].flatMap(detail => {
    const [kind, id] = JSON.parse(detail) as string[];
    if (`${kind}:${id}` !== key) return [];
    return weekResource.peek(detail, Number.POSITIVE_INFINITY)?.selectedWeek?.activities
      .filter(activity => activity.id === activityId || quizId != null && activity.quizId === quizId) ?? [];
  }) : [];
  const quizzes = new Set(known.map(activity => activity.quizId).filter(id => id != null));
  for (const detail of weekKeys) {
    const [kind, id] = JSON.parse(detail) as string[];
    if (key && `${kind}:${id}` !== key) continue;
    const cached = weekResource.peek(detail, Number.POSITIVE_INFINITY);
    // Unknown mappings and in-flight details still invalidate conservatively.
    // A known activity leaves independent cached weeks valid; shared quiz
    // placements invalidate together, even across weeks/modules.
    if (known.length && cached?.selectedWeek && !cached.selectedWeek.activities.some(activity =>
      activity.id === activityId || activity.quizId != null && quizzes.has(activity.quizId))) continue;
    weekResource.invalidate(detail);
    weekKeys.delete(detail);
  }
}
