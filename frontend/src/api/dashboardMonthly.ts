import type { LearnerKind } from './learnerDetail';
import type { PlanReview, PlanSession } from './trainingPlanDashboard';
import type { PlanActivitySummary } from './learnerOverview';
import type { AttendanceLecture } from './attendanceLectures';
import { readLearnerJson, subscribeLearnerReadInvalidation, withCallerSignal } from './learnerRead';
import { createCachedResource } from './cachedRequest';

/** Selected-month display projection. Legacy plan consumers keep their contracts. */
export type DashboardMonthlyPlan = {
  month: string;
  navigation: { previous: string | null; next: string | null };
  summary: { requiredHours: number | null; achievedHours: number | null; ksbs: string[] };
  topics: string[];
  contractStatus: string;
  selectedSubjectId: string | null;
  coachName: string;
  reviews: PlanReview[];
  assignments: Array<{ moduleId: string; moduleTitle: string; activity: Pick<PlanActivitySummary, 'id' | 'title' | 'weekTitle' | 'expectedHours' | 'completed' | 'componentId'> }>;
  lectures: Array<{ session: Pick<PlanSession, 'id' | 'start' | 'end' | 'minutes' | 'joinUrl' | 'status'>; title: string; tutor: string; attendance: Pick<AttendanceLecture,
    'id' | 'date' | 'title' | 'coach' | 'status' | 'effectiveAttendance' | 'rawStatus' | 'rawAttendanceStatus' | 'canReportAbsence' | 'catchupStatus' | 'absenceReport' | 'recovery'> | null }>;
};

export type MonthlyDisplayBounds = { programmeStartDate?: string | null; programmeEndDate?: string | null };

function path(kind: LearnerKind, id: string, month: string, subject: string, start: string | null, end: string | null) {
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  if (subject) params.set('subject', subject);
  if (start !== null) params.set('programmeStartDate', start);
  if (end !== null) params.set('programmeEndDate', end);
  return `/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/monthly/${params.size ? `?${params}` : ''}`;
}

const keyFor = (kind: LearnerKind, id: string, month: string, subject: string, bounds?: MonthlyDisplayBounds) =>
  JSON.stringify([kind, id, month, subject, bounds ? bounds.programmeStartDate ?? '' : null, bounds ? bounds.programmeEndDate ?? '' : null]);
const keys = new Set<string>();
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
const nullableMonth = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const resource = createCachedResource('learner-dashboard-monthly', async (key: string) => {
  const [kind, id, month, subject, start, end] = JSON.parse(key) as [LearnerKind, string, string, string, string | null, string | null];
  const data = await readLearnerJson<DashboardMonthlyPlan>(path(kind, id, month, subject, start, end), { force: true });
  if (!data || !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) || !data.summary || !data.navigation
    || !Array.isArray(data.summary.ksbs) || !Array.isArray(data.reviews) || !Array.isArray(data.assignments)
    || !Array.isArray(data.lectures) || !Array.isArray(data.topics) || (month && data.month !== month)
    || !nullableNumber(data.summary.requiredHours) || !nullableNumber(data.summary.achievedHours)
    || !nullableMonth(data.navigation.previous) || !nullableMonth(data.navigation.next)) {
    throw new Error('Could not load your monthly dashboard. Please try again.');
  }
  return data;
});
let generation = 0;
subscribeLearnerReadInvalidation(() => { generation += 1; resource.invalidate(); keys.clear(); });

export function invalidateDashboardMonthly(kind: LearnerKind, id: string) {
  generation += 1;
  for (const key of keys) {
    const [cachedKind, cachedId] = JSON.parse(key) as string[];
    if (kind === cachedKind && id === cachedId) { resource.invalidate(key); keys.delete(key); }
  }
}

export async function fetchDashboardMonthly(kind: LearnerKind, id: string, month: string, signal?: AbortSignal, subject = '', bounds?: MonthlyDisplayBounds) {
  const requestGeneration = generation;
  const key = keyFor(kind, id, month, subject, bounds);
  keys.add(key);
  const data = await withCallerSignal(resource.read(key), signal);
  // The initial unqualified read and an explicit return to its resolved month
  // share one server snapshot. Never seed a response superseded by a save.
  if (!month && requestGeneration === generation && !signal?.aborted) {
    const resolved = keyFor(kind, id, data.month, subject, bounds);
    keys.add(resolved);
    resource.prime(resolved, data);
  }
  return data;
}

export const peekDashboardMonthly = (kind: LearnerKind, id: string, month: string, subject = '', bounds?: MonthlyDisplayBounds) =>
  resource.peek(keyFor(kind, id, month, subject, bounds));
