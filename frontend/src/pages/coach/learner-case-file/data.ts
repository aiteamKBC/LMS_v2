import { useCallback, useEffect, useState } from 'react';
import { formatHoursMinutes } from '@/lib/format';
import {
  fetchLearnerDetail,
  type LearnerActivityEntry,
  type LearnerDetail,
  type LearnerKind,
  type LearnerQuizAttempt,
} from '@/api/learnerDetail';
import {
  eventDisplayDate,
  fetchCoachCalendarEvents,
  formatDateLabel as formatCalendarDateLabel,
  formatTimeLabel as formatCalendarTimeLabel,
  parseLocalDate,
  sortEvents,
  statusLabel as calendarStatusLabel,
  type CoachCalendarEvent,
  type CoachReviewGenerationIssue,
} from '@/pages/coach/shared/calendarEvents';
import { fetchLearnerMetrics } from '@/api/learnerMetrics';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import { buildLearnerJourney, type JourneyModule } from '@/utils/learnerJourney';
import { coachFetch } from '@/lib/coachFetch';

const CASELOAD_BASE = '/coach_api/coach/caseload';
const ATTENDANCE_BASE = '/coach_api/coach/attendance';
const MARKING_BASE = '/coach_api/coach/marking-queue';

interface CoachCompletedKsbDetail {
  code: string;
  type?: string;
  description?: string;
  sources?: Array<{
    id?: string;
    title?: string;
    typeLabel?: string;
    kind?: string;
    source?: string;
    activityId?: string;
    completedAt?: string;
    status?: string;
    module?: string;
  }>;
}

export interface CoachCaseloadLearner {
  id: string;
  name: string;
  initials: string;
  /** 'commercial' | 'apprenticeship' — which learner_detail table this id resolves against. */
  learnerType?: LearnerKind | null;
  /** enrolment."Created_users".id — a different, disjoint pk space from `id` above.
   *  This is the id /learner_api/learner-detail/<kind>/<pk>/ actually queries. */
  enrolmentId?: string | null;
  employer: string;
  cohortId: string;
  cohortName: string;
  group: string;
  status: 'at-risk' | 'on-track' | 'high' | 'new-starter';
  enrollmentStatus: string;
  riskFlags: string[];
  overallProgress: number;
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
  otjhMinimum?: number;
  otjhPlanned?: number;
  otjhSubmitted?: number;
  otjhForecast?: number;
  otjhExpected?: number;
  otjhProgressHours?: string;
  otjhStatus?: string;
  ksbCompleted?: number;
  ksbTarget?: number;
  ksbStatus?: string;
  ksbCompletedDetails?: CoachCompletedKsbDetail[];
  ksbProgress: number;
  evidenceCount: number;
  nextCoaching: string;
  nextReview: string;
  lastContact: string;
  lastAttendanceDate: string;
  lastProgressReview: string;
  lastReview: string;
  lastCoachingSession: string;
  lastSubmittedEvidence: string;
  recentFlag: string | null;
  progressVariance: string;
  startDate: string;
  gatewayReviewDate: string;
  plannedEndDate: string;
  coachName?: string;
  coachEmail?: string;
  rawProgramStatus?: string;
  coachRag?: string;
  email?: string | null;
  employerEmail?: string | null;
  employerPhone?: string | null;
}

interface CoachCaseloadResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CoachCaseloadLearner[];
}

export interface CoachAttendanceLearner {
  sessionHistory?: import('@/api/learnerAttendance').AttendanceSessionRow[];
  id: string;
  learner: string;
  initials: string;
  learnerType?: LearnerKind | null;
  enrolmentId?: string | null;
  email?: string | null;
  programme: string;
  cohort: string;
  group: string;
  programStatus?: string;
  enrollmentStatus?: string;
  isOnBreak?: boolean;
  includedInAttendanceMetrics?: boolean;
  attendance: number | null;
  sessions: number | null;
  present: number | null;
  absent: number | null;
  late: number | null;
  catchup: number | null;
  trend: 'up' | 'down' | 'stable';
  risk: 'red' | 'amber' | 'green' | null;
  employer: string;
  overallProgress: number;
  otjhCompleted: number;
  otjhTarget: number;
  ksbProgress: number;
  lastSession: string;
  lastSessionDate?: string | null;
  nextSession: string;
  consecutiveMissed: number | null;
  hasAttendance: boolean;
}

interface CoachAttendanceResponse {
  learners?: CoachAttendanceLearner[];
}

export interface CoachMarkingQueueItem {
  id: string;
  learnerId: string;
  learner: string;
  initials: string;
  email?: string | null;
  programme: string;
  group: string;
  status: string;
  enrollmentStatus: string;
  isOnBreak: boolean;
  pendingEvidence: number;
  acceptedEvidence: number;
  referredEvidence: number;
  referredClosure: number;
  totalEvidence: number;
  elapsedDays: number;
  isOverdue: boolean;
  lastSubmission: string;
  lastSubmissionIso?: string | null;
  startDate: string;
  module: string | null;
  title: string | null;
  type: string | null;
  due: string | null;
  words: number | null;
  activityId?: string | null;
  activityTitle?: string | null;
  submittedAt?: string | null;
}

export interface CaseFileMarkingSubmission {
  id: string;
  activityId: string;
  activityTitle: string;
  submittedAt: string | null;
}

interface CoachMarkingQueueResponse {
  items?: CoachMarkingQueueItem[];
}

export interface CaseFileActivityItem {
  id: string;
  date: string;
  event: string;
  detail: string;
  tone: 'primary' | 'accent' | 'emerald' | 'amber' | 'red';
}

export interface CaseFileUpcomingSession {
  id: string;
  kind: 'live' | 'review';
  status: CoachCalendarEvent['status'];
  statusLabel: string;
  day: string;
  title: string;
  date: string;
  time: string;
  summary: string;
  detail: string;
}

