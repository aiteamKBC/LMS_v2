import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { fetchSharedJsonGet } from '@/lib/sharedGetJson';
import { setCoachViewAs, withCoachViewAs } from '@/lib/coachViewAs';
import { useAuth } from '@/hooks/useAuth';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { CoachDirectoryPicker } from './CoachDirectoryPicker';
import { AllCoachesCalendar } from './AllCoachesCalendar';
import { DashboardMeetingActions } from './DashboardMeetingActions';
import type { DirectoryCoach } from '@/api/coachDirectory';
import { cn } from '@/lib/cn';
import { ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import styles from './dashboard.module.css';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { FilterChip } from '@/components/ui/FilterToolbar';
import type { ImportedReview } from '@/api/reviewHistory';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import {
  type CoachCalendarEvent,
  eventDisplayDate,
  eventTargetDate,
  eventPeriodLabel,
  formatDateLabel,
  formatTimeLabel,
  formatTimeRangeLabel,
  isAtRiskEvent,
  currentWeekRange,
  isCompletedEvent,
  isEventThisWeek,
  needsScheduling,
  parseLocalDate,
  sortEvents,
  startOfDay,
  statusLabel,
} from '../../coach/shared/calendarEvents';

const coachNav = roleNavMap.coach;

type DashboardKpi = 'caseload' | 'active' | 'on-break' | 'on-track' | 'at-risk' | 'need-attention' | 'completed' | 'epa' | 'evidence' | 'reviews';
type OtjhStatusKey = 'at-risk' | 'need-attention' | 'on-track' | 'unknown';
type PerformanceStatus = 'on-track' | 'at-risk' | 'high' | 'new-starter';
type ScheduleStatus = 'upcoming' | 'overdue' | 'needs-schedule' | 'none';

const EMPTY_VALUE = '--';
const AT_RISK_SCROLL_THRESHOLD = 8;
const COACHING_CALENDAR_WINDOW_DAYS = 7;

function coachDashboardEndpoint() {
  return '/coach_api/coach/dashboard';
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface CoachLearner {
  id: string;
  name: string;
  initials: string;
  /** 'commercial' | 'apprenticeship' — which learner_detail table this id resolves against. */
  learnerType?: 'commercial' | 'apprenticeship';
  aptemId?: string | null;
  /** enrolment."Created_users".id -- a different, disjoint pk space from `id`
   *  above. /learner-detail/ needs this one, not the LearnerProfile id. */
  enrolmentId?: string | null;
  /** Which module/week otjhTarget's cumulative-to-date figure currently falls in. */
  currentModule?: string | null;
  currentWeek?: string | null;
  componentsTargetToDate?: number | null;
  programme: string;
  cohortName?: string | null;
  group: string;
  employer: string;
  avatar: string;
  status: PerformanceStatus;
  riskFlags: string[];
  overallProgress: number;
  overallProgressAvailable?: boolean;
  attendanceRate: number;
  attendanceRateAvailable?: boolean;
  otjhCompleted: number;
  otjhTarget: number;
  otjhStatus?: string | null;
  ksbProgress: number;
  ksbProgressAvailable?: boolean;
  /** Distinct KSB codes evidenced in the audit mapping. A count, not a
   *  percentage -- the mapping spans several standards, so it carries no
   *  per-learner denominator. Matches the learner's own workspace. */
  ksbEvidencedCount?: number | null;
  evidenceCount: number;
  evidenceCountAvailable?: boolean;
  evidenceCompletedCount: number;
  nextCoaching: string;
  nextCoachingStatus?: ScheduleStatus;
  nextReview: string;
  nextReviewStatus?: ScheduleStatus;
  lastContact: string;
  recentFlag: string | null;
  email?: string | null;
  rawProgramStatus?: string | null;
  mcmReviews: ImportedReview[];
  reviews: ImportedReview[];
}

interface CaseloadApiLearner extends Partial<CoachLearner> {
  cohortName?: string | null;
}

interface CaseloadApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CaseloadApiLearner[];
}

interface CoachAssignedGroup {
  id: string;
  name: string;
  programmeId?: string;
  programme: string;
  cohortId?: string;
  cohort: string;
  coach: string;
  status: string;
  schedule: string;
  startDate?: string;
  endDate?: string;
}

interface CoachDashboardApiResponse extends CaseloadApiResponse {
  attendance?: AttendanceApiResponse;
  reviewHistory?: {
    learners?: ReviewHistoryApiLearner[];
  };
  timetable?: {
    events?: CoachCalendarEvent[];
  };
  evidence?: MarkingQueueResponse;
  assignedGroups?: CoachAssignedGroup[];
  errors?: Record<string, string>;
}

interface AttendanceApiLearner {
  id: string;
  learner: string;
  email?: string | null;
  attendance: number | null;
  hasAttendance?: boolean;
  lastSession?: string | null;
  lastSessionDate?: string | null;
}

interface AttendanceApiResponse {
  learners?: AttendanceApiLearner[];
}

interface ReviewHistoryApiLearner {
  id: string;
  aptemId?: string | null;
  mcm?: ImportedReview[];
  reviews?: ImportedReview[];
}

function displayValue(value?: string | number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const text = String(value).trim();
  if (!text || text === EMPTY_VALUE || text === '—') return EMPTY_VALUE;
  return text;
}

function optionalDisplayValue(value?: string | number | null): string | undefined {
  const text = displayValue(value);
  return text === EMPTY_VALUE ? undefined : text;
}

function normalizeIdentity(value?: string | number | null): string {
  return displayValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}



function toNumber(value?: number | string | null): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function clampPercent(value?: number | string | null): number {
  return Math.max(0, Math.min(100, Math.round(toNumber(value))));
}

function statusFromApi(value?: string | null): PerformanceStatus {
  if (value === 'at-risk' || value === 'high' || value === 'new-starter') return value;
  return 'on-track';
}

function isVisibleRiskFlag(value?: string | null) {
  const normalized = displayValue(value).toLowerCase();
  return normalized !== EMPTY_VALUE
    && !normalized.startsWith('variance')
    && normalized !== 'otjh at risk';
}

function normalizeOtjhStatus(value?: string | null): OtjhStatusKey {
  const normalized = displayValue(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'atrisk') return 'at-risk';
  if (normalized === 'needattention' || normalized === 'needsattention') return 'need-attention';
  if (normalized === 'ontrack') return 'on-track';
  return 'unknown';
}

interface EvidenceQueueLearner {
  id: string;
  learnerId: string;
  learner: string;
  initials: string;
  email?: string | null;
  programme: string;
  group: string;
  pendingEvidence: number;
  acceptedEvidence: number;
  referredEvidence: number;
  totalEvidence: number;
  lastSubmission: string;
  lastSubmissionIso?: string | null;
  isOverdue: boolean;
}

interface MarkingQueueResponse {
  items?: Partial<EvidenceQueueLearner>[];
  summary?: {
    pendingItems?: number;
  };
}

function isActiveLearner(learner: CoachLearner): boolean {
  return displayValue(learner.rawProgramStatus).toLowerCase().replace(/\s+/g, '') === 'active';
}

function normalizedProgramStatus(learner: CoachLearner): string {
  return displayValue(learner.rawProgramStatus).toLowerCase().replace(/[\s_-]+/g, '');
}

function isOnBreakLearner(learner: CoachLearner): boolean {
  return normalizedProgramStatus(learner).includes('break');
}

// Finished the programme. Matched on the canonical "Completed" status from
// learner_api.constants, the value enrolment actually writes -- unlike the
// gateway stage this replaced, which was never a programme status the platform
// set, so that card could only ever read zero.
function isCompletedLearner(learner: CoachLearner): boolean {
  return normalizedProgramStatus(learner) === 'completed';
}

function isEpaLearner(learner: CoachLearner): boolean {
  return normalizedProgramStatus(learner) === 'epa';
}

const OTJH_STATUS_META: Record<OtjhStatusKey, { label: string; sub: string; tone: StatusTone }> = {
  'at-risk': { label: 'OTJH at risk', sub: 'OTJH at risk', tone: 'critical' },
  'need-attention': { label: 'Need Attention', sub: 'Needs support', tone: 'caution' },
  'on-track': { label: 'On Track', sub: 'On target', tone: 'positive' },
  unknown: { label: EMPTY_VALUE, sub: 'No OTJH status', tone: 'neutral' },
};

function normalizeLearner(learner: CaseloadApiLearner, index: number): CoachLearner {
  const name = displayValue(learner.name);
  const fallbackName = name === EMPTY_VALUE ? `Learner ${index + 1}` : name;
  const initials = displayValue(learner.initials);
  const id = displayValue(learner.id);
  const programme = displayValue(learner.programme) === EMPTY_VALUE ? displayValue(learner.cohortName) : displayValue(learner.programme);
  const cohortName = displayValue(learner.cohortName);
  const riskFlags = Array.isArray(learner.riskFlags) ? learner.riskFlags.filter(isVisibleRiskFlag) : [];
  const recentFlag = isVisibleRiskFlag(learner.recentFlag) && !riskFlags.includes(String(learner.recentFlag))
    ? String(learner.recentFlag)
    : null;

  return {
    id: id === EMPTY_VALUE ? `learner-${index}` : id,
    name: fallbackName,
    initials: initials === EMPTY_VALUE ? fallbackName.slice(0, 2).toUpperCase() : initials,
    learnerType: learner.learnerType,
    enrolmentId: learner.enrolmentId,
    currentModule: learner.currentModule,
    currentWeek: learner.currentWeek,
    componentsTargetToDate: learner.componentsTargetToDate,
    programme,
    cohortName: cohortName === EMPTY_VALUE ? null : cohortName,
    group: displayValue(learner.group),
    employer: displayValue(learner.employer),
    avatar: displayValue(learner.avatar),
    status: statusFromApi(learner.status),
    riskFlags,
    overallProgress: clampPercent(learner.overallProgress),
    overallProgressAvailable: learner.overallProgressAvailable,
    attendanceRate: 0,
    attendanceRateAvailable: false,
    otjhCompleted: toNumber(learner.otjhCompleted),
    otjhTarget: Math.max(toNumber(learner.otjhTarget), 0),
    otjhStatus: displayValue(learner.otjhStatus),
    ksbProgress: clampPercent(learner.ksbProgress),
    ksbProgressAvailable: learner.ksbProgressAvailable,
    ksbEvidencedCount: learner.ksbEvidencedCount ?? null,
    evidenceCount: toNumber(learner.evidenceCount),
    evidenceCountAvailable: learner.evidenceCountAvailable,
    evidenceCompletedCount: toNumber(learner.evidenceCompletedCount),
    nextCoaching: displayValue(learner.nextCoaching),
    nextCoachingStatus: 'none',
    nextReview: displayValue(learner.nextReview),
    nextReviewStatus: 'none',
    lastContact: displayValue(learner.lastContact),
    recentFlag,
    email: learner.email || null,
    rawProgramStatus: learner.rawProgramStatus || null,
    mcmReviews: [],
    reviews: [],
  };
}

/** KSB as the learner's own workspace shows it: the number of distinct codes
 *  evidenced. Falls back to the curriculum percentage for learners with no
 *  audit mapping, and to "--" when neither figure exists. */
function ksbCellValue(learner: CoachLearner): string {
  if (learner.ksbEvidencedCount != null) return `${learner.ksbEvidencedCount}`;
  return learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE;
}


function findAttendanceRecord(learner: CoachLearner, attendanceLearners: AttendanceApiLearner[]) {
  const learnerId = normalizeIdentity(learner.id);
  const learnerEmail = normalizeIdentity(learner.email);
  const learnerName = normalizeIdentity(learner.name);

  return attendanceLearners.find((attendance) => {
    const attendanceId = normalizeIdentity(attendance.id);
    const attendanceEmail = normalizeIdentity(attendance.email);
    const attendanceName = normalizeIdentity(attendance.learner);

    return Boolean(
      (learnerId && attendanceId && learnerId === attendanceId)
      || (learnerEmail && attendanceEmail && learnerEmail === attendanceEmail)
      || (learnerName && attendanceName && learnerName === attendanceName),
    );
  });
}

function mergeAttendanceRates(learners: CoachLearner[], attendanceLearners: AttendanceApiLearner[]): CoachLearner[] {
  return learners.map((learner): CoachLearner => {
    const attendance = findAttendanceRecord(learner, attendanceLearners);
    const lastSession = displayValue(attendance?.lastSession);
    const hasAttendance = Boolean(
      attendance
      && attendance.attendance !== null
      && attendance.attendance !== undefined
      && attendance.hasAttendance !== false,
    );

    return {
      ...learner,
      attendanceRate: hasAttendance ? clampPercent(attendance?.attendance) : 0,
      attendanceRateAvailable: hasAttendance,
      // `lastContact` in the caseload payload currently carries the case-owner
      // name. Attendance owns the latest recorded session date, which is what
      // this dashboard column is intended to show.
      lastContact: lastSession !== EMPTY_VALUE
        ? lastSession
        : formatDateLabel(attendance?.lastSessionDate),
    };
  });
}

function mergeReviewHistory(learners: CoachLearner[], historyLearners: ReviewHistoryApiLearner[]): CoachLearner[] {
  const byId = new Map(
    historyLearners
      .map((item) => [normalizeIdentity(item.id), item] as const)
      .filter(([id]) => Boolean(id)),
  );

  return learners.map((learner) => {
    const history = byId.get(normalizeIdentity(learner.id));
    if (!history) return learner;
    return {
      ...learner,
      aptemId: history.aptemId || null,
      mcmReviews: Array.isArray(history.mcm) ? history.mcm : [],
      reviews: Array.isArray(history.reviews) ? history.reviews : [],
    };
  });
}

function mergeEvidenceQueueIntoLearners(learners: CoachLearner[], queue: EvidenceQueueLearner[]): CoachLearner[] {
  const byId = new Map<string, EvidenceQueueLearner>();
  const byEmail = new Map<string, EvidenceQueueLearner>();
  const byName = new Map<string, EvidenceQueueLearner>();

  queue.forEach((item) => {
    const learnerId = normalizeIdentity(item.learnerId || item.id);
    const learnerEmail = normalizeIdentity(item.email);
    const learnerName = normalizeIdentity(item.learner);
    if (learnerId) byId.set(learnerId, item);
    if (learnerEmail) byEmail.set(learnerEmail, item);
    if (learnerName) byName.set(learnerName, item);
  });

  return learners.map((learner) => {
    const match = byId.get(normalizeIdentity(learner.id))
      || byEmail.get(normalizeIdentity(learner.email))
      || byName.get(normalizeIdentity(learner.name));
    if (!match) return learner;
    return {
      ...learner,
      evidenceCount: toNumber(match.pendingEvidence),
      evidenceCountAvailable: true,
      evidenceCompletedCount: toNumber(match.acceptedEvidence),
    };
  });
}

function normalizeEvidenceQueueLearner(item: Partial<EvidenceQueueLearner>, index: number): EvidenceQueueLearner {
  const learnerName = displayValue(item.learner);
  const fallbackName = learnerName === EMPTY_VALUE ? `Learner ${index + 1}` : learnerName;
  const learnerId = displayValue(item.learnerId || item.id);

  return {
    id: learnerId === EMPTY_VALUE ? `evidence-${index}` : learnerId,
    learnerId: learnerId === EMPTY_VALUE ? `evidence-${index}` : learnerId,
    learner: fallbackName,
    initials: displayValue(item.initials) === EMPTY_VALUE ? fallbackName.slice(0, 2).toUpperCase() : displayValue(item.initials),
    email: item.email || null,
    programme: displayValue(item.programme),
    group: displayValue(item.group),
    pendingEvidence: toNumber(item.pendingEvidence),
    acceptedEvidence: toNumber(item.acceptedEvidence),
    referredEvidence: toNumber(item.referredEvidence),
    totalEvidence: toNumber(item.totalEvidence),
    lastSubmission: displayValue(item.lastSubmission),
    lastSubmissionIso: item.lastSubmissionIso || null,
    isOverdue: Boolean(item.isOverdue),
  };
}

function eventMatchesLearner(event: CoachCalendarEvent, learner: CoachLearner) {
  const eventLearnerId = displayValue(event.learnerId);
  const learnerId = displayValue(learner.id);
  if (eventLearnerId !== EMPTY_VALUE && eventLearnerId === learnerId) return true;

  const eventEmail = displayValue(event.email).toLowerCase();
  const learnerEmail = displayValue(learner.email).toLowerCase();
  if (eventEmail !== EMPTY_VALUE && learnerEmail !== EMPTY_VALUE && eventEmail === learnerEmail) return true;

  return displayValue(event.learner).toLowerCase() === learner.name.toLowerCase();
}

function learnerIdentityIndex(learners: CoachLearner[]) {
  const learnerIds = new Set<string>();
  const learnerEmails = new Set<string>();
  const learnerNames = new Set<string>();

  learners.forEach((learner) => {
    const learnerId = displayValue(learner.id);
    const learnerEmail = displayValue(learner.email).toLowerCase();
    const learnerName = displayValue(learner.name).toLowerCase();
    if (learnerId !== EMPTY_VALUE) learnerIds.add(learnerId);
    if (learnerEmail !== EMPTY_VALUE) learnerEmails.add(learnerEmail);
    if (learnerName !== EMPTY_VALUE) learnerNames.add(learnerName);
  });

  return { learnerIds, learnerEmails, learnerNames };
}

function eventMatchesLearnerIndex(
  event: CoachCalendarEvent,
  index: ReturnType<typeof learnerIdentityIndex>,
) {
  const eventLearnerId = displayValue(event.learnerId);
  if (eventLearnerId !== EMPTY_VALUE && index.learnerIds.has(eventLearnerId)) return true;

  const eventEmail = displayValue(event.email).toLowerCase();
  if (eventEmail !== EMPTY_VALUE && index.learnerEmails.has(eventEmail)) return true;

  const learnerName = displayValue(event.learner).toLowerCase();
  return learnerName !== EMPTY_VALUE && index.learnerNames.has(learnerName);
}

function scheduleDateForEvent(event: CoachCalendarEvent): { value: string; status: Exclude<ScheduleStatus, 'none'>; time: number } | null {
  const displayValue = eventDisplayDate(event);
  const targetValue = eventTargetDate(event);
  const displayDate = parseLocalDate(displayValue);
  const targetDate = parseLocalDate(targetValue);
  const eventDate = event.status === 'not-scheduled'
    ? targetDate || displayDate
    : displayDate || targetDate;
  const eventValue = event.status === 'not-scheduled'
    ? targetValue || displayValue
    : displayValue || targetValue;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (event.status === 'not-scheduled') {
    return eventDate && eventValue
      ? { value: eventValue, status: 'needs-schedule', time: eventDate.getTime() }
      : null;
  }

  if (displayDate && displayDate.getTime() >= start.getTime()) {
    return { value: displayValue, status: 'upcoming', time: displayDate.getTime() };
  }

  if (targetDate && targetDate.getTime() >= start.getTime()) {
    return { value: targetValue, status: 'upcoming', time: targetDate.getTime() };
  }

  const fallbackDate = displayDate || targetDate;
  const fallbackValue = displayDate ? displayValue : targetValue;
  if (!fallbackDate || !fallbackValue) {
    return null;
  }

  return { value: fallbackValue, status: 'overdue', time: fallbackDate.getTime() };
}

function nextEventSummaryForLearner(
  events: CoachCalendarEvent[],
  learner: CoachLearner,
  source: string,
): { label: string; status: ScheduleStatus } {
  const matches = events
    .filter(event => (
      event.source === source &&
      eventMatchesLearner(event, learner) &&
      !isCompletedEvent(event) &&
      event.status !== 'cancelled'
    ))
    .map(event => ({ event, schedule: scheduleDateForEvent(event) }))
    .filter((entry): entry is { event: CoachCalendarEvent; schedule: Exclude<ReturnType<typeof scheduleDateForEvent>, null> } => Boolean(entry.schedule))
    .sort((left, right) => {
      if (left.schedule.status !== right.schedule.status) {
        return left.schedule.status === 'upcoming' ? -1 : 1;
      }
      return left.schedule.status === 'upcoming'
        ? left.schedule.time - right.schedule.time
        : right.schedule.time - left.schedule.time;
    });

  const match = matches[0]?.schedule;
  return {
    label: match ? formatDateLabel(match.value) : EMPTY_VALUE,
    status: match?.status || 'none',
  };
}

function enrichLearnerSchedule(learners: CoachLearner[], events: CoachCalendarEvent[]): CoachLearner[] {
  return learners.map((learner): CoachLearner => {
    const nextMonthlyCoaching = nextEventSummaryForLearner(events, learner, 'mcr');
    const nextProgressReview = nextEventSummaryForLearner(events, learner, 'progress-review');
    return {
      ...learner,
      nextCoaching: nextMonthlyCoaching.label,
      nextCoachingStatus: nextMonthlyCoaching.status,
      nextReview: nextProgressReview.label,
      nextReviewStatus: nextProgressReview.status,
    };
  });
}

function isWithinNextDays(event: CoachCalendarEvent, daysAhead: number) {
  const date = parseLocalDate(eventDisplayDate(event));
  if (!date || isCompletedEvent(event)) return false;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + daysAhead);
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function isFutureCalendarEvent(event: CoachCalendarEvent) {
  const date = parseLocalDate(eventDisplayDate(event));
  if (!date) return false;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return date.getTime() >= start.getTime();
}

function isWithinCalendarPreviewWindow(event: CoachCalendarEvent) {
  return isWithinNextDays(event, COACHING_CALENDAR_WINDOW_DAYS - 1);
}

function upcomingLiveSessionTimeLabel(event: CoachCalendarEvent) {
  if (event.timeLabel && event.timeLabel !== 'Time TBC') {
    return event.timeLabel;
  }
  if (event.scheduledTime) {
    return event.scheduledTime.slice(0, 5);
  }
  return 'Time TBC';
}

function upcomingLiveSessionMetaLabel(event: CoachCalendarEvent) {
  return [
    optionalDisplayValue(event.programme),
    optionalDisplayValue(event.cohort),
    optionalDisplayValue(event.group || event.learner),
  ].filter(Boolean).join(' · ') || EMPTY_VALUE;
}

function buildTimetableFocusState(event: CoachCalendarEvent) {
  return {
    focusEvent: {
      source: event.source || event.type,
      eventKey: optionalDisplayValue(event.eventKey || event.id),
      date: optionalDisplayValue(eventDisplayDate(event)),
      title: optionalDisplayValue(event.title),
      scheduledTime: event.scheduledTime ? event.scheduledTime.slice(0, 5) : undefined,
      programme: optionalDisplayValue(event.programme),
      cohort: optionalDisplayValue(event.cohort),
      group: optionalDisplayValue(event.location || event.group),
    },
  };
}

function formatCalendarMonth(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(date).toUpperCase();
}

function formatCalendarDayNumber(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit' }).format(date);
}

function formatCalendarWeekday(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date).toUpperCase();
}

