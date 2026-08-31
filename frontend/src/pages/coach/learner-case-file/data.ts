import { useEffect, useState } from 'react';
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
} from '@/pages/coach/shared/calendarEvents';
import { buildLearnerJourney, type JourneyModule } from '@/utils/learnerJourney';
import { coachFetch } from '@/lib/coachFetch';

const CASELOAD_BASE = '/coach_api/coach/caseload';
const ATTENDANCE_BASE = '/coach_api/coach/attendance';
const MARKING_BASE = '/coach_api/coach/marking-queue';

interface CoachCompletedKsbDetail {
  code: string;
  type?: string;
  description?: string;
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
  day: string;
  title: string;
  date: string;
  time: string;
  summary: string;
  detail: string;
}

export interface CaseFileReviewMeeting {
  id: string;
  title: string;
  date: string;
  time: string;
  detail: string;
  status: CoachCalendarEvent['status'];
  statusLabel: string;
  isNext: boolean;
}

export interface CoachLearnerCaseFileData {
  learnerId: string;
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
  otjhCompleted: number | null;
  otjhTarget: number | null;
  otjhPlanned: number | null;
  ksbProgress: number | null;
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

      // These are independent requests. Start learner detail immediately when the
      // URL already contains a numeric id instead of waiting for all coach-wide
      // collections first (the old flow added both request times together).
      const coachDataPromise = Promise.allSettled([
        fetchCoachCaseload(),
        fetchCoachAttendance(),
        fetchCoachMarkingQueue(rawLearnerId, rawLearnerName),
        fetchCoachTimetable(),
      ]);
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

      let detail: LearnerDetail | null = null;
      let resolvedKind: LearnerKind | null = null;
      let detailError: string | null = null;

      if (directDetailPromise) {
        try {
          const detailResult = await directDetailPromise;
          detail = detailResult.detail;
          resolvedKind = detailResult.kind;

          // Show the useful learner view as soon as its focused detail arrives.
          // Coach metrics continue enriching it in the background.
          const initialData = buildCaseFileData({
            learnerId: directId,
            kind: resolvedKind,
            snapshot: null,
            attendance: null,
            evidence: null,
            detail,
            caseload: [],
            timetableEvents: [],
          });
          if (!cancelled && initialData) {
            setData(initialData);
            setLoading(false);
          }
        } catch (loadErr) {
          detailError = loadErr instanceof Error ? loadErr.message : 'Could not load learner details.';
        }
      }

      const [caseloadResult, attendanceResult, markingResult, timetableResult] = await coachDataPromise;

      if (cancelled) {
        return;
      }

      const caseload = caseloadResult.status === 'fulfilled' ? caseloadResult.value : [];
      const attendance = attendanceResult.status === 'fulfilled' ? attendanceResult.value : [];
      const marking = markingResult.status === 'fulfilled' ? markingResult.value : [];
      const timetableEvents = timetableResult.status === 'fulfilled' ? timetableResult.value : [];

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

      if (cancelled) {
        return;
      }

      const finalData = buildCaseFileData({
        learnerId: resolvedId || rawLearnerId || '',
        kind: resolvedKind,
        snapshot,
        attendance: attendanceLearner,
        evidence,
        detail,
        caseload,
        timetableEvents,
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
  }, [args.enabled, args.kind, args.learnerId, args.learnerName, args.enrolmentId]);