export interface CaseFileReviewMeeting {
  id: string;
  eventKey: string;
  reviewInstanceId?: string | null;
  source: string;
  reviewTypeName: string;
  title: string;
  date: string;
  time: string;
  detail: string;
  status: CoachCalendarEvent['status'];
  statusLabel: string;
  isNext: boolean;
  notes?: string;
}

export interface CaseFileReviewGroup {
  key: string;
  title: string;
  items: CaseFileReviewMeeting[];
}

export interface CoachLearnerCaseFileData {
  learnerId: string;
  /** enrolment."Created_users" id used by the learner workspace APIs. */
  enrolmentId: string | null;
  learnerIdentityIds?: string[];
  kind: LearnerKind | null;
  snapshot: CoachCaseloadLearner | null;
  attendance: CoachAttendanceLearner | null;
  evidence: CoachMarkingQueueItem | null;
  detail: LearnerDetail | null;
  journey: JourneyModule[];
  peers: CoachCaseloadLearner[];
  displayName: string;
  initials: string;
  programme: string;
  employer: string;
  cohort: string;
  group: string;
  email: string;
  programStatus: string;
  coachName: string;
  coachEmail: string;
  employerEmail: string;
  employerPhone: string;
  overallProgress: number | null;
  attendanceRate: number | null;
  attendancePresentCount: number | null;
  attendanceSessionCount: number | null;
  attendanceAbsentCount: number | null;
  otjhCompleted: number | null;
  otjhTarget: number | null;
  otjhPlanned: number | null;
  ksbProgress: number | null;
  metricsAvailable?: boolean;
  ksbStatus?: 'ready' | 'empty' | 'unavailable';
  ksbEvidencedCount: number | null;
  ksbTotalCount: number | null;
  mappedKsbCodes: string[];
  ksbCodeProgress: Array<{ code: string; completed: number; total: number }>;
  evidenceCount: number | null;
  startDate: string;
  gatewayReviewDate: string;
  plannedEndDate: string;
  totalExpectedOtjh: number;
  touchedKsbCodes: string[];
  activityItems: CaseFileActivityItem[];
  upcomingSessions: CaseFileUpcomingSession[];
  progressReviews: CaseFileReviewMeeting[];
  monthlyCoachMeetings: CaseFileReviewMeeting[];
  reviewGroups: CaseFileReviewGroup[];
  reviewGenerationIssues: CoachReviewGenerationIssue[];
  reviewsLoading: boolean;
  markingSubmissions?: CaseFileMarkingSubmission[];
  coachNotes?: string[];
}

export interface CaseFileOtjhMetrics {
  logged: number | null;
  target: number | null;
  programmeTotal: number | null;
  remaining: number | null;
  progressPercent: number | null;
}

/**
 * Shared presentation selector for the Case File OTJH values. The values are
 * selected by buildCaseFileData from the existing audit/detail sources; this
 * helper only keeps every Case File surface internally consistent.
 */
export function selectCaseFileOtjh(data: Pick<CoachLearnerCaseFileData, 'otjhCompleted' | 'otjhTarget' | 'otjhPlanned' | 'totalExpectedOtjh'>): CaseFileOtjhMetrics {
  const logged = data.otjhCompleted;
  const target = data.otjhTarget;
  const programmeTotal = data.totalExpectedOtjh > 0 ? data.totalExpectedOtjh : data.otjhPlanned;
  const remaining = logged !== null && target !== null ? Math.max(0, target - logged) : null;
  const progressPercent = logged !== null && target !== null && target > 0
    ? Math.min(100, Math.round((logged / target) * 100))
    : null;
  return { logged, target, programmeTotal, remaining, progressPercent };
}

/** Match the backend canonical KSB identity: child codes resolve to parent codes. */
export function normalizeKsbCode(value: string | null | undefined): string {
  const code = String(value || '').trim().toUpperCase();
  const match = code.match(/^([KSB])(\d+)(?:\.\d+)?$/);
  return match ? `${match[1]}${match[2]}` : code;
}

export interface CaseFileTabProps {
  data: CoachLearnerCaseFileData;
}