function formatUpcomingLiveSessionDayLabel(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return EMPTY_VALUE;
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(startOfToday);
  tomorrow.setDate(startOfToday.getDate() + 1);
  if (targetDate.getTime() === startOfToday.getTime()) return 'Today';
  if (targetDate.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return formatDateLabel(value);
}

function eventTypeLabel(event: CoachCalendarEvent) {
  if (event.source === 'progress-review') return eventPeriodLabel(event);
  if (event.source === 'mcr') return 'Monthly Coaching';
  return displayValue(event.title);
}


/* ═══════════════════════════════════════════════════════════
   Priority model
   ───────────────────────────────────────────────────────────
   One ordered list decides who a coach opens first:
     At Risk → Overdue Review → Poor Attendance → Missing Evidence
   Every reason is derived from a field the dashboard API already returns, so
   the badge on a row and the count on a tab can never disagree, and the answer
   to "why?" travels with the verdict instead of being re-guessed per panel.
   ═══════════════════════════════════════════════════════════ */
type PriorityKey = 'at-risk' | 'overdue-review' | 'poor-attendance' | 'missing-evidence';

const PRIORITY_ORDER: PriorityKey[] = ['at-risk', 'overdue-review', 'poor-attendance', 'missing-evidence'];

const PRIORITY_RANK: Record<PriorityKey, number> = {
  'at-risk': 0,
  'overdue-review': 1,
  'poor-attendance': 2,
  'missing-evidence': 3,
};

// The priority vocabulary is five ranked reasons; StatusTone carries risk in
// four bands. `at-risk` and `overdue-review` both read as `critical` — both are
// "act now" severities, and the label text (not a second red shade) is what
// tells them apart.
interface PriorityReason {
  key: PriorityKey;
  label: string;
  detail?: string;
}

interface LearnerPriority {
  reasons: PriorityReason[];
  primary: PriorityReason | null;
  keys: Set<PriorityKey>;
  /** Sort weight, highest = open this learner first. */
  urgency: number;
}

interface OverdueSignal {
  review: boolean;
  coaching: boolean;
  label: string;
}

function otjhPercentFor(learner: CoachLearner): number | null {
  return learner.otjhTarget > 0 ? clampPercent((learner.otjhCompleted / learner.otjhTarget) * 100) : null;
}

/** Scheduled but already past, or still needing a date after its target passed. */
function isOverdueEvent(event: CoachCalendarEvent, referenceDate = new Date()) {
  if (isCompletedEvent(event) || event.status === 'cancelled') return false;
  if (needsScheduling(event)) return isAtRiskEvent(event, referenceDate);
  const date = parseLocalDate(eventDisplayDate(event));
  return Boolean(date && date.getTime() < startOfDay(referenceDate).getTime());
}

function buildOverdueMap(learners: CoachLearner[], events: CoachCalendarEvent[]): Map<string, OverdueSignal> {
  const overdueEvents = events.filter(event => isOverdueEvent(event));
  const map = new Map<string, OverdueSignal>();
  if (!overdueEvents.length) return map;

  learners.forEach(learner => {
    const matches = overdueEvents.filter(event => eventMatchesLearner(event, learner));
    const review = matches.find(event => event.source === 'progress-review');
    const coaching = matches.find(event => event.source === 'mcr');
    if (!review && !coaching) return;
    map.set(learner.id, {
      review: Boolean(review),
      coaching: Boolean(coaching),
      label: formatDateLabel(eventTargetDate(review || coaching)),
    });
  });

  return map;
}

function buildLearnerPriority(learner: CoachLearner, overdue?: OverdueSignal): LearnerPriority {
  const reasons: PriorityReason[] = [];
  const otjhStatus = normalizeOtjhStatus(learner.otjhStatus);
  const otjhPercent = otjhPercentFor(learner);

  if (otjhStatus === 'at-risk') {
    reasons.push({
      key: 'at-risk',
      label: learner.recentFlag || learner.riskFlags[0] || 'Flagged at risk',
      detail: otjhPercent !== null
        ? `${otjhPercent}% of expected off-the-job hours`
        : 'Immediate coaching action needed',
    });
  }

  if (overdue?.review) {
    reasons.push({
      key: 'overdue-review',
      label: 'Progress review overdue',
      detail: overdue.label !== EMPTY_VALUE ? `Was due ${overdue.label}` : undefined,
    });
  } else if (overdue?.coaching) {
    reasons.push({
      key: 'overdue-review',
      label: 'Coaching session overdue',
      detail: overdue.label !== EMPTY_VALUE ? `Was due ${overdue.label}` : undefined,
    });
  }

  if (learner.attendanceRateAvailable && learner.attendanceRate < ATTENDANCE_EXPECTED_RATE) {
    reasons.push({
      key: 'poor-attendance',
      label: `Attendance ${learner.attendanceRate}%`,
      detail: learner.attendanceRate < ATTENDANCE_MINIMUM_RATE
        ? `Below the ${ATTENDANCE_MINIMUM_RATE}% minimum`
        : `Below the ${ATTENDANCE_EXPECTED_RATE}% expected level`,
    });
  }

  if (learner.evidenceCountAvailable) {
    if (learner.evidenceCompletedCount === 0) {
      reasons.push({
        key: 'missing-evidence',
        label: 'No evidence accepted yet',
        detail: learner.evidenceCount > 0
          ? `${learner.evidenceCount} awaiting your review`
          : 'Nothing submitted on record',
      });
    } else if (learner.evidenceCount > 0) {
      reasons.push({
        key: 'missing-evidence',
        label: `${learner.evidenceCount} evidence awaiting review`,
        detail: `${learner.evidenceCompletedCount} accepted so far`,
      });
    }
  }

  reasons.sort((left, right) => PRIORITY_RANK[left.key] - PRIORITY_RANK[right.key]);
  const primary = reasons[0] || null;
  // Tier dominates the sort, then how many signals fired, then how far behind
  // on hours — so the learner to open first genuinely sits at the top.
  const tierWeight = primary ? (PRIORITY_ORDER.length - PRIORITY_RANK[primary.key]) * 1000 : 0;

  return {
    reasons,
    primary,
    keys: new Set(reasons.map(reason => reason.key)),
    urgency: tierWeight + reasons.length * 50 + (100 - (otjhPercent ?? 100)),
  };
}

/**
 * Tone for a percentage against this page's own warning/success thresholds —
 * the same three-way split every metric on this page already used under the
 * name `toneFromPercent`, now returning the shared `StatusTone` vocabulary
 * instead of a locally-invented one.
 */
function percentTone(value?: number | null, warningThreshold = 50, successThreshold = 75): StatusTone {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'neutral';
  if (value >= successThreshold) return 'positive';
  if (value >= warningThreshold) return 'caution';
  return 'critical';
}

/** The avatar ring colour: OTJH risk first, then programme stage. */
function learnerAvatarTone(learner: CoachLearner): StatusTone {
  const otjhStatus = normalizeOtjhStatus(learner.otjhStatus);
  if (otjhStatus === 'at-risk') return 'critical';
  if (otjhStatus === 'need-attention') return 'caution';
  const programmeStatus = normalizedProgramStatus(learner);
  if (programmeStatus === 'completed') return 'positive';
  if (programmeStatus === 'gateway') return 'brand';
  if (programmeStatus === 'epa') return 'info';
  return 'neutral';
}

/* ═══════════════════════════════════════════════════════════
   Upcoming Schedule — one list for live sessions, monthly
   coaching and progress reviews.
   ═══════════════════════════════════════════════════════════ */
function scheduleEventTitle(event: CoachCalendarEvent) {
  if (event.source === 'live-session') return displayValue(event.title);
  const learner = displayValue(event.learner);
  return learner === EMPTY_VALUE ? displayValue(event.title) : learner;
}

function scheduleEventMeta(event: CoachCalendarEvent) {
  return event.source === 'live-session' ? upcomingLiveSessionMetaLabel(event) : eventTypeLabel(event);
}

function scheduleEventTime(event: CoachCalendarEvent) {
  if (event.source === 'live-session') return upcomingLiveSessionTimeLabel(event);
  if (event.scheduledTime) return formatTimeRangeLabel(event);
  if (event.timeLabel && event.timeLabel !== 'Time TBC') return event.timeLabel;
  return 'TBC';
}

/** Just the start, for the fixed-size "Next" badge -- a live session's
 * "09:00 - 11:00" wraps and overflows a box sized for a single time. */

const KPI_FILTER_LABEL: Record<DashboardKpi, string> = {
  caseload: 'Full caseload',
  active: 'Active learners',
  'on-break': 'Paused learners',
  'on-track': 'On track learners',
  'at-risk': 'At risk learners',
  'need-attention': 'Learners needing attention',
  completed: 'Completed learners',
  epa: 'EPA learners',
  evidence: 'Evidence awaiting review',
  reviews: 'Upcoming reviews',
};

function formatWeekRangeLabel() {
  const { start, end } = currentWeekRange();
  return formatDateRangeLabel(start, end);
}

function formatDateRangeLabel(start: Date, end: Date) {
  const format = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
  return `${format.format(start)} – ${format.format(end)}`;
}

function formatUpcomingRangeLabel() {
  const start = startOfDay(new Date());
  const end = new Date(start);
  end.setDate(start.getDate() + COACHING_CALENDAR_WINDOW_DAYS - 1);
  return formatDateRangeLabel(start, end);
}

function LoadingBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-background-100/90 ${className}`}></div>;
}

function AttentionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={`attention-skeleton-${index}`}
          className="grid items-center gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <LoadingBlock className="h-10 w-10 rounded-full" />
            <div className="min-w-0 flex-1">
              <LoadingBlock className="h-3.5 w-40 max-w-[60%]" />
              <LoadingBlock className="mt-2 h-3 w-56 max-w-[80%]" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 lg:w-[380px]">
            {Array.from({ length: 4 }, (_, cell) => (
              <LoadingBlock key={`attention-cell-${index}-${cell}`} className="h-11" />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function ScheduleSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }, (_, groupIndex) => (
        <div key={`schedule-skeleton-${groupIndex}`} className="coach-upcoming-schedule__group rounded-xl border border-foreground-200/60 bg-background-50/70 p-3">
          <div className="coach-upcoming-schedule__group-header grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-foreground-100 pb-2.5">
            <LoadingBlock className="h-4 w-32" />
            <LoadingBlock className="h-5 w-7 rounded-full" />
          </div>
          <div className="coach-upcoming-schedule__events">
            {Array.from({ length: 2 }, (_, rowIndex) => (
              <div key={`schedule-row-${groupIndex}-${rowIndex}`} className="flex min-w-0 items-start gap-2.5 rounded-lg px-1.5 py-2">
                <LoadingBlock className="h-7 w-[5.75rem] shrink-0" />
                <LoadingBlock className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <LoadingBlock className="h-3 w-3/5" />
                  <LoadingBlock className="mt-1 h-2.5 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export default function CoachDashboard() {
  const navigate = useNavigate();
  const { auth, isInitialized } = useAuth();
  const coach = useCoachIdentity();
  // For a coach this is their own address; for an admin it is the coach they
  // chose, and empty until they choose one — which is what shows the picker.
  const authenticatedCoachEmail = coach.email;
  const authenticatedCoachName = coach.name;
  const adminEmail = auth.account?.email || '';
  // KPI cards open a quick drill-down first. The modal can still apply the
  // same filter to the caseload list when the coach wants to keep working there.
  const [kpiFilter, setKpiFilter] = useState<DashboardKpi | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpi | null>(null);
  const [ownerName, setOwnerName] = useState('Coach');
  const [learners, setLearners] = useState<CoachLearner[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CoachCalendarEvent[]>([]);
  const [calendarPreviewEvents, setCalendarPreviewEvents] = useState<CoachCalendarEvent[]>([]);
  const [liveSessionEvents, setLiveSessionEvents] = useState<CoachCalendarEvent[]>([]);
  const [evidenceQueue, setEvidenceQueue] = useState<EvidenceQueueLearner[]>([]);
  const [markingThisWeek, setMarkingThisWeek] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [liveSessionsLoading, setLiveSessionsLoading] = useState(true);
  const [liveSessionsError, setLiveSessionsError] = useState<string | null>(null);
  const [caseloadExpanded, setCaseloadExpanded] = useState(true);
  const [scheduleExpanded, setScheduleExpanded] = useState(true);
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [directoryCoaches, setDirectoryCoaches] = useState<DirectoryCoach[]>([]);
  const updateDashboardMeeting = (updated: CoachCalendarEvent) => {
    const replace = (events: CoachCalendarEvent[]) => events.map(event => (event.eventKey || event.id) === (updated.eventKey || updated.id) ? updated : event);
    setCalendarEvents(replace);
    setCalendarPreviewEvents(events => replace(events).filter(isWithinCalendarPreviewWindow));
  };
  const handleDirectoryLoaded = useCallback((nextCoaches: DirectoryCoach[]) => {
    setDirectoryCoaches(nextCoaches);
  }, []);

  const openCoachCalendar = useCallback((selected: DirectoryCoach, event: CoachCalendarEvent) => {
    setCoachViewAs({ email: selected.email, name: selected.name }, adminEmail);
    navigate('/coach/timetable', {
      state: {
        focusEvent: {
          source: event.source,
          eventKey: event.eventKey,
          date: eventDisplayDate(event),
          title: event.title,
          scheduledTime: event.scheduledTime,
          programme: event.programme,
          cohort: event.cohort,
          group: event.group,
        },
      },
    });
  }, [adminEmail, navigate]);

  useEffect(() => {
    if (!isInitialized) return;
    const controller = new AbortController();

    async function loadDashboard() {
      setLoading(true);
      setLoadWarning(null);
      setCalendarLoading(true);
      setCalendarError(null);
      setLiveSessionsLoading(true);
      setLiveSessionsError(null);

      if (!authenticatedCoachEmail) {
        setOwnerName(authenticatedCoachName);
        setLearners([]);
        setCalendarEvents([]);
        setCalendarPreviewEvents([]);
        setLiveSessionEvents([]);
        setEvidenceQueue([]);
        setMarkingThisWeek(undefined);
        // An admin has no caseload of their own, so there is nothing missing to
        // report — the picker below is the whole page for them.
        setLoadWarning(coach.canChooseCoach ? null : 'Coach access is required to load this dashboard.');
        setCalendarError('Coach access is required.');
        setLiveSessionsError('Coach access is required.');
        setCalendarLoading(false);
        setLiveSessionsLoading(false);
        setLoading(false);
        return;
      }

      try {
        const [dashboard, markingQueue] = await Promise.all([
          fetchSharedJsonGet<CoachDashboardApiResponse>(
            withCoachViewAs(coachDashboardEndpoint()),
            { signal: controller.signal, credentials: 'include' },
          ),
          fetchSharedJsonGet<MarkingQueueResponse>(
            withCoachViewAs('/coach_api/coach/marking-queue?status=pending&page_size=1'),
            { signal: controller.signal, credentials: 'include' },
          ).catch(() => null),
        ]);
        if (controller.signal.aborted) return;

        const queueItems = (dashboard.evidence?.items || []).map(normalizeEvidenceQueueLearner);
        const normalizedLearners = (dashboard.learners || []).map(normalizeLearner);
        const attendanceLearners = dashboard.attendance?.learners || [];
        const reviewHistoryLearners = dashboard.reviewHistory?.learners || [];
        const events = sortEvents(dashboard.timetable?.events || []);
        const nonLiveEvents = events.filter(event => event.source !== 'live-session');

        setOwnerName(displayValue(dashboard.owner?.name) === EMPTY_VALUE ? authenticatedCoachName : String(dashboard.owner?.name));
        setLearners(mergeEvidenceQueueIntoLearners(
          mergeReviewHistory(
            mergeAttendanceRates(normalizedLearners, attendanceLearners),
            reviewHistoryLearners,
          ),
          queueItems,
        ));
        setEvidenceQueue(queueItems);
        setMarkingThisWeek(
          markingQueue?.summary?.pendingItems === undefined
            ? undefined
            : toNumber(markingQueue.summary.pendingItems),
        );
        setCalendarEvents(nonLiveEvents);
        setCalendarPreviewEvents(nonLiveEvents.filter(isWithinCalendarPreviewWindow));
        setLiveSessionEvents(events.filter(event => event.source === 'live-session'));
        setCalendarError(dashboard.errors?.timetable || null);
        setLiveSessionsError(dashboard.errors?.timetable || null);
        setCalendarLoading(false);
        setLiveSessionsLoading(false);
        setLoading(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLearners([]);
        setCalendarEvents([]);
        setCalendarPreviewEvents([]);
        setLiveSessionEvents([]);
        setMarkingThisWeek(undefined);
        setLoadWarning(error instanceof Error ? error.message : 'Unable to load coach dashboard data right now.');
        setCalendarError('Calendar unavailable right now.');
        setLiveSessionsError('Live sessions unavailable right now.');
        setCalendarLoading(false);
        setLiveSessionsLoading(false);
        setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      controller.abort();
    };
  }, [authenticatedCoachEmail, authenticatedCoachName, coach.canChooseCoach, isInitialized]);

  useEffect(() => {
    if (!selectedKpi) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedKpi(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedKpi]);

  const enrichedLearners = useMemo(() => enrichLearnerSchedule(learners, calendarEvents), [learners, calendarEvents]);
  const activeLearners = useMemo(() => enrichedLearners.filter(isActiveLearner), [enrichedLearners]);
  const atRiskLearners = useMemo(
    () => activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'at-risk'),
    [activeLearners],
  );
  const needAttentionLearners = useMemo(
    () => activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'need-attention'),
    [activeLearners],
  );
  const onTrackLearners = useMemo(
    () => activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'on-track'),
    [activeLearners],
  );
  const evidenceLearners = useMemo(
    () => evidenceQueue
      .filter(learner => learner.pendingEvidence > 0)
      .sort((a, b) => b.pendingEvidence - a.pendingEvidence || a.learner.localeCompare(b.learner)),
    [evidenceQueue],
  );
  const atRiskCount = atRiskLearners.length;
  const onTrackCount = onTrackLearners.length;
  const totalCaseload = enrichedLearners.length;
  const pendingEvidence = useMemo(
    () => evidenceLearners.reduce((total, learner) => total + learner.pendingEvidence, 0),
    [evidenceLearners],
  );
  const completedEvidence = useMemo(
    () => evidenceLearners.reduce((total, learner) => total + learner.acceptedEvidence, 0),
    [evidenceLearners],
  );
  const activeLearnerIndex = useMemo(() => learnerIdentityIndex(activeLearners), [activeLearners]);
  const activeCalendarEvents = useMemo(
    () => calendarEvents.filter(event => eventMatchesLearnerIndex(event, activeLearnerIndex)),
    [activeLearnerIndex, calendarEvents],
  );
  const visibleCalendarSourceEvents = useMemo(
    () => calendarPreviewEvents.filter(event => eventMatchesLearnerIndex(event, activeLearnerIndex)),
    [activeLearnerIndex, calendarPreviewEvents],
  );
  const upcomingLiveSessions = useMemo(() => sortEvents(
    liveSessionEvents
      .filter(event => event.source === 'live-session')
      .filter(event => !['completed', 'cancelled'].includes(event.status) && isFutureCalendarEvent(event)),
  ), [liveSessionEvents]);
  const coachingCalendarLiveSessions = useMemo(
    () => upcomingLiveSessions.filter(isWithinCalendarPreviewWindow),
    [upcomingLiveSessions],
  );

  /* ── Upcoming Schedule: live sessions + coaching + reviews, one list ── */
  const upcomingScheduleEvents = useMemo(
    () => sortEvents([
      ...visibleCalendarSourceEvents.filter(isFutureCalendarEvent),
      ...coachingCalendarLiveSessions,
    ]),
    [coachingCalendarLiveSessions, visibleCalendarSourceEvents],
  );
  const upcomingScheduleGroups = useMemo(() => {
    const grouped = new Map<string, CoachCalendarEvent[]>();
    upcomingScheduleEvents.forEach(event => {
      const date = parseLocalDate(eventDisplayDate(event));
      if (!date) return;
      const key = toIsoDate(date);
      const existing = grouped.get(key);
      if (existing) existing.push(event);
      else grouped.set(key, [event]);
    });
    return Array.from(grouped.entries()).map(([date, events]) => ({ date, events }));
  }, [upcomingScheduleEvents]);

  /* ── Today / Needs Action ── */
  /* ── This Week ── */
  const weekEvents = useMemo(
    () => [...activeCalendarEvents, ...liveSessionEvents]
      .filter(event => event.status !== 'cancelled' && isEventThisWeek(event)),
    [activeCalendarEvents, liveSessionEvents],
  );
  const progressReviewsThisWeek = weekEvents.filter(event => event.source === 'progress-review').length;
  const monthlyCoachingThisWeek = weekEvents.filter(event => event.source === 'mcr').length;
  const catchUpsThisWeek = weekEvents.filter(event => event.source === 'catch-up').length;

  /* ── Learners Requiring Attention (Risk Alert + At Risk Learners, merged) ── */
  const overdueMap = useMemo(
    () => buildOverdueMap(activeLearners, activeCalendarEvents),
    [activeCalendarEvents, activeLearners],
  );
  const priorityMap = useMemo(() => {
    const map = new Map<string, LearnerPriority>();
    enrichedLearners.forEach(learner => map.set(learner.id, buildLearnerPriority(learner, overdueMap.get(learner.id))));
    return map;
  }, [enrichedLearners, overdueMap]);
  const attentionQueue = useMemo(
    () => atRiskLearners
      .map(learner => ({ learner, priority: priorityMap.get(learner.id) }))
      .filter((entry): entry is { learner: CoachLearner; priority: LearnerPriority } => Boolean(entry.priority?.reasons.length))
      .sort((left, right) => right.priority.urgency - left.priority.urgency || left.learner.name.localeCompare(right.learner.name)),
    [atRiskLearners, priorityMap],
  );
  const kpiFilterPredicate = useMemo((): ((learner: CoachLearner) => boolean) | null => {
    switch (kpiFilter) {
      case 'caseload': return () => true;
      case 'active': return isActiveLearner;
      case 'on-break': return isOnBreakLearner;
      case 'completed': return isCompletedLearner;
      case 'epa': return isEpaLearner;
      case 'at-risk':
      case 'need-attention':
      case 'on-track':
        return learner => isActiveLearner(learner) && normalizeOtjhStatus(learner.otjhStatus) === kpiFilter;
      default: return null;
    }
  }, [kpiFilter]);

  const attentionRows = useMemo(() => {
    if (kpiFilterPredicate) {
      return enrichedLearners
        .filter(kpiFilterPredicate)
        .map(learner => ({ learner, priority: priorityMap.get(learner.id)! }))
        .sort((left, right) => right.priority.urgency - left.priority.urgency || left.learner.name.localeCompare(right.learner.name));
    }
    return attentionQueue;
  }, [attentionQueue, enrichedLearners, kpiFilterPredicate, priorityMap]);

  const attentionPanelTitle = kpiFilter ? KPI_FILTER_LABEL[kpiFilter] : 'Learners at Risk';
  const attentionPanelSubtitle = kpiFilter
    ? 'Filtered from the KPI cards, ordered by priority'
    : 'Learners currently flagged as OTJH at risk.';
  const attentionHasOverflow = attentionRows.length > AT_RISK_SCROLL_THRESHOLD;

  const schedulePanelLoading = (calendarLoading || liveSessionsLoading) && !upcomingScheduleEvents.length;

  const scrollToSection = (id: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const scrollToAttention = () => scrollToSection('learner-caseload');

  const openCaseloadFilter = (filter: DashboardKpi) => {
    setKpiFilter(filter);
    scrollToAttention();
  };

  // An administrator reaches this page with no caseload of their own. Rather
  // than a dashboard of zeros, they pick whose workspace to open; the selection
  // then travels with every coach request (see `@/lib/coachViewAs`), so the
  // sidebar's caseload, timetable and marking pages follow the same coach.
  if (coach.canChooseCoach && !coach.isViewingAsCoach) {
    return (
      <WorkspaceShell
        // No sidebar until a coach is chosen: every coach page reads the
        // selected coach, so those links would open a caseload, a timetable and
        // a marking queue belonging to nobody. Picking one is the only thing to
        // do here, and the nav returns with the choice.
        role="coach" roleLabel={coachNav.label} navItems={[]} workspaceLabel={coachNav.workspaceLabel}
        pageTitle="Coach Workspace" pageSubtitle="Choose a coach to open their workspace"
        userName={auth.account?.displayName || auth.user?.fullName || 'Administrator'} userRole="Administrator"
      >
        <div className="space-y-6 p-3 md:p-6">
          <CoachDirectoryPicker
            onSelect={selected => setCoachViewAs({ email: selected.email, name: selected.name }, adminEmail)}
            onDirectoryLoaded={handleDirectoryLoaded}
          />
          <AllCoachesCalendar coaches={directoryCoaches} onOpenCoach={openCoachCalendar} />
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Coach Dashboard" pageSubtitle="Support learners. Track progress. Make a difference."
      hideBreadcrumbs
      userName={ownerName} userRole="Progress Coach"
    >
      <div className={styles.dashboard}>
        <div className={styles.welcome}>
          <div>
            <h1>Coach Command Center <span aria-hidden="true">👋</span></h1>
            <p>Support learners. Track progress. Make a difference.</p>
          </div>

        </div>
        {(loading || loadWarning) && (
          <div className={styles.notice} role={loadWarning ? 'alert' : 'status'}>
            {loading ? 'Loading live coach dashboard data...' : loadWarning}
          </div>
        )}

        <section className={styles.metrics} aria-label="Coach dashboard metrics">
          <DashboardMetric label="Total learners" value={loading || loadWarning ? undefined : totalCaseload} icon="ri-group-line" onClick={() => setSelectedKpi('caseload')} />
          <DashboardMetric label="OTJH at risk" value={loading || loadWarning ? undefined : atRiskCount} note={loading || loadWarning ? undefined : `${needAttentionLearners.length} need attention`} icon="ri-alarm-warning-line" tone="critical" onClick={() => setSelectedKpi('at-risk')} />
          <DashboardMetric label="Pending marking" value={loading || loadWarning ? undefined : markingThisWeek} note="Pending submissions" icon="ri-file-list-3-line" onClick={() => navigate('/coach/marking-queue')} />
          <DashboardMetric label="PR this week" value={loading || loadWarning ? undefined : progressReviewsThisWeek} note={`Progress reviews · ${formatWeekRangeLabel()}`} icon="ri-focus-3-line" tone="caution" onClick={() => navigate('/coach/progress-reviews')} />
          <DashboardMetric label="MCM this week" value={loading || loadWarning ? undefined : monthlyCoachingThisWeek} note={`Monthly coaching · ${formatWeekRangeLabel()}`} icon="ri-history-line" tone="caution" onClick={() => navigate('/coach/monthly-coaching')} />
          <DashboardMetric label="Catch-ups this week" value={loading || loadWarning ? undefined : catchUpsThisWeek} note={`Catch-up sessions · ${formatWeekRangeLabel()}`} icon="ri-calendar-event-line" tone="caution" onClick={() => navigate('/coach/timetable')} />
        </section>

        <div className={styles.riskLayout}>
          <div id="learner-caseload" className="min-w-0 scroll-mt-4">
            <Panel className={`${styles.panel} ${styles.learnersPanel}`}>
              <SectionHeader icon="ri-group-line" title={attentionPanelTitle} description={attentionPanelSubtitle}
                actions={<>
                  <button type="button" className={styles.iconButton} onClick={() => setCaseloadExpanded(current => !current)}
                    aria-expanded={caseloadExpanded} aria-controls="coach-caseload-content" aria-label={`${caseloadExpanded ? 'Collapse' : 'Expand'} caseload panel`}>
                    <AppIcon name={caseloadExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                  </button>
                  <Link to="/coach/caseload" className={`${styles.textButton} ${styles.sectionLink}`}>View all learners <AppIcon name="ri-arrow-right-line" /></Link>
                </>} />
              {caseloadExpanded && (
                <div id="coach-caseload-content">
                  {kpiFilter && <div className={styles.filters}>
                    <FilterChip label="Filter" value={KPI_FILTER_LABEL[kpiFilter]} onRemove={() => setKpiFilter(null)} />
                  </div>}
                  {loading && !attentionRows.length && <AttentionSkeleton />}
                  {!loading && attentionRows.length > 0 && (
                    <div className={styles.tableScroll} data-overflow={attentionHasOverflow} tabIndex={0} role="region" aria-label="Learners at OTJH risk">
                      <table className={`${styles.table} ${styles.learnersTable}`}>
                        <caption className="sr-only">Learners at OTJH risk, ordered by priority</caption>
                        <thead><tr><th scope="col">Learner</th><th scope="col">Group</th><th scope="col">OTJH status</th><th scope="col">Last contact</th><th scope="col">Actions</th></tr></thead>
                        <tbody>{attentionRows.map(entry => (
                          <AttentionLearnerRow key={entry.learner.id} learner={entry.learner}
                            onOpen={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(entry.learner.id)}`, {
                              state: {
                                learnerId: entry.learner.id, learnerName: entry.learner.name,
                                ...(entry.learner.learnerType ? { kind: entry.learner.learnerType } : {}),
                                ...(entry.learner.enrolmentId ? { enrolmentId: entry.learner.enrolmentId } : {}),
                              },
                            })} />
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {!loading && !attentionRows.length && (
                    <EmptyState variant={kpiFilter ? 'no-matches' : 'empty'}
                      icon={kpiFilter ? undefined : 'ri-shield-check-line'}
                      title={kpiFilter ? 'No learners match this filter' : 'No learners at risk'}
                      description={kpiFilter ? 'Clear the filter to see all learners currently at risk.' : 'No active learners are currently flagged as OTJH at risk.'} />
                  )}
                </div>
              )}
            </Panel>
          </div>
          <aside className={styles.charts} aria-label="Learner risk insights">
            <Panel className={styles.panel}>
              <SectionHeader title="Risk Distribution" icon="ri-bar-chart-line" actions={<span className={styles.chartScope}>By OTJH status</span>} />
              <OtjhDistribution learners={activeLearners} unavailable={loading || Boolean(loadWarning)} />
            </Panel>
            <Panel className={styles.panel}>
              <SectionHeader title="Monthly Learners at Risk" icon="ri-bar-chart-line" actions={<span className={styles.chartPeriod}>Last 6 months</span>} />
              <div className={styles.monthlyRisk}>
                <div className={styles.unavailableChart}>
                  <AppIcon name="ri-line-chart-line" aria-hidden="true" />
                  <p>History not available</p><span>Monthly risk data is not available yet.</span>
                </div>
                <div className={styles.currentRisk}>
                  <strong>{loading || loadWarning ? EMPTY_VALUE : atRiskCount}</strong>
                  <span>at risk now</span>
                  <small>Current OTJH status</small>
                </div>
              </div>
            </Panel>
          </aside>
        </div>

        <Panel className={styles.panel}>
          <SectionHeader icon="ri-calendar-schedule-line" title="Upcoming Meetings"
            description={`Your scheduled meetings and live sessions · next ${COACHING_CALENDAR_WINDOW_DAYS} days (${formatUpcomingRangeLabel()})`}
            actions={<>
              <button type="button" className={styles.iconButton} onClick={() => setScheduleExpanded(current => !current)}
                aria-expanded={scheduleExpanded} aria-controls="coach-schedule-content" aria-label={`${scheduleExpanded ? 'Collapse' : 'Expand'} upcoming schedule`}>
                <AppIcon name={scheduleExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
              </button>
              <Link to="/coach/timetable" className={styles.textButton}>Calendar <AppIcon name="ri-calendar-line" /></Link>
              <Link to="/coach/timetable" className={`${styles.textButton} ${styles.sectionLink}`}>View all meetings <AppIcon name="ri-arrow-right-line" /></Link>
            </>} />
          {scheduleExpanded && (
            <div id="coach-schedule-content">
              {scheduleNotice && <p className={styles.notice} role="status">{scheduleNotice}</p>}
              {schedulePanelLoading && <ScheduleSkeleton />}
              {!schedulePanelLoading && upcomingScheduleGroups.length > 0 && (
                <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Upcoming meetings and live sessions">
                  <table className={`${styles.table} ${styles.meetingsTable}`}>
                    <caption className="sr-only">Meetings and live sessions in the next seven days</caption>
                    <thead className="sr-only"><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Learner / session</th><th scope="col">Meeting type</th><th scope="col">Status</th><th scope="col">Reschedule</th><th scope="col">Send Reminder</th><th scope="col">Generate Presentation</th><th scope="col">View Form</th></tr></thead>
                    <tbody>{upcomingScheduleGroups.flatMap(group => group.events.map(event => (
                      <tr key={event.eventKey || event.id}>
                        <td className={styles.dateCell}><time className={styles.meetingDate} dateTime={group.date}><span>{formatCalendarWeekday(group.date)}</span><strong>{formatDateLabel(group.date)}</strong></time></td>
                        <td className={styles.dateCell}><span className={styles.meetingTime}><AppIcon name="ri-time-line" aria-hidden="true" />{scheduleEventTime(event)}</span></td>
                        <td><div className={styles.identity}>
                          <LearnerAvatar name={scheduleEventTitle(event)} />
                          <span><span className={styles.identityName}>{scheduleEventTitle(event)}</span>{optionalDisplayValue(event.group) && <span className={styles.subtle}>{event.group}</span>}</span>
                        </div></td>
                        <td><span className={styles.meetingType}><span className={styles.meetingTypeIcon}><AppIcon name="ri-book-open-line" aria-hidden="true" /></span>{scheduleEventMeta(event)}</span></td>
                        <td><StatusBadge status={event.status} label={statusLabel(event.status)} size="sm" /></td>
                        {event.source === 'live-session' ? <td colSpan={4}><Link to="/coach/timetable" state={buildTimetableFocusState(event)} className={styles.textButton} aria-label={`View ${scheduleEventTitle(event)} in calendar`}><AppIcon name="ri-calendar-line" /> View in calendar</Link></td>
                          : <DashboardMeetingActions event={event} onUpdated={updateDashboardMeeting} onScheduleNotice={setScheduleNotice} />}
                      </tr>
                    )))}</tbody>
                  </table>
                </div>
              )}
              {!schedulePanelLoading && !upcomingScheduleGroups.length && (
                <EmptyState size="sm" icon="ri-calendar-check-line" title="Nothing scheduled" description={calendarError || liveSessionsError || `Nothing scheduled in the next ${COACHING_CALENDAR_WINDOW_DAYS} days.`} />
              )}
            </div>
          )}
        </Panel>

      </div>

      {selectedKpi && (
        <KpiDetailModal
          type={selectedKpi}
          learners={enrichedLearners}
          calendarEvents={activeCalendarEvents}
          evidenceQueue={evidenceLearners}
          pendingEvidence={pendingEvidence}
          completedEvidence={completedEvidence}
          onClose={() => setSelectedKpi(null)}
          onFilter={(filter) => {
            setSelectedKpi(null);
            openCaseloadFilter(filter);
          }}
        />
      )}
    </WorkspaceShell>
  );
}

