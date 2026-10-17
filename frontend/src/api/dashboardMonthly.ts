import type { LearnerKind } from './learnerDetail';
import type { MeetingBookingSession } from '@/pages/learner/reviews/MeetingBookingDialog';
import { readLearnerJson, subscribeLearnerReadInvalidation, withCallerSignal } from './learnerRead';
import { createCachedResource } from './cachedRequest';

/** Selected-month display projection. Legacy plan consumers keep their contracts. */
export type MonthlyAbsenceAction = { id: string; date: string; title: string; reportId: number | null };
export type DashboardMonthlyPlan = {
  version: 2; month: string; title: string; refreshAt: string;
  navigation: { previous: string | null; next: string | null };
  summary: { requiredHours: string; achievedHours: string; difference: string; ksbs: string[];
    differenceTone: 'positive' | null; differenceDirection: 'up' | 'down' | 'equal' };
  activitiesHref: string | null;
  reviews: Array<{ id: string; title: string; date: string; time: string; status: string; tooltip: string;
    formHref: string | null; attendHref: string | null; booking: MeetingBookingSession | null }>;
  assignments: Array<{ id: string; title: string; subtitle: string; requiredHours: string; achievedHours: string;
    progress: string; progressLabel: string; href: string; actionLabel: string }>;
  lectures: Array<{ id: string; date: string; time: string; title: string; tutor: string; duration: string;
    attendHref: string | null; status: string; absenceLabel: string | null;
    absenceAction: 'absence' | 'catchup' | null; absence: MonthlyAbsenceAction | null }>;
};

export type MonthlyDisplayBounds = { programmeStartDate?: string | null; programmeEndDate?: string | null };

function path(kind: LearnerKind, id: string, month: string, subject: string, start: string | null, end: string | null) {
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  if (subject) params.set('subject', subject);
  if (start !== null) params.set('programmeStartDate', start);
  if (end !== null) params.set('programmeEndDate', end);
  return `/learner_api/dashboard/${kind}/${encodeURIComponent(id)}/monthly/plan/${params.size ? `?${params}` : ''}`;
}

const keyFor = (kind: LearnerKind, id: string, month: string, subject: string, bounds?: MonthlyDisplayBounds) =>
  JSON.stringify([kind, id, month, subject, bounds ? bounds.programmeStartDate ?? '' : null, bounds ? bounds.programmeEndDate ?? '' : null]);
const keys = new Set<string>();
const nullableMonth = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const resource = createCachedResource('learner-dashboard-monthly', async (key: string) => {
  const [kind, id, month, subject, start, end] = JSON.parse(key) as [LearnerKind, string, string, string, string | null, string | null];
  const data = await readLearnerJson<DashboardMonthlyPlan>(path(kind, id, month, subject, start, end), { force: true });
  if (!data || data.version !== 2 || typeof data.title !== 'string' || !Number.isFinite(Date.parse(data.refreshAt)) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) || !data.summary || !data.navigation
    || !Array.isArray(data.summary.ksbs) || !Array.isArray(data.reviews) || !Array.isArray(data.assignments)
    || !Array.isArray(data.lectures) || (month && data.month !== month)
    || typeof data.summary.requiredHours !== 'string' || typeof data.summary.achievedHours !== 'string'
    || typeof data.summary.difference !== 'string' || !['up', 'down', 'equal'].includes(data.summary.differenceDirection)
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
  const cached = resource.peek(key);
  if (cached && Date.parse(cached.refreshAt) <= Date.now()) resource.invalidate(key);
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

export const peekDashboardMonthly = (kind: LearnerKind, id: string, month: string, subject = '', bounds?: MonthlyDisplayBounds) => {
  const cached = resource.peek(keyFor(kind, id, month, subject, bounds));
  return cached && Date.parse(cached.refreshAt) > Date.now() ? cached : undefined;
};