export function useCoachLearnerCaseFileData(args: {
  learnerId?: string | null;
  learnerName?: string | null;
  kind?: LearnerKind | null;
  /** enrolment."Created_users".id, when the caller already has it (see
   *  CoachCaseloadLearner.enrolmentId) -- the id /learner-detail/ actually
   *  needs. learnerId above is the coach-side LearnerProfile id, a different,
   *  disjoint pk space that always 404s against that endpoint. */
  enrolmentId?: string | null;
  enabled?: boolean;
}) {
  const [data, setData] = useState<CoachLearnerCaseFileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken(token => token + 1), []);

  useEffect(() => {
    const rawLearnerId = args.learnerId?.trim();
    const rawLearnerName = args.learnerName?.trim();
    let cancelled = false;

    if (args.enabled === false) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (!rawLearnerId && !rawLearnerName) {
      setData(null);
      setError('No learner was selected.');
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);

      // Load the profile list first. The remaining coach-wide projections are
      // expensive and each may consume a pooled connection for a long time;
      // starting all four together starves login/session and learner requests.
      // They are fetched after caseload resolution, preserving the payload while
      // avoiding an initial pool-wide burst.
      const requestedMarkingLearnerId = args.enrolmentId?.trim() || rawLearnerId;
      const caseloadPromise = fetchCoachCaseload();
      const directId = numericId(rawLearnerId);
      // rawLearnerId is the coach-side LearnerProfile id -- a disjoint pk space
      // from enrolment."Created_users".id, which /learner-detail/ actually
      // queries. Only start the fast path when the caller already resolved the
      // real enrolment id (see CoachCaseloadLearner.enrolmentId); otherwise
      // fetching it here would just 404 and get overwritten by the slow path
      // below anyway, once the coach lists resolve the real id.
      const directEnrolmentId = numericId(args.enrolmentId);
      const directDetailPromise = directEnrolmentId
        ? fetchAnyLearnerDetail(directEnrolmentId, args.kind ?? undefined)
        : null;
      let learnerMetrics: CaseFileLearnerMetrics | null = null;
      let liveAttendance: LearnerAttendance | null = null;

      let detail: LearnerDetail | null = null;
      let resolvedKind: LearnerKind | null = null;
      let detailError: string | null = null;

      if (directDetailPromise) {
        try {
          const detailResult = await directDetailPromise;
          detail = detailResult.detail;
          resolvedKind = detailResult.kind;
          [learnerMetrics, liveAttendance] = await Promise.all([
            fetchCaseFileMetrics(resolvedKind, directEnrolmentId),
            fetchCaseFileAttendance(resolvedKind, directEnrolmentId),
          ]);

          // Show the useful learner view as soon as its focused detail arrives.
          // Coach metrics continue enriching it in the background.
          const initialData = buildCaseFileData({
            learnerId: directId,
            enrolmentId: directEnrolmentId,
            kind: resolvedKind,
            snapshot: null,
            attendance: null,
            evidence: null,
            detail,
            caseload: [],
            timetableEvents: [],
            reviewGenerationIssues: [],
            reviewsLoading: true,
            learnerMetrics,
            liveAttendance,
          });
          if (!cancelled && initialData) {
            setData(initialData);
            setLoading(false);
          }
        } catch (loadErr) {
          detailError = loadErr instanceof Error ? loadErr.message : 'Could not load learner details.';
        }
      }

      const caseloadResult = await Promise.allSettled([caseloadPromise]).then(([result]) => result);

      // Keep these projections serial as well. Each endpoint can perform many
      // learner/database reads; overlapping them recreates the pool starvation
      // seen during a normal case-file load.
      const attendanceResult = await Promise.allSettled([fetchCoachAttendance()]).then(([result]) => result);
      const markingResult = await Promise.allSettled([
        fetchCoachMarkingQueue(requestedMarkingLearnerId, rawLearnerName),
      ]).then(([result]) => result);
      const timetableResult = await Promise.allSettled([fetchCoachTimetable()]).then(([result]) => result);

      if (cancelled) {
        return;
      }

      const caseload = caseloadResult.status === 'fulfilled' ? caseloadResult.value : [];
      const attendance = attendanceResult.status === 'fulfilled' ? attendanceResult.value : [];
      let marking = markingResult.status === 'fulfilled' ? markingResult.value : [];
      const timetable = timetableResult.status === 'fulfilled'
        ? timetableResult.value
        : { events: [], reviewGenerationIssues: [] };
      const timetableEvents = timetable.events;

      const snapshot = resolveCaseloadLearner(caseload, rawLearnerId, rawLearnerName);
      const attendanceLearner = resolveAttendanceLearner(attendance, rawLearnerId, rawLearnerName);
      const evidence = resolveMarkingItem(marking, rawLearnerId, rawLearnerName);
      const resolvedId = snapshot?.id || attendanceLearner?.id || evidence?.learnerId || numericId(rawLearnerId);
      // Prefer the real enrolment id surfaced by whichever coach list matched
      // this learner. Falling back to resolvedId (the profile id) only applies
      // to the rare profile with no linked enrolment row left -- it will 404
      // the same way this already did before enrolmentId existed, not worse.
      const resolvedEnrolmentId = directEnrolmentId
        || snapshot?.enrolmentId
        || attendanceLearner?.enrolmentId
        || null;
      const resolvedDetailKind = args.kind ?? snapshot?.learnerType ?? attendanceLearner?.learnerType ?? undefined;

      if (resolvedEnrolmentId && resolvedEnrolmentId !== requestedMarkingLearnerId) {
        try {
          marking = await fetchCoachMarkingQueue(resolvedEnrolmentId, rawLearnerName);
        } catch {
          // Keep the first safe response; the rest of the case file can still render.
        }
      }

      // Non-numeric routes need coach data to resolve the id. Numeric routes have
      // already loaded detail above, concurrently with the coach requests.
      if ((resolvedEnrolmentId || resolvedId) && !directDetailPromise) {
        try {
          const detailResult = await fetchAnyLearnerDetail(resolvedEnrolmentId || resolvedId, resolvedDetailKind);
          detail = detailResult.detail;
          resolvedKind = detailResult.kind;
        } catch (loadErr) {
          detailError = loadErr instanceof Error ? loadErr.message : 'Could not load learner details.';
        }
      }

      if (!learnerMetrics || !liveAttendance) {
        const [metrics, attendanceRecord] = await Promise.all([
          learnerMetrics ? Promise.resolve(learnerMetrics) : fetchCaseFileMetrics(resolvedKind, resolvedEnrolmentId),
          liveAttendance ? Promise.resolve(liveAttendance) : fetchCaseFileAttendance(resolvedKind, resolvedEnrolmentId),
        ]);
        learnerMetrics = metrics;
        liveAttendance = attendanceRecord;
      }

      if (cancelled) {
        return;
      }

      const finalData = buildCaseFileData({
        learnerId: resolvedId || rawLearnerId || '',
        enrolmentId: resolvedEnrolmentId,
        kind: resolvedKind,
        snapshot,
        attendance: attendanceLearner,
        evidence,
        markingItems: marking,
        detail,
        caseload,
        timetableEvents,
        reviewGenerationIssues: timetable.reviewGenerationIssues,
        reviewsLoading: false,
        learnerMetrics,
        liveAttendance,
      });

      if (!finalData) {
        setData(null);
        setError(
          detailError
            || buildMissingLearnerMessage(rawLearnerId, rawLearnerName)
            || 'Could not find that learner in the connected coach data.',
        );
        setLoading(false);
        return;
      }

      setData(finalData);

      const missingDetailOnly = Boolean(detailError && /learner not found|\b404\b/i.test(detailError));
      if (!detail && detailError && !missingDetailOnly) {
        setError(detailError);
      } else if (caseloadResult.status === 'rejected' && !snapshot) {
        setError(caseloadResult.reason instanceof Error ? caseloadResult.reason.message : 'Could not load coach caseload.');
      } else {
        setError(null);
      }

      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [args.enabled, args.kind, args.learnerId, args.learnerName, args.enrolmentId, reloadToken]);

  return { data, loading, error, refresh };
}