function DashboardMetric({ label, value, note, icon, tone, onClick }: {
  label: string;
  value?: number;
  note?: string;
  icon: string;
  tone?: StatusTone;
  onClick?: () => void;
}) {
  const unavailable = value === undefined;
  const content = <>
    <span className={styles.metricIcon}><AppIcon name={icon} aria-hidden="true" /></span>
    <span className={styles.metricLabel}>{label}</span>
    <span className={styles.metricValue}>{unavailable ? EMPTY_VALUE : value}</span>
    <span className={styles.metricNote}>{unavailable ? 'Data not available' : note || 'Your caseload'}</span>
    {onClick && <span className={styles.metricChevron} aria-hidden="true"><AppIcon name="ri-arrow-right-s-line" /></span>}
  </>;
  return onClick ? (
    <button type="button" className={styles.metric} data-tone={tone} data-unavailable={unavailable} onClick={onClick} aria-label={`Open ${label} details`}>{content}</button>
  ) : (
    <div className={styles.metric} data-unavailable={unavailable}>{content}</div>
  );
}

function OtjhDistribution({ learners, unavailable }: { learners: CoachLearner[]; unavailable: boolean }) {
  const statuses: { key: OtjhStatusKey; label: string; color: string }[] = [
    { key: 'at-risk', label: 'At Risk', color: '#e51e50' },
    { key: 'need-attention', label: 'Need Attention', color: '#e4a400' },
    { key: 'on-track', label: 'On Track', color: '#249b61' },
    { key: 'unknown', label: 'No OTJH status', color: '#9895ab' },
  ];
  const total = learners.length;
  let cursor = 0;
  const segments = statuses.map(status => {
    const count = learners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === status.key).length;
    const percent = total ? count / total * 100 : 0;
    const start = cursor;
    cursor += percent;
    return { ...status, count, percent, stop: `${status.color} ${start}% ${cursor}%` };
  });
  return <>
    <div className={styles.distribution}>
      <div className={styles.donut} style={{ background: unavailable || !total ? 'var(--kbc-border)' : `conic-gradient(${segments.map(segment => segment.stop).join(', ')})` }} aria-hidden="true">
        <div className={styles.donutCenter}><strong>{unavailable ? EMPTY_VALUE : total}</strong><span>active learners</span></div>
      </div>
      <ul className={styles.legend} aria-label="Active learners by OTJH status">
        {segments.map(segment => <li key={segment.key}>
          <span className={styles.legendDot} style={{ background: segment.color }} aria-hidden="true" />
          <span>{segment.label}</span>
          <strong>{unavailable ? EMPTY_VALUE : `${segment.count} (${Math.round(segment.percent)}%)`}</strong>
        </li>)}
      </ul>
    </div>
    <p className={styles.chartNote}><AppIcon name="ri-info-i" aria-hidden="true" /><span>{unavailable ? 'OTJH data is not available.' : `${total} active learners grouped by their current OTJH status.`}</span></p>
  </>;
}

