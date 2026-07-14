import { useEffect, useState } from 'react';
import {
  fetchLearnerDetail,
  type LearnerDetail,
  type LearnerKind,
  type LearnerQuizAttempt,
} from '@/api/learnerDetail';
import { buildLearnerJourney, type JourneyModule } from '@/utils/learnerJourney';

const CASELOAD_BASE = '/coach_api/coach/caseload';
const ATTENDANCE_BASE = '/coach_api/coach/attendance';
const MARKING_BASE = '/coach_api/coach/marking-queue';

export interface CoachCaseloadLearner {
  id: string;
  name: string;
  initials: string;
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
}

export interface CaseFileTabProps {
  data: CoachLearnerCaseFileData;
}

export function useCoachLearnerCaseFileData(args: {
  learnerId?: string | null;
  learnerName?: string | null;
  kind?: LearnerKind | null;
}) {
  const [data, setData] = useState<CoachLearnerCaseFileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const rawLearnerId = args.learnerId?.trim();
    const rawLearnerName = args.learnerName?.trim();
    let cancelled = false;

    if (!rawLearnerId && !rawLearnerName) {
      setData(null);
      setError('No learner was selected.');
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);

      const [caseloadResult, attendanceResult, markingResult] = await Promise.allSettled([
        fetchCoachCaseload(),
        fetchCoachAttendance(),
        fetchCoachMarkingQueue(),
      ]);

      if (cancelled) {
        return;
      }

      const caseload = caseloadResult.status === 'fulfilled' ? caseloadResult.value : [];
      const attendance = attendanceResult.status === 'fulfilled' ? attendanceResult.value : [];
      const marking = markingResult.status === 'fulfilled' ? markingResult.value : [];

      const snapshot = resolveCaseloadLearner(caseload, rawLearnerId, rawLearnerName);
      const attendanceLearner = resolveAttendanceLearner(attendance, rawLearnerId, rawLearnerName);
      const evidence = resolveMarkingItem(marking, rawLearnerId, rawLearnerName);
      const resolvedId = snapshot?.id || attendanceLearner?.id || evidence?.learnerId || numericId(rawLearnerId);

      let detail: LearnerDetail | null = null;
      let resolvedKind: LearnerKind | null = null;
      let detailError: string | null = null;

      if (resolvedId) {
        try {
          const detailResult = await fetchAnyLearnerDetail(resolvedId, args.kind ?? undefined);
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

      if (!detail && detailError) {
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
  }, [args.kind, args.learnerId, args.learnerName]);

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

async function request<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
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

async function fetchCoachMarkingQueue() {
  const data = await request<CoachMarkingQueueResponse>(MARKING_BASE);
  return data.items || [];
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

function buildCaseFileData(args: {
  learnerId: string;
  kind: LearnerKind | null;
  snapshot: CoachCaseloadLearner | null;
  attendance: CoachAttendanceLearner | null;
  evidence: CoachMarkingQueueItem | null;
  detail: LearnerDetail | null;
  caseload: CoachCaseloadLearner[];
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
      (args.detail?.quizAttempts || []).flatMap((attempt) => attempt.ksbs || []),
    ),
  ).sort();

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
    programme: args.detail?.programme || args.snapshot?.cohortName || args.attendance?.programme || 'Learner programme',
    employer: args.detail?.employer || args.snapshot?.employer || args.attendance?.employer || 'Employer not set',
    cohort,
    group: args.detail?.group || args.snapshot?.group || args.attendance?.group || '',
    email: args.detail?.email || args.snapshot?.email || args.attendance?.email || args.evidence?.email || '',
    programStatus: args.detail?.programmeStatus || args.snapshot?.rawProgramStatus || args.attendance?.programStatus || '',
    coachName: args.snapshot?.coachName || 'Med Maher',
    coachEmail: args.snapshot?.coachEmail || '',
    employerEmail: args.snapshot?.employerEmail || '',
    employerPhone: args.snapshot?.employerPhone || '',
    overallProgress: args.snapshot?.overallProgress ?? args.attendance?.overallProgress ?? null,
    attendanceRate: args.attendance?.attendance ?? null,
    otjhCompleted: args.snapshot?.otjhCompleted ?? args.attendance?.otjhCompleted ?? null,
    otjhTarget: args.snapshot?.otjhTarget ?? args.attendance?.otjhTarget ?? null,
    otjhPlanned: args.snapshot?.otjhPlanned ?? null,
    ksbProgress: args.snapshot?.ksbProgress ?? args.attendance?.ksbProgress ?? null,
    evidenceCount: args.snapshot?.evidenceCount ?? args.evidence?.totalEvidence ?? null,
    startDate: args.snapshot?.startDate || formatDisplayDate(args.detail?.quizAttempts[0]?.startedAt) || '--',
    gatewayReviewDate: args.snapshot?.gatewayReviewDate || '--',
    plannedEndDate: args.snapshot?.plannedEndDate || '--',
    totalExpectedOtjh: args.detail?.totalExpectedOtjh || 0,
    touchedKsbCodes,
    activityItems: buildActivityItems(args.snapshot, args.detail, args.evidence),
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

  for (const attempt of sortAttemptsNewestFirst(detail?.quizAttempts || []).slice(0, 6)) {
    items.push({
      id: `quiz-${attempt.quizId}-${attempt.attempt ?? 0}-${attempt.submittedAt}`,
      date: formatDisplayDate(attempt.submittedAt),
      event: attempt.passed ? 'Quiz passed' : 'Quiz submitted',
      detail: `${attempt.quizName} - ${attempt.grade}${attempt.Score ? ` (${attempt.Score})` : ''}`,
      tone: attempt.passed ? 'emerald' : 'accent',
    });
  }

  return items
    .sort((a, b) => sortableDate(b.date) - sortableDate(a.date))
    .slice(0, 8);
}

function sortAttemptsNewestFirst(attempts: LearnerQuizAttempt[]) {
  return [...attempts].sort((left, right) => sortableDate(right.submittedAt) - sortableDate(left.submittedAt));
}

function sortableDate(value?: string | null) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
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