export function flattenJourney(data: CoachLearnerCaseFileData) {
  return data.journey.flatMap((module) =>
    module.weeks.flatMap((week) =>
      week.components.map((component) => ({
        module: module.module,
        week: week.week,
        title: component.title,
        expectedOtjh: component.expectedOtjh,
        isQuiz: Boolean(component.isQuiz),
        quizMeta: component.quizMeta,
        quizAttempts: component.quizAttempts || [],
      })),
    ),
  );
}

export function formatDisplayDate(value?: string | null, short = false) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === '--') {
    return '--';
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-GB', short
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
  }

  return normalized;
}

export function formatPercent(value: number | null, suffix = true) {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return suffix ? `${value}%` : String(value);
}

export function formatHours(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  return formatHoursMinutes(value);
}

export function formatFraction(current: number | null, total: number | null) {
  if (current === null || total === null) {
    return '--';
  }
  return `${roundNumber(current)}/${roundNumber(total)}`;
}

function parseHoursValue(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const match = String(value ?? '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function toneFromPercent(value: number | null, amberThreshold = 80) {
  if (value === null) {
    return 'neutral';
  }
  if (value >= 90) {
    return 'green';
  }
  if (value >= amberThreshold) {
    return 'amber';
  }
  return 'red';
}

export function ksbCategory(code: string) {
  const normalized = code.trim().toUpperCase();
  if (normalized.startsWith('K')) return 'Knowledge';
  if (normalized.startsWith('S')) return 'Skills';
  if (normalized.startsWith('B')) return 'Behaviours';
  return 'Other';
}

export function quizGradeValue(attempt: LearnerQuizAttempt) {
  const match = String(attempt.grade || '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function resolveQuizAttemptTitle(detail: LearnerDetail | null, attempt: LearnerQuizAttempt) {
  const matchedComponent = detail?.components.find((component) => component.quizMeta?.quizId === attempt.quizId);
  return attempt.componentTitle || matchedComponent?.component || `Quiz ${attempt.quizId}`;
}

export function resolveQuizAttemptModule(detail: LearnerDetail | null, attempt: LearnerQuizAttempt) {
  const matchedComponent = detail?.components.find((component) => component.quizMeta?.quizId === attempt.quizId);
  return attempt.moduleTitle || matchedComponent?.module || null;
}

export function formatQuizAttemptScore(attempt: LearnerQuizAttempt) {
  return attempt.achievedScore != null && attempt.totalScore != null
    ? `${roundNumber(attempt.achievedScore)}/${roundNumber(attempt.totalScore)}`
    : '';
}

async function request<T>(url: string): Promise<T> {
  const existingRequest = pendingRequests.get(url) as Promise<T> | undefined;
  if (existingRequest) {
    return existingRequest;
  }

  const pendingRequest = requestUncached<T>(url);
  pendingRequests.set(url, pendingRequest);
  try {
    return await pendingRequest;
  } finally {
    pendingRequests.delete(url);
  }
}

// React StrictMode intentionally re-runs effects in development. Sharing an
// in-flight GET prevents that check from doubling slow database work.
const pendingRequests = new Map<string, Promise<unknown>>();

async function requestUncached<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await coachFetch(url, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 8000?');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(`Backend returned HTML instead of JSON (${res.status}). Check the Django server error output.`);
      }
      throw new Error('Received an invalid JSON response from the backend.');
    }
  }

  if (!res.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? String((data as { error?: string }).error)
      : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

async function fetchCoachCaseload() {
  const data = await request<CoachCaseloadResponse>(CASELOAD_BASE);
  return data.learners || [];
}

async function fetchCoachAttendance() {
  const data = await request<CoachAttendanceResponse>(ATTENDANCE_BASE);
  return data.learners || [];
}

async function fetchCoachMarkingQueue(learnerId?: string, learnerName?: string) {
  const query = new URLSearchParams({ page_size: '100' });
  if (learnerId) query.set('learner', learnerId);
  else if (learnerName) query.set('search', learnerName);
  const data = await request<CoachMarkingQueueResponse>(`${MARKING_BASE}?${query}`);
  return data.items || [];
}

async function fetchCoachTimetable() {
  const data = await fetchCoachCalendarEvents(undefined);
  return {
    events: data.events || [],
    reviewGenerationIssues: data.reviewGenerationIssues || [],
  };
}

type CaseFileLearnerMetrics = {
  programmeCompleted: number | null;
  programmeTotal: number | null;
  programmeProgress: number | null;
  planned: number | null;
  actual: number | null;
  ksbCompleted: number | null;
  ksbTotal: number | null;
  ksbCodes: string[];
  ksbCodeProgress: Array<{ code: string; completed: number; total: number }>;
  ksbProgress: number | null;
  ksbStatus: 'ready' | 'empty' | 'unavailable';
};

/** Canonical totals used by the learner dashboard. Programme, OTJH and KSB
 * figures must describe the same learner facts on both workspaces. */
async function fetchCaseFileMetrics(kind: LearnerKind | null, enrolmentId: string | null): Promise<CaseFileLearnerMetrics | null> {
  if (!kind || !enrolmentId) return null;
  try {
    const metrics = await fetchLearnerMetrics(kind, enrolmentId);
    return {
      programmeCompleted: metrics.programme.completed,
      programmeTotal: metrics.programme.total,
      programmeProgress: metrics.programme.percent,
      planned: metrics.otjh.planned,
      actual: metrics.otjh.actual,
      ksbCompleted: metrics.ksb.completed,
      ksbTotal: metrics.ksb.total,
      ksbCodes: (metrics.ksb.codes || []).map((item) => item.code),
      ksbCodeProgress: (metrics.ksb.codes || []).map((item) => ({
        code: item.code,
        completed: item.completed,
        total: item.total,
      })),
      ksbProgress: metrics.ksb.percent,
      ksbStatus: metrics.ksb.status,
    };
  } catch {
    // Missing canonical metrics must not make the rest of the case file fail.
    return null;
  }
}

/** The learner's own attendance register, read through the same endpoint their
 *  workspace uses so a coach and their learner never see different rates. */
async function fetchCaseFileAttendance(kind: LearnerKind | null, enrolmentId: string | null) {
  if (!kind || !enrolmentId) return null;
  try {
    return await fetchLearnerAttendance(kind, enrolmentId);
  } catch {
    return null;
  }
}

async function fetchAnyLearnerDetail(id: string, kind?: LearnerKind) {
  if (kind) {
    return { kind, detail: await fetchLearnerDetail(kind, id) };
  }

  const [commercial, apprenticeship] = await Promise.allSettled([
    fetchLearnerDetail('commercial', id),
    fetchLearnerDetail('apprenticeship', id),
  ]);

  if (commercial.status === 'fulfilled') {
    return { kind: 'commercial' as const, detail: commercial.value };
  }
  if (apprenticeship.status === 'fulfilled') {
    return { kind: 'apprenticeship' as const, detail: apprenticeship.value };
  }

  throw chooseDetailError(commercial, apprenticeship);
}

function chooseDetailError(
  commercial: PromiseSettledResult<LearnerDetail>,
  apprenticeship: PromiseSettledResult<LearnerDetail>,
) {
  const commercialMessage = commercial.status === 'rejected' && commercial.reason instanceof Error
    ? commercial.reason.message
    : null;
  const apprenticeshipMessage = apprenticeship.status === 'rejected' && apprenticeship.reason instanceof Error
    ? apprenticeship.reason.message
    : null;

  const non404 = [commercialMessage, apprenticeshipMessage].find((message) => message && !message.includes('404'));
  return new Error(non404 || commercialMessage || apprenticeshipMessage || 'Could not load learner details.');
}

function resolveCaseloadLearner(
  caseload: CoachCaseloadLearner[],
  learnerId?: string | null,
  learnerName?: string | null,
) {
  return caseload.find((learner) => matchesLearner(learner.id, learner.name, learnerId, learnerName)) || null;
}

function resolveAttendanceLearner(
  attendance: CoachAttendanceLearner[],
  learnerId?: string | null,
  learnerName?: string | null,
) {
  return attendance.find((learner) => matchesLearner(learner.id, learner.learner, learnerId, learnerName)) || null;
}

function resolveMarkingItem(
  items: CoachMarkingQueueItem[],
  learnerId?: string | null,
  learnerName?: string | null,
) {
  return items.find((item) => matchesLearner(item.learnerId, item.learner, learnerId, learnerName)) || null;
}

function matchesLearner(
  candidateId: string | undefined,
  candidateName: string | undefined,
  learnerId?: string | null,
  learnerName?: string | null,
) {
  const normalizedId = numericId(learnerId);
  if (normalizedId && candidateId === normalizedId) {
    return true;
  }

  if (candidateId && learnerId && candidateId === learnerId.trim()) {
    return true;
  }

  // A supplied learner id is authoritative. Never cross-wire records by name
  // when the stable identity did not match.
  if (learnerId) {
    return false;
  }

  if (!learnerName || !candidateName) {
    return false;
  }

  return candidateName.trim().toLowerCase() === learnerName.trim().toLowerCase();
}

function numericId(value?: string | null) {
  if (!value) {
    return null;
  }
  return /^\d+$/.test(value.trim()) ? value.trim() : null;
}

function isUpcomingCalendarEvent(event: CoachCalendarEvent) {
  const eventDate = parseLocalDate(eventDisplayDate(event));
  if (!eventDate) {
    return false;
  }

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return eventDate.getTime() >= start.getTime();
}

function liveSessionMatchesLearner(
  event: CoachCalendarEvent,
  learnerIdentityIds: string[],
) {
  if (event.source !== 'live-session') {
    return false;
  }
  const eventIdentityIds = [event.learnerId, event.enrolmentId]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return eventIdentityIds.some(id => learnerIdentityIds.includes(id));
}

function reviewEventMatchesLearner(
  event: CoachCalendarEvent,
  learner: Pick<CoachLearnerCaseFileData, 'learnerId' | 'learnerIdentityIds'>,
) {
  if (!isReviewCalendarEvent(event) || event.status === 'cancelled') {
    return false;
  }

  const learnerIds = new Set((learner.learnerIdentityIds || [learner.learnerId])
    .map(value => String(value || '').trim())
    .filter(Boolean));
  const eventIdentityIds = [event.learnerId, event.enrolmentId]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  if (eventIdentityIds.some(id => learnerIds.has(id))) {
    return true;
  }
  return false;
}

function isReviewCalendarEvent(event: CoachCalendarEvent) {
  return event.type === 'review'
    || event.source === 'mcr'
    || event.source === 'progress-review'
    || event.source === 'review'
    || Boolean(event.reviewTemplateId);
}

function sortLearnerScheduleEvents(events: CoachCalendarEvent[]) {
  const upcoming: CoachCalendarEvent[] = [];
  const past: CoachCalendarEvent[] = [];

  for (const event of events) {
    if (isUpcomingCalendarEvent(event)) {
      upcoming.push(event);
    } else {
      past.push(event);
    }
  }

  return [...sortEvents(upcoming), ...sortEvents(past).reverse()];
}

function buildReviewMeetingItems(
  learner: Pick<CoachLearnerCaseFileData, 'learnerId' | 'learnerIdentityIds'>,
  timetableEvents: CoachCalendarEvent[],
): CaseFileReviewMeeting[] {
  const fallbackDetail = 'Review from the coach schedule.';
  const matchingEvents = sortLearnerScheduleEvents(
    timetableEvents.filter((event) => reviewEventMatchesLearner(event, learner)),
  );

  let nextFlagAssigned = false;
  return matchingEvents.map((event) => {
    const displayDate = eventDisplayDate(event);
    const isNext = !nextFlagAssigned && isUpcomingCalendarEvent(event);
    if (isNext) {
      nextFlagAssigned = true;
    }

    const source = event.source || 'review';
    const reviewTypeName = reviewTypeLabel(event);
    return {
      id: event.eventKey || event.id,
      eventKey: event.eventKey || event.id,
      reviewInstanceId: event.reviewInstanceId,
      source,
      reviewTypeName,
      title: event.title || reviewTypeName,
      date: formatCalendarDateLabel(displayDate),
      time: formatCalendarTimeLabel(event),
      detail: [
        event.sequence ? (source === 'mcr' ? `Meeting ${event.sequence}` : `Review ${event.sequence}`) : 'Additional review',
        event.meetingProvider || '',
        event.targetDate && event.scheduledDate && event.scheduledDate !== event.targetDate
          ? `Target ${formatCalendarDateLabel(event.targetDate)}`
          : '',
      ].filter(Boolean).join(' - ') || fallbackDetail,
      status: event.status,
      statusLabel: calendarStatusLabel(event.status),
      isNext,
      notes: String(event.notes || '').trim() || undefined,
    };
  });
}

function reviewTypeLabel(event: CoachCalendarEvent) {
  const metadataLabel = String(event.reviewTypeName || '').trim();
  if (metadataLabel) return metadataLabel;
  if (event.source === 'mcr') return 'Monthly Coaching Meeting';
  if (event.source === 'progress-review') return 'Progress Review';
  return 'Review';
}

function buildReviewGroups(items: CaseFileReviewMeeting[]): CaseFileReviewGroup[] {
  const groups = new Map<string, CaseFileReviewGroup>();
  for (const item of items) {
    const key = item.reviewTypeName.trim().toLowerCase() || 'review';
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        title: item.reviewTypeName || 'Review',
        items: [item],
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    const aSystemRank = reviewGroupRank(a.title);
    const bSystemRank = reviewGroupRank(b.title);
    return aSystemRank - bSystemRank || a.title.localeCompare(b.title);
  });
}