/* ═══════════════════════════════════════════════════════════
   Priority filter tabs — "All" plus the five ranked reasons,
   in priority order, hiding whichever have nothing in them.
   ═══════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════
   Compact learner rows retain the support reasons and four
   existing metrics inside keyboard-accessible details.
   ═══════════════════════════════════════════════════════════ */
function AttentionLearnerRow({ learner, onOpen }: {
  learner: CoachLearner;
  onOpen: () => void;
}) {
  const status = OTJH_STATUS_META[normalizeOtjhStatus(learner.otjhStatus)];
  return (
    <tr>
      <td><div className={styles.identity}>
        <LearnerAvatar name={learner.name} initials={learner.initials} tone={learnerAvatarTone(learner)} />
        <span className={styles.identityName}>{learner.name}</span>
      </div></td>
      <td><span className={styles.groupName}>{learner.group !== EMPTY_VALUE ? learner.group : learner.programme}</span></td>
      <td><StatusBadge tone={status.tone} label={status.label} size="sm" /></td>
      <td><span className={styles.lastContact}>{displayValue(learner.lastContact)}</span>{displayValue(learner.lastContact) === EMPTY_VALUE && <span className={styles.subtle}>No session recorded</span>}</td>
      <td><button type="button" className={styles.textButton} onClick={onOpen} aria-label={`View learner ${learner.name}`}><AppIcon name="ri-user-line" aria-hidden="true" />View Profile</button></td>
    </tr>
  );
}