  return { data, loading, error };
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
  return `${roundNumber(value)}h`;
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
  return data.events || [];
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

function normalizeMatchValue(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmailMatchValue(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizePersonName(value?: string | null) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
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
  learner: Pick<CoachLearnerCaseFileData, 'programme' | 'cohort' | 'group'>,
) {
  if (event.source !== 'live-session') {
    return false;
  }

  const learnerGroup = normalizeMatchValue(learner.group);
  const learnerCohort = normalizeMatchValue(learner.cohort);
  const learnerProgramme = normalizeMatchValue(learner.programme);
  const eventGroup = normalizeMatchValue(event.group);
  const eventCohort = normalizeMatchValue(event.cohort);
  const eventProgramme = normalizeMatchValue(event.programme);

  if (learnerGroup && eventGroup && learnerGroup === eventGroup) {
    if (learnerCohort && eventCohort && learnerCohort !== eventCohort) {
      return false;
    }
    if (learnerProgramme && eventProgramme && learnerProgramme !== eventProgramme) {
      return false;
    }
    return true;
  }

  if (!learnerGroup && learnerCohort && eventCohort && learnerCohort === eventCohort) {
    return !learnerProgramme || !eventProgramme || learnerProgramme === eventProgramme;
  }

  return false;
}

function reviewEventMatchesLearner(
  event: CoachCalendarEvent,
  learner: Pick<CoachLearnerCaseFileData, 'learnerId' | 'displayName' | 'email' | 'programme' | 'cohort'>,
  source: 'mcr' | 'progress-review',
) {
  if (event.source !== source || event.status === 'cancelled') {
    return false;
  }

  const learnerId = numericId(learner.learnerId) || String(learner.learnerId || '').trim();
  const eventLearnerId = String(event.learnerId || '').trim();
  if (learnerId && eventLearnerId && learnerId === eventLearnerId) {
    return true;
  }

  const learnerEmail = normalizeEmailMatchValue(learner.email);
  const eventEmail = normalizeEmailMatchValue(event.email);
  if (learnerEmail && eventEmail && learnerEmail === eventEmail) {
    return true;
  }

  const learnerName = normalizePersonName(learner.displayName);
  const eventLearnerName = normalizePersonName(event.learner);
  if (!learnerName || !eventLearnerName || learnerName !== eventLearnerName) {
    return false;
  }

  const learnerCohort = normalizeMatchValue(learner.cohort);
  const learnerProgramme = normalizeMatchValue(learner.programme);
  const eventCohort = normalizeMatchValue(event.cohort);
  const eventProgramme = normalizeMatchValue(event.programme);
  if (learnerCohort && eventCohort && learnerCohort !== eventCohort) {
    return false;
  }
  if (learnerProgramme && eventProgramme && learnerProgramme !== eventProgramme) {
    return false;
  }

  return true;
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
  learner: Pick<CoachLearnerCaseFileData, 'learnerId' | 'displayName' | 'email' | 'programme' | 'cohort'>,
  timetableEvents: CoachCalendarEvent[],
  source: 'mcr' | 'progress-review',
): CaseFileReviewMeeting[] {
  const fallbackTitle = source === 'progress-review' ? 'Progress Review' : 'Monthly Coaching';
  const fallbackDetail = source === 'progress-review'
    ? 'Progress review from the coach schedule.'
    : 'Monthly coaching session from the coach schedule.';
  const matchingEvents = sortLearnerScheduleEvents(
    timetableEvents.filter((event) => reviewEventMatchesLearner(event, learner, source)),
  ).slice(0, 6);

  let nextFlagAssigned = false;
  return matchingEvents.map((event) => {
    const displayDate = eventDisplayDate(event);
    const isNext = !nextFlagAssigned && isUpcomingCalendarEvent(event);
    if (isNext) {
      nextFlagAssigned = true;
    }

    return {
      id: event.eventKey || event.id,
      title: event.title || fallbackTitle,
      date: formatCalendarDateLabel(displayDate),
      time: formatCalendarTimeLabel(event),
      detail: [
        event.sequence ? (source === 'progress-review' ? `Review ${event.sequence}` : `Meeting ${event.sequence}`) : '',
        event.meetingProvider || '',
        event.targetDate && event.scheduledDate && event.scheduledDate !== event.targetDate
          ? `Target ${formatCalendarDateLabel(event.targetDate)}`
          : '',
      ].filter(Boolean).join(' - ') || fallbackDetail,
      status: event.status,
      statusLabel: calendarStatusLabel(event.status),
      isNext,
    };
  });
}

function buildUpcomingLiveSessions(
  learner: Pick<CoachLearnerCaseFileData, 'programme' | 'cohort' | 'group'>,
  timetableEvents: CoachCalendarEvent[],
): CaseFileUpcomingSession[] {
  if (!learner.group && !learner.cohort) {
    return [];
  }

  return sortEvents(
    timetableEvents.filter((event) =>
      liveSessionMatchesLearner(event, learner)
      && isUpcomingCalendarEvent(event)
      && event.status !== 'cancelled'
      && event.status !== 'completed',
    ),
  )
    .slice(0, 3)
    .map((event) => {
      const displayDate = eventDisplayDate(event);
      const day = formatUpcomingWeekday(displayDate);
      const dayShort = formatUpcomingWeekday(displayDate, true);
      const date = formatCalendarDateLabel(displayDate);
      const dateShort = formatUpcomingDateShort(displayDate);
      const time = formatCalendarTimeLabel(event);
      return {
        id: event.eventKey || event.id,
        day,
        title: event.title || event.module || 'Live session',
        date,
        time,
        summary: `${dayShort} ${dateShort} · ${time}`,
        detail: [
          event.tutor ? `Tutor: ${event.tutor}` : '',
          event.group ? `Group: ${event.group}` : '',
        ].filter(Boolean).join(' - ') || 'Live session from the learner delivery plan.',
      };
    });
}

function buildCaseFileData(args: {
  learnerId: string;
  kind: LearnerKind | null;
  snapshot: CoachCaseloadLearner | null;
  attendance: CoachAttendanceLearner | null;
  evidence: CoachMarkingQueueItem | null;
  detail: LearnerDetail | null;
  caseload: CoachCaseloadLearner[];
  timetableEvents: CoachCalendarEvent[];
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
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
  const programme = args.detail?.programme || args.attendance?.programme || '';
  const group = args.detail?.group || args.snapshot?.group || args.attendance?.group || '';
  const email = args.detail?.email || args.snapshot?.email || args.attendance?.email || args.evidence?.email || '';
  const upcomingSessions = buildUpcomingLiveSessions(
    {
      programme,
      cohort,
      group,
    },
    args.timetableEvents,
  );
  const reviewEventContext = {
    learnerId: args.learnerId,
    displayName,
    email,
    programme,
    cohort,
  };
  const progressReviews = buildReviewMeetingItems(reviewEventContext, args.timetableEvents, 'progress-review');
  const monthlyCoachMeetings = buildReviewMeetingItems(reviewEventContext, args.timetableEvents, 'mcr');
  const detailCompletedHours = parseHoursValue(args.detail?.completedHours);
  const detailTargetHours = parseHoursValue(args.detail?.targetHours);
  const detailPlannedHours = parseHoursValue(args.detail?.plannedHours) ?? (args.detail?.totalExpectedOtjh || null);

  return {
    learnerId: args.learnerId,
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
    overallProgress: args.snapshot?.overallProgress ?? args.attendance?.overallProgress ?? null,
    attendanceRate: args.attendance?.attendance ?? null,
    otjhCompleted: detailCompletedHours ?? args.snapshot?.otjhCompleted ?? args.attendance?.otjhCompleted ?? null,
    otjhTarget: detailTargetHours ?? args.snapshot?.otjhTarget ?? args.attendance?.otjhTarget ?? null,
    otjhPlanned: detailPlannedHours ?? args.snapshot?.otjhPlanned ?? null,
    ksbProgress: args.snapshot?.ksbProgress ?? args.attendance?.ksbProgress ?? null,
    evidenceCount: args.snapshot?.evidenceCount ?? args.evidence?.totalEvidence ?? null,
    startDate: args.snapshot?.startDate || formatDisplayDate(args.detail?.quizAttempts[0]?.startedAt) || '--',
    gatewayReviewDate: args.snapshot?.gatewayReviewDate || '--',
    plannedEndDate: args.snapshot?.plannedEndDate || '--',
    totalExpectedOtjh: detailPlannedHours ?? args.snapshot?.otjhPlanned ?? 0,
    touchedKsbCodes,
    activityItems: buildActivityItems(args.snapshot, args.detail, args.evidence),
    upcomingSessions,
    progressReviews,
    monthlyCoachMeetings,
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