function reviewGroupRank(title: string) {
  const normalized = title.toLowerCase();
  if (normalized === 'progress review') return 0;
  if (normalized === 'monthly coaching meeting') return 1;
  if (normalized === 'review') return 99;
  return 10;
}

export function buildUpcomingSchedule(
  learnerIdentityIds: string[],
  timetableEvents: CoachCalendarEvent[],
): CaseFileUpcomingSession[] {
  if (learnerIdentityIds.length === 0) {
    return [];
  }

  return sortEvents(
    timetableEvents.filter((event) => {
      const matchesLiveSession = liveSessionMatchesLearner(event, learnerIdentityIds);
      const matchesReview = reviewEventMatchesLearner(event, {
        learnerId: learnerIdentityIds[0] || '',
        learnerIdentityIds,
      });
      return (matchesLiveSession || matchesReview)
      && isUpcomingCalendarEvent(event)
      && event.status !== 'cancelled'
      && event.status !== 'completed';
    }),
  )
    .slice(0, 3)
    .map((event) => {
      const displayDate = eventDisplayDate(event);
      const day = formatUpcomingWeekday(displayDate);
      const dayShort = formatUpcomingWeekday(displayDate, true);
      const date = formatCalendarDateLabel(displayDate);
      const dateShort = formatUpcomingDateShort(displayDate);
      const time = formatCalendarTimeLabel(event);
      const review = isReviewCalendarEvent(event);
      return {
        id: event.eventKey || event.id,
        kind: review ? 'review' : 'live',
        status: event.status,
        statusLabel: calendarStatusLabel(event.status),
        day,
        title: event.title || (review ? reviewTypeLabel(event) : event.module || 'Live session'),
        date,
        time,
        summary: `${dayShort} ${dateShort} · ${time}`,
        detail: [
          review ? reviewTypeLabel(event) : event.tutor ? `Tutor: ${event.tutor}` : '',
          event.group ? `Group: ${event.group}` : '',
        ].filter(Boolean).join(' - ') || (review ? 'Review from the coach schedule.' : 'Live session from the learner delivery plan.'),
      };
    });
}