/* ═══════════════════════════════════════════════════════════
   Next review cell — an overdue review says so rather than
   showing a date the coach has to compare against today.
   ═══════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════
   KPI drill-down modal
   ═══════════════════════════════════════════════════════════ */
function KpiDetailModal({ type, learners, calendarEvents, evidenceQueue, pendingEvidence, completedEvidence, onClose, onFilter }: {
  type: DashboardKpi;
  learners: CoachLearner[];
  calendarEvents: CoachCalendarEvent[];
  evidenceQueue: EvidenceQueueLearner[];
  pendingEvidence: number;
  completedEvidence: number;
  onClose: () => void;
  onFilter: (filter: DashboardKpi) => void;
}) {
  const navigate = useNavigate();
  const meta: Record<DashboardKpi, { title: string; subtitle: string; icon: string; iconStyle: string }> = {
    caseload: { title: 'Learner caseload', subtitle: 'All learners currently assigned to you', icon: 'ri-group-line', iconStyle: 'bg-primary-100 text-primary-600' },
    active: { title: 'Active learners', subtitle: 'Learners currently active on their programme', icon: 'ri-user-follow-line', iconStyle: 'bg-emerald-100 text-emerald-600' },
    'on-break': { title: 'Paused learners', subtitle: 'Learners whose programme is currently paused', icon: 'ri-pause-line', iconStyle: 'bg-amber-100 text-amber-600' },
    'on-track': { title: 'Learners on track', subtitle: 'Learners currently meeting their OTJH target', icon: 'ri-checkbox-circle-line', iconStyle: 'bg-emerald-100 text-emerald-600' },
    'at-risk': { title: 'Learners at risk', subtitle: 'Learners requiring immediate coaching action', icon: 'ri-alarm-warning-line', iconStyle: 'bg-red-100 text-red-600' },
    'need-attention': { title: 'Learners needing attention', subtitle: 'Learners who need targeted support this week', icon: 'ri-error-warning-line', iconStyle: 'bg-amber-100 text-amber-600' },
    completed: { title: 'Completed learners', subtitle: 'Learners who have finished the programme', icon: 'ri-verified-badge-line', iconStyle: 'bg-green-100 text-green-700' },
    epa: { title: 'EPA learners', subtitle: 'Learners currently at the end-point assessment stage', icon: 'ri-award-line', iconStyle: 'bg-secondary-100 text-secondary-700' },
    evidence: { title: 'Evidence awaiting review', subtitle: 'Evidence submissions and review status', icon: 'ri-file-search-line', iconStyle: 'bg-secondary-100 text-secondary-600' },
    reviews: { title: 'Upcoming reviews', subtitle: 'Progress reviews scheduled in the next 14 days', icon: 'ri-file-chart-line', iconStyle: 'bg-primary-100 text-primary-600' },
  };
  const current = meta[type];
  const filterForType: Partial<Record<DashboardKpi, DashboardKpi>> = {
    caseload: 'caseload',
    active: 'active',
    'on-break': 'on-break',
    'on-track': 'on-track',
    'at-risk': 'at-risk',
    'need-attention': 'need-attention',
    completed: 'completed',
    epa: 'epa',
  };
  const modalLearners = type === 'caseload'
    ? learners
    : type === 'active'
      ? learners.filter(isActiveLearner)
      : type === 'on-break'
        ? learners.filter(isOnBreakLearner)
      : type === 'completed'
        ? learners.filter(isCompletedLearner)
      : type === 'epa'
        ? learners.filter(isEpaLearner)
    : type === 'on-track' || type === 'at-risk' || type === 'need-attention'
      ? learners.filter(learner => isActiveLearner(learner) && normalizeOtjhStatus(learner.otjhStatus) === type)
      : [];
  const reviews = sortEvents(calendarEvents.filter(event => event.source === 'progress-review' && isWithinNextDays(event, 14)));
  const evidenceLearners = evidenceQueue;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const openLearnerProfile = (learner: CoachLearner) => {
    navigate(`/coach/learner-case-file?id=${encodeURIComponent(learner.id)}`, {
      state: {
        learnerId: learner.id,
        learnerName: learner.name,
        ...(learner.learnerType ? { kind: learner.learnerType } : {}),
        ...(learner.enrolmentId ? { enrolmentId: learner.enrolmentId } : {}),
      },
    });
    onClose();
  };

  // Scrolls the whole overlay rather than centring a fixed-height box. A
  // centred flex item taller than its container overflows in BOTH directions,
  // and the half above the viewport cannot be scrolled back to -- which cropped
  // the header, cutting the icon in half and pushing the title under the panel
  // edge. `my-auto` inside a `min-h-full` wrapper still centres a short dialog,
  // while a tall one starts at the top where it can actually be read.
  return createPortal(
    <div className="fixed inset-0 z-[9999] overflow-y-auto overscroll-contain p-3 sm:p-6 lg:p-8" role="dialog" aria-modal="true" aria-labelledby="kpi-modal-title" aria-describedby="kpi-modal-description">
      <button type="button" onClick={onClose} className="fixed inset-0 bg-foreground-950/10 backdrop-blur-[5px] backdrop-saturate-125" aria-label="Close popup"></button>
      <div className="relative mx-auto flex min-h-full w-full max-w-5xl items-start justify-center">
        <div className="relative my-auto flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-white/80 bg-background-50 shadow-xl">
        {/* shrink-0 so a long caseload cannot squeeze the header away: the body
            below is the flex child that scrolls, and this stays put. */}
        <header className="relative z-10 shrink-0 overflow-hidden border-b border-foreground-100/80 bg-gradient-to-r from-primary-50/90 via-background-50 to-secondary-50/60 px-5 py-5 sm:px-7 sm:py-6">
          <div className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-primary-200/25 blur-3xl"></div>
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-white/80 sm:h-14 sm:w-14 ${current.iconStyle}`}><AppIcon className={`${current.icon} text-xl`}></AppIcon></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 id="kpi-modal-title" className="font-heading text-xl font-bold tracking-tight text-foreground-900 sm:text-2xl">{current.title}</h2>
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-primary-200/80 bg-background-50 px-2.5 text-xs font-bold text-primary-700 shadow-sm">{type === 'evidence' ? pendingEvidence : type === 'reviews' ? reviews.length : modalLearners.length}</span>
                </div>
                <p id="kpi-modal-description" className="mt-1.5 text-xs leading-5 text-foreground-500 sm:text-sm">{current.subtitle}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-foreground-200/80 bg-background-50/90 text-foreground-500 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground-300 hover:text-foreground-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2" aria-label="Close"><AppIcon className="ri-close-line text-xl"></AppIcon></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-background-50 to-background-100/50 p-4 sm:p-6">
          {(type === 'caseload' || type === 'active' || type === 'on-break' || type === 'on-track' || type === 'at-risk' || type === 'need-attention' || type === 'completed' || type === 'epa') && (
            <div className="space-y-3.5">
              {modalLearners.map(learner => {
                const status = OTJH_STATUS_META[normalizeOtjhStatus(learner.otjhStatus)];
                const attendance = learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
                const otjh = learner.otjhTarget > 0 ? `${learner.otjhCompleted}/${learner.otjhTarget}` : EMPTY_VALUE;
                return (
                  <button
                    key={learner.id}
                    type="button"
                    onClick={() => openLearnerProfile(learner)}
                    className="group grid w-full gap-4 rounded-2xl border border-foreground-200/80 bg-background-50 p-4 text-left shadow-sm transition-colors hover:border-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)_auto] lg:items-center"
                    title={`Open ${learner.name}'s profile`}
                    aria-label={`Open ${learner.name}'s profile`}
                  >
                    <div className="flex min-w-0 items-center gap-3.5">
                      <LearnerAvatar name={learner.name} initials={learner.initials} tone={learnerAvatarTone(learner)} size="lg" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-foreground-900 transition-colors group-hover:text-primary-700 sm:text-[15px]">{learner.name}</span>
                          {type === 'active' || type === 'on-break' ? (
                            <StatusBadge tone={isActiveLearner(learner) ? 'positive' : 'caution'} label={displayValue(learner.rawProgramStatus)} size="sm" />
                          ) : type === 'completed' || type === 'epa' ? (
                            <StatusBadge tone={type === 'completed' ? 'positive' : 'info'} label={type === 'completed' ? 'Completed' : 'EPA'} size="sm" />
                          ) : (
                            <StatusBadge tone={status.tone} label={status.label} size="sm" />
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-foreground-500">{learner.programme} <span className="text-foreground-300">·</span> {learner.group}</p>
                      </div>
                    </div>
                    <div className="grid min-w-0 grid-cols-3 gap-2 text-center sm:col-span-2 lg:col-span-1 lg:min-w-[320px]">
                      <ModalMiniMetric label="OTJH" value={otjh} />
                      <ModalMiniMetric label="KSB" value={ksbCellValue(learner)} />
                      <ModalMiniMetric label="Attendance" value={attendance} tone={percentTone(learner.attendanceRateAvailable ? learner.attendanceRate : null, ATTENDANCE_MINIMUM_RATE, ATTENDANCE_EXPECTED_RATE)} />
                    </div>
                    <span className="hidden h-10 w-10 items-center justify-center rounded-lg bg-background-100 text-foreground-400 transition-colors group-hover:bg-primary-50 group-hover:text-primary-700 sm:flex"><AppIcon className="ri-arrow-right-s-line text-xl"></AppIcon></span>
                  </button>
                );
              })}
              {!modalLearners.length && (
                <EmptyState icon={current.icon} title="No learners in this status" description="This list will update automatically when learner data changes." />
              )}
            </div>
          )}

          {type === 'evidence' && (
            <div className="space-y-3">
              {evidenceLearners.map(learner => {
                // The marking queue has no learnerType of its own -- cross-reference the
                // caseload list already loaded on this page instead of guessing.
                const caseloadMatch = learners.find(candidate => candidate.id === learner.learnerId);
                return (
                <Link
                  key={learner.id}
                  to={`/coach/learner-case-file?id=${encodeURIComponent(learner.learnerId)}&tab=evidence`}
                  state={{
                    learnerId: learner.learnerId,
                    learnerName: learner.learner,
                    tab: 'evidence',
                    ...(caseloadMatch?.learnerType ? { kind: caseloadMatch.learnerType } : {}),
                    ...(caseloadMatch?.enrolmentId ? { enrolmentId: caseloadMatch.enrolmentId } : {}),
                  }}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 px-4 py-3 shadow-sm transition-colors hover:border-secondary-200 hover:bg-secondary-50/30"
                >
                  <LearnerAvatar name={learner.learner} initials={learner.initials} tone="brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground-900">{learner.learner}</p>
                    <p className="mt-0.5 truncate text-[12px] text-foreground-400">{learner.programme} · {learner.group}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-secondary-700">{learner.pendingEvidence} / {learner.totalEvidence}</p>
                    <p className="text-[12px] text-foreground-400">Pending / Total</p>
                    {learner.isOverdue && <p className="mt-0.5 text-[12px] font-semibold text-red-600">Overdue</p>}
                  </div>
                  <AppIcon className="ri-arrow-right-s-line text-foreground-300"></AppIcon>
                </Link>
                );
              })}
              {!evidenceLearners.length && (
                <EmptyState icon="ri-file-search-line" title="No evidence awaiting review" description="Learners will appear here when submitted evidence needs marking." />
              )}
            </div>
          )}

          {type === 'reviews' && (
            <div className="space-y-2">
              {reviews.map(event => {
                const date = eventDisplayDate(event);
                return (
                  <div key={event.eventKey || event.id} className="flex items-center gap-3 rounded-lg border border-foreground-100 p-3">
                    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                      <span className="text-[12px] font-bold uppercase">{formatCalendarMonth(date)}</span>
                      <span className="text-sm font-bold leading-none">{formatCalendarDayNumber(date)}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-foreground-900">{displayValue(event.learner)}</p>
                      <p className="mt-0.5 text-[12px] text-foreground-400">{formatTimeLabel(event)} · {eventTypeLabel(event)}</p>
                    </div>
                    <AppIcon className="ri-arrow-right-s-line text-foreground-300"></AppIcon>
                  </div>
                );
              })}
              {!reviews.length && (
                <EmptyState icon="ri-calendar-check-line" title="No reviews due" description="There are no progress reviews scheduled in the next 14 days." />
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-foreground-100 bg-background-100/60 px-5 py-4 sm:px-7">
          <button type="button" onClick={onClose} className="rounded-xl border border-foreground-200 bg-background-50 px-4 py-2.5 text-xs font-semibold text-foreground-700 shadow-sm transition-colors hover:bg-background-100 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Close</button>
          {filterForType[type] && <button type="button" onClick={() => onFilter(filterForType[type]!)} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">View in caseload list</button>}
          {type === 'evidence' && <Link to="/coach/marking-queue" onClick={onClose} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open marking queue</Link>}
          {type === 'reviews' && <Link to="/coach/progress-reviews" onClick={onClose} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open reviews</Link>}
        </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModalMiniMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: StatusTone }) {
  const style = toneStyle(tone);
  const toneClass = tone === 'neutral'
    ? 'border-foreground-200/60 bg-background-50 text-foreground-800'
    : cn(style.border, style.bg, style.text);

  return (
    <div className={cn('min-w-0 rounded-lg border px-2 py-2.5 sm:px-3', toneClass)}>
      <p className="truncate text-xs font-bold leading-none sm:text-sm">{value}</p>
      <p className="mt-1.5 truncate text-[12px] font-semibold uppercase tracking-[0.08em] opacity-70">{label}</p>
    </div>
  );
}
