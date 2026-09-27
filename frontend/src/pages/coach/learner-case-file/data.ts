import { useCallback, useEffect, useState } from 'react';
import { formatHoursMinutes } from '@/lib/format';
import {
  type LearnerActivityEntry,
  type LearnerDetail,
  type LearnerKind,
  type LearnerQuizAttempt,
} from '@/api/learnerDetail';
import {
  eventDisplayDate,
  formatDateLabel as formatCalendarDateLabel,
  formatTimeLabel as formatCalendarTimeLabel,
  parseLocalDate,
  sortEvents,
  statusLabel as calendarStatusLabel,
  type CoachCalendarEvent,
  type CoachReviewGenerationIssue,
} from '@/pages/coach/shared/calendarEvents';
import { buildLearnerJourney } from '@/utils/learnerJourney';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { buildCaseFileActivityStates, buildFullCaseFileJourney } from './activityState';
import { normalizeKsbCode } from './domain/ksbSelectors';
import {
  fetchCaseFileLearnerDetail,
  fetchCaseFileLearnerMetrics,
  fetchCaseFileShell,
  fetchCaseFileStudentActivity,
  type CaseFileShell,
} from './api/caseFileApi';
import type {
  CaseFileActivityItem,
  CaseFileOtjhMetrics,
  CaseFileReviewGroup,
  CaseFileReviewMeeting,
  CaseFileUpcomingSession,
  CoachAttendanceLearner,
  CoachCaseloadLearner,
  CoachLearnerCaseFileData,
  CoachMarkingQueueItem,
} from './types';

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
    let cancelled = false;

    if (args.enabled === false) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (!rawLearnerId) {
      setData(null);
      setError('No learner was selected.');
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);

      const directId = numericId(rawLearnerId);
      if (!directId) {
        setData(null);
        setError('A stable learner ID is required.');
        setLoading(false);
        return;
      }
      let shell: CaseFileShell;
      try {
        shell = await fetchCaseFileShell(directId);
      } catch (loadErr) {
        if (!cancelled) {
          setData(null);
          setError(loadErr instanceof Error ? loadErr.message : 'Could not load learner case file details.');
          setLoading(false);
        }
        return;
      }
      const resolvedEnrolmentId = shell.identity.enrolmentId;
      const resolvedKind = shell.identity.kind;
      let learnerMetrics: CaseFileLearnerMetrics | null = null;
      let detail: LearnerDetail | null = null;
      let detailError: string | null = null;
      let aptemActivity: StudentActivityResponse | null = null;
      if (resolvedEnrolmentId) {
        try {
          const detailResult = await fetchAnyLearnerDetail(resolvedEnrolmentId, resolvedKind);
          detail = detailResult.detail;
          if (detail.studentActivityAvailable) {
            aptemActivity = await fetchCaseFileStudentActivity(resolvedKind, resolvedEnrolmentId).catch(() => null);
          }
          learnerMetrics = await fetchCaseFileMetrics(resolvedKind, resolvedEnrolmentId);
          const initialData = buildCaseFileData({
            learnerId: shell.identity.learnerId,
            enrolmentId: resolvedEnrolmentId,
            kind: resolvedKind,
            shell,
            snapshot: null,
            attendance: null,
            evidence: null,
            detail,
            aptemActivity,
            timetableEvents: [],
            reviewGenerationIssues: [],
            reviewsLoading: true,
            learnerMetrics,
          });
          if (!cancelled && initialData) {
            setData(initialData);
            setLoading(false);
          }
        } catch (loadErr) {
          detailError = loadErr instanceof Error ? loadErr.message : 'Could not load learner details.';
        }
      }

      if (cancelled) {
        return;
      }

      if (cancelled) {
        return;
      }

      const finalData = buildCaseFileData({
        learnerId: shell.identity.learnerId,
        enrolmentId: resolvedEnrolmentId,
        kind: resolvedKind,
        shell,
        snapshot: null,
        attendance: null,
        evidence: null,
        detail,
        aptemActivity,
        timetableEvents: [],
        reviewGenerationIssues: [],
        reviewsLoading: false,
        learnerMetrics,
      });

      if (!finalData) {
        setData(null);
        setError(
          detailError
            || buildMissingLearnerMessage(rawLearnerId, null)
            || 'Could not find that learner in the connected coach data.',
        );
        setLoading(false);
        return;
      }

      setData(finalData);

      const missingDetailOnly = Boolean(detailError && /learner not found|\b404\b/i.test(detailError));
      if (!detail && detailError && !missingDetailOnly) {
        setError(detailError);
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
    const metrics = await fetchCaseFileLearnerMetrics(kind, enrolmentId);
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

async function fetchAnyLearnerDetail(id: string, kind?: LearnerKind) {
  if (kind) {
    return { kind, detail: await fetchCaseFileLearnerDetail(kind, id) };
  }

  const [commercial, apprenticeship] = await Promise.allSettled([
    fetchCaseFileLearnerDetail('commercial', id),
    fetchCaseFileLearnerDetail('apprenticeship', id),
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

export function buildReviewMeetingItems(
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
      plannedDate: formatCalendarDateLabel(event.targetDate || event.scheduledDate),
      completedDate: event.status === 'completed'
        ? formatCalendarDateLabel(event.reviewCompletedAt || displayDate)
        : '--',
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
      reviewer: String(event.reviewerName || event.ownerName || '').trim() || '--',
      hasForm: Boolean(event.hasReviewForm ?? event.reviewInstanceId),
      hasTranscript: Boolean(event.hasTranscript),
      hasAttendance: Boolean(event.hasAttendance),
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

export function buildReviewGroups(items: CaseFileReviewMeeting[]): CaseFileReviewGroup[] {
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
  shell: CaseFileShell;
  snapshot: CoachCaseloadLearner | null;
  attendance: CoachAttendanceLearner | null;
  evidence: CoachMarkingQueueItem | null;
  detail: LearnerDetail | null;
  aptemActivity?: StudentActivityResponse | null;
  timetableEvents: CoachCalendarEvent[];
  reviewGenerationIssues: CoachReviewGenerationIssue[];
  reviewsLoading?: boolean;
  learnerMetrics?: CaseFileLearnerMetrics | null;
}): CoachLearnerCaseFileData | null {
  const displayName = args.detail?.name || args.shell.profile.name || args.attendance?.learner || args.evidence?.learner || '';
  if (!displayName) {
    return null;
  }

  const cohort = args.detail?.cohort || args.shell.profile.cohort || args.attendance?.cohort || '';
  const peers: CoachCaseloadLearner[] = [];
  const journey = buildFullCaseFileJourney(buildLearnerJourney(args.detail), args.aptemActivity || null);
  const activityStates = buildCaseFileActivityStates(journey, args.detail, args.aptemActivity || null);
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
  const group = args.detail?.group || args.shell.profile.group || args.attendance?.group || '';
  const email = args.detail?.email || args.shell.profile.email || args.attendance?.email || args.evidence?.email || '';
  const learnerIdentityIds = Array.from(new Set([
    args.learnerId,
    args.shell.identity.enrolmentId,
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
    activityStates,
    peers,
    displayName,
    initials: getInitials(displayName),
    programme: programme || args.shell.profile.programme || '',
    employer: args.detail?.employer || args.shell.profile.employer || args.attendance?.employer || '',
    cohort,
    group,
    email,
    programStatus: args.detail?.programmeStatus || args.shell.profile.status || args.attendance?.programStatus || '',
    coachName: args.shell.profile.coachName || '',
    coachEmail: args.shell.profile.coachEmail || '',
    coachRag: args.shell.profile.coachRag,
    employerEmail: '',
    employerPhone: '',
    overallProgress,
    // Prefer the learner's canonical register. The coach attendance projection
    // remains a fallback so a temporary register failure does not blank the file.
    attendanceRate: null,
    attendancePresentCount: null,
    attendanceSessionCount: null,
    attendanceAbsentCount: null,
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
    startDate: args.detail?.programmeStartDate || args.shell.profile.startDate || '--',
    gatewayReviewDate: args.shell.profile.gatewayReviewDate || '--',
    plannedEndDate: args.detail?.programmeEndDate || args.shell.profile.plannedEndDate || '--',
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