function buildCaseFileData(args: {
  learnerId: string;
  enrolmentId: string | null;
  kind: LearnerKind | null;
  snapshot: CoachCaseloadLearner | null;
  attendance: CoachAttendanceLearner | null;
  evidence: CoachMarkingQueueItem | null;
  markingItems?: CoachMarkingQueueItem[];
  detail: LearnerDetail | null;
  caseload: CoachCaseloadLearner[];
  timetableEvents: CoachCalendarEvent[];
  reviewGenerationIssues: CoachReviewGenerationIssue[];
  reviewsLoading?: boolean;
  learnerMetrics?: CaseFileLearnerMetrics | null;
  liveAttendance?: LearnerAttendance | null;
}): CoachLearnerCaseFileData | null {
  const displayName = args.detail?.name || args.snapshot?.name || args.attendance?.learner || args.evidence?.learner || '';
  if (!displayName) {
    return null;
  }

  const cohort = args.detail?.cohort || args.snapshot?.cohortName || args.attendance?.cohort || '';
  const peers = cohort
    ? args.caseload.filter((learner) => learner.id !== args.snapshot?.id && learner.cohortName === cohort)
    : [];
  const journey = buildLearnerJourney(args.detail);
  const touchedKsbCodes = Array.from(
    new Set(
      [
        ...(args.detail?.progressKsbCodes || []),
        ...(args.detail?.quizAttempts || []).flatMap((attempt) => attempt.ksbs || []),
        ...(args.detail?.videoProgress || []).flatMap((entry) => entry.ksbs || []),
        ...(args.detail?.componentProgress || []).flatMap((entry) => entry.ksbs || []),
        ...(args.snapshot?.ksbCompletedDetails || []).map((entry) => entry.code || ''),
      ]
        .map((code) => normalizeKsbCode(code))
        .filter(Boolean),
    ),
  ).sort();
  const programme = args.detail?.programme || args.attendance?.programme || '';
  const group = args.detail?.group || args.snapshot?.group || args.attendance?.group || '';
  const email = args.detail?.email || args.snapshot?.email || args.attendance?.email || args.evidence?.email || '';
  const learnerIdentityIds = Array.from(new Set([
    args.learnerId,
    args.snapshot?.id,
    args.snapshot?.enrolmentId,
    args.attendance?.id,
    args.attendance?.enrolmentId,
    args.evidence?.learnerId,
    args.detail?.id,
  ].map(value => String(value || '').trim()).filter(Boolean)));
  const upcomingSessions = buildUpcomingSchedule(learnerIdentityIds, args.timetableEvents);
  const reviewEventContext = {
    learnerId: args.learnerId,
    learnerIdentityIds,
  };
  const allReviewMeetings = buildReviewMeetingItems(reviewEventContext, args.timetableEvents);
  const progressReviews = allReviewMeetings.filter(item => item.source === 'progress-review' || item.reviewTypeName === 'Progress Review');
  const monthlyCoachMeetings = allReviewMeetings.filter(item => item.source === 'mcr' || item.reviewTypeName === 'Monthly Coaching Meeting');
  // Use the exact programme/OTJH totals displayed by the learner dashboard.
  // The coach view must not turn the learner's whole-plan target into a
  // cumulative target-to-date or substitute OTJH progress for programme progress.
  const canonicalActual = args.learnerMetrics?.actual ?? null;
  const canonicalPlanned = args.learnerMetrics?.planned ?? null;
  const rawDetailPlanned = parseHoursValue(args.detail?.plannedHours) ?? (args.detail?.totalExpectedOtjh || null);
  const detailCompletedHours = canonicalActual ?? parseHoursValue(args.detail?.completedHours);
  const detailTargetHours = canonicalPlanned ?? parseHoursValue(args.detail?.targetHours);
  const detailPlannedHours = canonicalPlanned ?? rawDetailPlanned;
  const metricsAvailable = Boolean(args.learnerMetrics);
  const overallProgress = metricsAvailable ? args.learnerMetrics?.programmeProgress ?? null : null;

  return {
    learnerId: args.learnerId,
    enrolmentId: args.enrolmentId,
    kind: args.kind,
    snapshot: args.snapshot,
    attendance: args.attendance,
    evidence: args.evidence,
    detail: args.detail,
    journey,
    peers,
    displayName,
    initials: getInitials(displayName),
    programme,
    employer: args.detail?.employer || args.snapshot?.employer || args.attendance?.employer || '',
    cohort,
    group,
    email,
    programStatus: args.detail?.programmeStatus || args.snapshot?.rawProgramStatus || args.attendance?.programStatus || '',
    coachName: args.snapshot?.coachName || '',
    coachEmail: args.snapshot?.coachEmail || '',
    employerEmail: args.snapshot?.employerEmail || '',
    employerPhone: args.snapshot?.employerPhone || '',
    overallProgress,
    // Prefer the learner's canonical register. The coach attendance projection
    // remains a fallback so a temporary register failure does not blank the file.
    attendanceRate: args.liveAttendance?.attendanceRate ?? args.attendance?.attendance ?? null,
    attendancePresentCount: args.liveAttendance?.present ?? args.attendance?.present ?? null,
    attendanceSessionCount: args.liveAttendance?.sessions ?? args.attendance?.sessions ?? null,
    attendanceAbsentCount: args.liveAttendance?.absent ?? args.attendance?.absent ?? null,
    otjhCompleted: metricsAvailable ? detailCompletedHours ?? null : null,
    otjhTarget: metricsAvailable ? detailTargetHours ?? null : null,
    otjhPlanned: metricsAvailable ? detailPlannedHours ?? null : null,
    ksbProgress: metricsAvailable ? args.learnerMetrics?.ksbProgress ?? null : null,
    metricsAvailable,
    ksbStatus: args.learnerMetrics?.ksbStatus,
    // Counts remain available to the detailed KSB section, while the header
    // consistently uses the canonical percentage in `ksbProgress`.
    ksbEvidencedCount: args.learnerMetrics?.ksbCompleted ?? null,
    ksbTotalCount: args.learnerMetrics?.ksbTotal ?? null,
    mappedKsbCodes: args.learnerMetrics?.ksbCodes ?? [],
    ksbCodeProgress: args.learnerMetrics?.ksbCodeProgress ?? [],
    evidenceCount: args.snapshot?.evidenceCount ?? args.evidence?.totalEvidence ?? null,
    startDate: args.detail?.programmeStartDate || args.snapshot?.startDate || '--',
    gatewayReviewDate: args.snapshot?.gatewayReviewDate || '--',
    plannedEndDate: args.snapshot?.plannedEndDate || '--',
    totalExpectedOtjh: metricsAvailable ? detailPlannedHours ?? 0 : 0,
    touchedKsbCodes,
    activityItems: buildActivityItems(args.snapshot, args.detail, args.evidence),
    upcomingSessions,
    progressReviews,
    monthlyCoachMeetings,
    reviewGroups: buildReviewGroups(allReviewMeetings),
    learnerIdentityIds,
    reviewGenerationIssues: args.reviewGenerationIssues.filter(issue => learnerIdentityIds.includes(String(issue.learnerId))),
    reviewsLoading: Boolean(args.reviewsLoading),
    markingSubmissions: (args.markingItems || [])
      .filter(item => item.id && item.activityId)
      .map(item => ({
        id: String(item.id),
        activityId: String(item.activityId),
        activityTitle: String(item.activityTitle || ''),
        submittedAt: item.submittedAt || null,
      })),
    coachNotes: allReviewMeetings.map(item => item.notes || '').filter(Boolean).slice(0, 5),
  };
}

function buildActivityItems(
  snapshot: CoachCaseloadLearner | null,
  detail: LearnerDetail | null,
  evidence: CoachMarkingQueueItem | null,
) {
  const items: CaseFileActivityItem[] = [];

  if (snapshot?.startDate && snapshot.startDate !== '--') {
    items.push({
      id: 'programme-start',
      date: snapshot.startDate,
      event: 'Programme start',
      detail: `${snapshot.name} joined ${snapshot.cohortName}`,
      tone: 'primary',
    });
  }

  if (evidence?.lastSubmission && evidence.lastSubmission !== '--') {
    items.push({
      id: 'last-submission',
      date: evidence.lastSubmission,
      event: evidence.pendingEvidence > 0 ? 'Evidence awaiting review' : 'Latest evidence snapshot',
      detail: `${evidence.totalEvidence} total item(s), ${evidence.acceptedEvidence} accepted, ${evidence.referredEvidence} referred`,
      tone: evidence.pendingEvidence > 0 ? 'amber' : 'emerald',
    });
  }

  if ((detail?.activityFeed || []).length > 0) {
    for (const entry of detail?.activityFeed || []) {
      items.push({
        id: `feed-${entry.kind}-${entry.quizId ?? entry.componentId ?? entry.at}`,
        date: formatDisplayDate(entry.at),
        event: entry.action || activityEventLabel(entry),
        detail: activityDetail(entry),
        tone: activityTone(entry),
      });
    }
  } else {
    for (const attempt of sortAttemptsNewestFirst(detail?.quizAttempts || []).slice(0, 6)) {
      items.push({
        id: `quiz-${attempt.quizId}-${attempt.attempt ?? 0}-${attempt.submittedAt}`,
        date: formatDisplayDate(attempt.submittedAt),
        event: attempt.passed ? 'Quiz passed' : 'Quiz submitted',
        detail: fallbackQuizAttemptDetail(detail, attempt),
        tone: attempt.passed ? 'emerald' : 'accent',
      });
    }
  }

  return items
    .sort((a, b) => sortableDate(b.date) - sortableDate(a.date))
    .slice(0, 8);
}

function activityEventLabel(entry: LearnerActivityEntry) {
  if (entry.kind === 'quiz') {
    return entry.passed ? 'Quiz passed' : 'Quiz submitted';
  }
  if (entry.kind === 'video') {
    return 'Video watched';
  }
  return 'Activity completed';
}

function activityDetail(entry: LearnerActivityEntry) {
  const segments = [
    entry.title,
    entry.detail,
    entry.module,
    entry.week,
  ].filter((value) => Boolean(String(value || '').trim()));

  return segments.join(' - ') || 'Learner activity recorded.';
}

function activityTone(entry: LearnerActivityEntry): CaseFileActivityItem['tone'] {
  if (entry.kind === 'quiz') {
    return entry.passed ? 'emerald' : 'accent';
  }
  if (entry.kind === 'video') {
    return 'primary';
  }
  return 'amber';
}

export function fallbackQuizAttemptDetail(detail: LearnerDetail | null, attempt: LearnerQuizAttempt) {
  const title = resolveQuizAttemptTitle(detail, attempt);
  const grade = formatAttemptGrade(attempt);
  const score = formatQuizAttemptScore(attempt);
  return [title, grade, score].filter(Boolean).join(' - ');
}

export function formatAttemptGrade(attempt: LearnerQuizAttempt) {
  const rawGrade = Number(attempt.grade);
  if (Number.isNaN(rawGrade)) {
    return '--';
  }
  const percent = rawGrade <= 1 ? Math.round(rawGrade * 100) : Math.round(rawGrade);
  return `${percent}%`;
}

export function sortAttemptsNewestFirst(attempts: LearnerQuizAttempt[]) {
  return [...attempts].sort((left, right) => sortableDate(right.submittedAt) - sortableDate(left.submittedAt));
}

function sortableDate(value?: string | null) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatUpcomingWeekday(value?: string | null, short = false) {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    return '--';
  }
  return new Intl.DateTimeFormat('en-GB', { weekday: short ? 'short' : 'long' }).format(parsed);
}

function formatUpcomingDateShort(value?: string | null) {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    return '--';
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
  }).format(parsed);
}

function roundNumber(value: number) {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function buildMissingLearnerMessage(learnerId?: string | null, learnerName?: string | null) {
  if (learnerName) {
    return `Could not find ${learnerName} in the live coach data.`;
  }
  if (learnerId) {
    return `Could not find learner ${learnerId} in the live coach data.`;
  }
  return null;
}
