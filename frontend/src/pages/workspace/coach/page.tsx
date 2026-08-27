import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { fetchSharedJsonGet } from '@/lib/sharedGetJson';
import { setCoachViewAs, withCoachViewAs } from '@/lib/coachViewAs';
import { useAuth } from '@/hooks/useAuth';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { roleNavMap } from '@/mocks/navigation';
import { CoachDirectoryPicker } from './CoachDirectoryPicker';
import { cn } from '@/lib/cn';
import { ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import { PageContainer } from '@/components/ui/PageContainer';
import { SectionHeader, SectionLabel } from '@/components/ui/SectionHeader';
import { MetricCard, CompactMetric, MetricRow } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ActionRow } from '@/components/ui/ActionRow';
import { Panel } from '@/components/ui/Panel';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { FilterChip } from '@/components/ui/FilterToolbar';
import { LearnerAvatar, ReasonLine } from '@/pages/coach/shared/LearnerIdentity';
import {
  type CoachCalendarEvent,
  eventDisplayDate,
  eventTargetDate,
  eventPeriodLabel,
  formatDateLabel,
  formatTimeLabel,
  isAtRiskEvent,
  currentWeekRange,
  isCompletedEvent,
  isEventThisWeek,
  needsScheduling,
  parseLocalDate,
  sortEvents,
  startOfDay,
} from '../../coach/shared/calendarEvents';

const coachNav = roleNavMap.coach;

type OtjhFilter = 'all' | 'at-risk' | 'need-attention' | 'on-track';
type DashboardKpi = 'caseload' | 'active' | 'on-break' | 'on-track' | 'at-risk' | 'need-attention' | 'gateway' | 'epa' | 'evidence' | 'reviews';
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

interface CoachDashboardApiResponse extends CaseloadApiResponse {
  attendance?: AttendanceApiResponse;
  timetable?: {
    events?: CoachCalendarEvent[];
  };
  evidence?: MarkingQueueResponse;
  errors?: Record<string, string>;
}

interface AttendanceApiLearner {
  id: string;
  learner: string;
  email?: string | null;
  attendance: number | null;
  hasAttendance?: boolean;
}

interface AttendanceApiResponse {
  learners?: AttendanceApiLearner[];
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

function isGatewayLearner(learner: CoachLearner): boolean {
  return normalizedProgramStatus(learner) === 'gateway';
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
  };
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

function eventStatusClasses(event: CoachCalendarEvent) {
  if (isAtRiskEvent(event)) {
    return {
      row: 'bg-red-50/80 border border-red-200/50',
      date: 'text-red-600',
      badge: 'bg-red-100 text-red-700',
      icon: 'ri-alert-fill text-red-500',
    };
  }
  if (event.source === 'live-session') {
    return {
      row: 'bg-sky-50/70 border border-sky-100 hover:bg-sky-50',
      date: 'text-sky-600',
      badge: 'bg-sky-100 text-sky-700',
      icon: 'ri-live-line text-sky-500',
    };
  }
  if (event.status === 'scheduled' || event.status === 'in-progress') {
    return {
      row: 'bg-background-100/50 hover:bg-background-100',
      date: 'text-foreground-400',
      badge: 'bg-amber-100 text-amber-700',
      icon: 'ri-time-line text-amber-500',
    };
  }
  if (isCompletedEvent(event)) {
    return {
      row: 'hover:bg-background-50',
      date: 'text-foreground-400',
      badge: 'bg-primary-100 text-primary-700',
      icon: 'ri-check-line text-emerald-500',
    };
  }
  return {
    row: 'bg-background-100/50 hover:bg-background-100',
    date: 'text-foreground-400',
    badge: 'bg-orange-100 text-orange-700',
    icon: 'ri-calendar-schedule-line text-orange-500',
  };
}

/* ═══════════════════════════════════════════════════════════
   Priority model
   ───────────────────────────────────────────────────────────
   One ordered list decides who a coach opens first:
     At Risk → Overdue Review → Low OTJH → Poor Attendance → Missing Evidence
   Every reason is derived from a field the dashboard API already returns, so
   the badge on a row and the count on a tab can never disagree, and the answer
   to "why?" travels with the verdict instead of being re-guessed per panel.
   ═══════════════════════════════════════════════════════════ */
type PriorityKey = 'at-risk' | 'overdue-review' | 'low-otjh' | 'poor-attendance' | 'missing-evidence';

const PRIORITY_ORDER: PriorityKey[] = ['at-risk', 'overdue-review', 'low-otjh', 'poor-attendance', 'missing-evidence'];

const PRIORITY_RANK: Record<PriorityKey, number> = {
  'at-risk': 0,
  'overdue-review': 1,
  'low-otjh': 2,
  'poor-attendance': 3,
  'missing-evidence': 4,
};

const PRIORITY_META: Record<PriorityKey, { label: string; icon: string }> = {
  'at-risk': { label: 'At Risk', icon: 'ri-alarm-warning-line' },
  'overdue-review': { label: 'Overdue Review', icon: 'ri-calendar-close-line' },
  'low-otjh': { label: 'Low OTJH', icon: 'ri-time-line' },
  'poor-attendance': { label: 'Poor Attendance', icon: 'ri-calendar-check-line' },
  'missing-evidence': { label: 'Missing Evidence', icon: 'ri-file-list-3-line' },
};

// The priority vocabulary is five ranked reasons; StatusTone carries risk in
// four bands. `at-risk` and `overdue-review` both read as `critical` — both are
// "act now" severities, and the label text (not a second red shade) is what
// tells them apart.
const PRIORITY_TONE: Record<PriorityKey, StatusTone> = {
  'at-risk': 'critical',
  'overdue-review': 'critical',
  'low-otjh': 'caution',
  'poor-attendance': 'upcoming',
  'missing-evidence': 'brand',
};

/** Below this share of expected off-the-job hours a learner reads as behind. */
const LOW_OTJH_PERCENT = 75;

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

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

  // A learner already flagged at risk is not counted twice for the same hours.
  if (otjhStatus !== 'at-risk' && (otjhStatus === 'need-attention' || (otjhPercent !== null && otjhPercent < LOW_OTJH_PERCENT))) {
    reasons.push({
      key: 'low-otjh',
      label: 'Off-the-job hours behind target',
      detail: learner.otjhTarget > 0
        ? `${formatHours(learner.otjhCompleted)} of ${formatHours(learner.otjhTarget)} hrs recorded`
        : undefined,
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
  if (event.scheduledTime) return event.scheduledTime.slice(0, 5);
  if (event.timeLabel && event.timeLabel !== 'Time TBC') return event.timeLabel;
  return 'TBC';
}

/** "12 Sep 2025" -> "12 Sep", so a quick-stat cell stays one line. */
function shortDateLabel(value?: string | null) {
  const label = displayValue(value);
  if (label === EMPTY_VALUE) return EMPTY_VALUE;
  const parts = label.split(' ');
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : label;
}

const KPI_FILTER_LABEL: Record<DashboardKpi, string> = {
  caseload: 'Full caseload',
  active: 'Active learners',
  'on-break': 'Learners on break',
  'on-track': 'On track learners',
  'at-risk': 'At risk learners',
  'need-attention': 'Learners needing attention',
  gateway: 'Gateway learners',
  epa: 'EPA learners',
  evidence: 'Evidence awaiting review',
  reviews: 'Upcoming reviews',
};

function formatWeekRangeLabel() {
  const { start, end } = currentWeekRange();
  const format = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
  return `${format.format(start)} - ${format.format(end)}`;
}

/* ═══════════════════════════════════════════════════════════
   Scroll Reveal
   ═══════════════════════════════════════════════════════════ */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } }, { threshold: 0.04, rootMargin: '0px 0px -12px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`transition-all duration-[420ms] ease-out ${className} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
      {children}
    </div>
  );
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
        <div key={`schedule-skeleton-${groupIndex}`} className="rounded-xl border border-foreground-200/60 bg-background-50/70 p-3">
          <LoadingBlock className="h-4 w-32" />
          <div className="mt-3 space-y-3">
            {Array.from({ length: 2 }, (_, rowIndex) => (
              <div key={`schedule-row-${groupIndex}-${rowIndex}`} className="flex items-center gap-3">
                <LoadingBlock className="h-7 w-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <LoadingBlock className="h-3 w-3/5" />
                  <LoadingBlock className="mt-1.5 h-2.5 w-2/5" />
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
  // A KPI card does two jobs: the card body filters the learner list below it,
  // the corner control opens the full drill-down. Two pieces of state so one
  // never blocks the other.
  const [kpiFilter, setKpiFilter] = useState<DashboardKpi | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpi | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityKey | null>(null);
  const [ownerName, setOwnerName] = useState('Coach');
  const [learners, setLearners] = useState<CoachLearner[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CoachCalendarEvent[]>([]);
  const [calendarPreviewEvents, setCalendarPreviewEvents] = useState<CoachCalendarEvent[]>([]);
  const [liveSessionEvents, setLiveSessionEvents] = useState<CoachCalendarEvent[]>([]);
  const [evidenceQueue, setEvidenceQueue] = useState<EvidenceQueueLearner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [liveSessionsLoading, setLiveSessionsLoading] = useState(true);
  const [liveSessionsError, setLiveSessionsError] = useState<string | null>(null);

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
        const dashboard = await fetchSharedJsonGet<CoachDashboardApiResponse>(
          withCoachViewAs(coachDashboardEndpoint()),
          { signal: controller.signal, credentials: 'include' },
        );
        if (controller.signal.aborted) return;

        const queueItems = (dashboard.evidence?.items || []).map(normalizeEvidenceQueueLearner);
        const normalizedLearners = (dashboard.learners || []).map(normalizeLearner);
        const attendanceLearners = dashboard.attendance?.learners || [];
        const events = sortEvents(dashboard.timetable?.events || []);
        const nonLiveEvents = events.filter(event => event.source !== 'live-session');

        setOwnerName(displayValue(dashboard.owner?.name) === EMPTY_VALUE ? authenticatedCoachName : String(dashboard.owner?.name));
        setLearners(mergeEvidenceQueueIntoLearners(
          mergeAttendanceRates(normalizedLearners, attendanceLearners),
          queueItems,
        ));
        setEvidenceQueue(queueItems);
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
  const onBreakLearners = useMemo(() => enrichedLearners.filter(isOnBreakLearner), [enrichedLearners]);
  const gatewayLearners = useMemo(() => enrichedLearners.filter(isGatewayLearner), [enrichedLearners]);
  const epaLearners = useMemo(() => enrichedLearners.filter(isEpaLearner), [enrichedLearners]);
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
  const needAttentionCount = needAttentionLearners.length;
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
  const todayEvents = useMemo(() => {
    const todayIso = toIsoDate(new Date());
    return upcomingScheduleEvents.filter(event => {
      const date = parseLocalDate(eventDisplayDate(event));
      return Boolean(date && toIsoDate(date) === todayIso);
    });
  }, [upcomingScheduleEvents]);
  const overdueReviewEvents = useMemo(
    () => activeCalendarEvents.filter(event => event.source === 'progress-review' && isOverdueEvent(event)),
    [activeCalendarEvents],
  );
  const overdueCoachingEvents = useMemo(
    () => activeCalendarEvents.filter(event => event.source === 'mcr' && isOverdueEvent(event)),
    [activeCalendarEvents],
  );
  const unscheduledSoonEvents = useMemo(
    () => activeCalendarEvents.filter(event => needsScheduling(event) && !isOverdueEvent(event) && isWithinNextDays(event, 14)),
    [activeCalendarEvents],
  );

  /* ── This Week ── */
  const weekEvents = useMemo(
    () => [...activeCalendarEvents, ...liveSessionEvents].filter(event => isEventThisWeek(event)),
    [activeCalendarEvents, liveSessionEvents],
  );
  const weekReviewCount = weekEvents.filter(event => event.source === 'progress-review').length;
  const weekCoachingCount = weekEvents.filter(event => event.source === 'mcr').length;
  const weekLiveCount = weekEvents.filter(event => event.source === 'live-session').length;

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
    () => activeLearners
      .map(learner => ({ learner, priority: priorityMap.get(learner.id) }))
      .filter((entry): entry is { learner: CoachLearner; priority: LearnerPriority } => Boolean(entry.priority?.reasons.length))
      .sort((left, right) => right.priority.urgency - left.priority.urgency || left.learner.name.localeCompare(right.learner.name)),
    [activeLearners, priorityMap],
  );
  const priorityCounts = useMemo(() => {
    const counts = {} as Record<PriorityKey, number>;
    PRIORITY_ORDER.forEach(key => { counts[key] = 0; });
    attentionQueue.forEach(entry => entry.priority.keys.forEach(key => { counts[key] += 1; }));
    return counts;
  }, [attentionQueue]);

  const kpiFilterPredicate = useMemo((): ((learner: CoachLearner) => boolean) | null => {
    switch (kpiFilter) {
      case 'caseload': return () => true;
      case 'active': return isActiveLearner;
      case 'on-break': return isOnBreakLearner;
      case 'gateway': return isGatewayLearner;
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
    return priorityFilter
      ? attentionQueue.filter(entry => entry.priority.keys.has(priorityFilter))
      : attentionQueue;
  }, [attentionQueue, enrichedLearners, kpiFilterPredicate, priorityFilter, priorityMap]);

  const attentionPanelTitle = kpiFilter ? KPI_FILTER_LABEL[kpiFilter] : 'Learners Requiring Attention';
  const attentionPanelSubtitle = kpiFilter
    ? 'Filtered from the KPI cards above, ordered by priority'
    : 'At Risk → Overdue Review → Low OTJH → Poor Attendance → Missing Evidence';
  const attentionHasOverflow = attentionRows.length > AT_RISK_SCROLL_THRESHOLD;

  const schedulePanelLoading = (calendarLoading || liveSessionsLoading) && !upcomingScheduleEvents.length;

  const scrollToSection = (id: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const scrollToAttention = () => scrollToSection('learner-caseload');
  const scrollToToday = () => scrollToSection('today-actions');

  const openCaseloadFilter = (_filter: OtjhFilter) => {
    scrollToAttention();
  };

  const applyKpiFilter = (kpi: DashboardKpi) => {
    setPriorityFilter(null);
    setKpiFilter(current => (current === kpi ? null : kpi));
    if (kpiFilter !== kpi) scrollToAttention();
  };

  const applyPriorityFilter = (key: PriorityKey) => {
    setKpiFilter(null);
    setPriorityFilter(current => (current === key ? null : key));
  };

  const allActionItems: ActionItem[] = [
    {
      id: 'overdue-reviews',
      label: 'Progress reviews overdue',
      hint: 'Past their target date',
      count: overdueReviewEvents.length,
      icon: 'ri-calendar-close-line',
      tone: 'danger',
      to: '/coach/progress-reviews',
    },
    {
      id: 'overdue-coaching',
      label: 'Coaching sessions overdue',
      hint: 'Monthly coaching not held',
      count: overdueCoachingEvents.length,
      icon: 'ri-user-voice-line',
      tone: 'danger',
      to: '/coach/meetings',
    },
    {
      id: 'at-risk',
      label: 'Learners at risk',
      hint: 'Need immediate coaching action',
      count: atRiskCount,
      icon: 'ri-alarm-warning-line',
      tone: 'danger',
      onClick: () => applyKpiFilter('at-risk'),
    },
    {
      id: 'evidence',
      label: 'Evidence awaiting review',
      hint: `${evidenceLearners.length} ${evidenceLearners.length === 1 ? 'learner' : 'learners'} waiting`,
      count: pendingEvidence,
      icon: 'ri-file-search-line',
      tone: 'warning',
      onClick: () => setSelectedKpi('evidence'),
    },
    {
      id: 'unscheduled',
      label: 'Sessions needing a date',
      hint: 'Due within 14 days',
      count: unscheduledSoonEvents.length,
      icon: 'ri-calendar-schedule-line',
      tone: 'warning',
      to: '/coach/timetable',
    },
  ];
  const actionItems = allActionItems.filter(item => item.count > 0);
  // The number that answers "how much is on me today" for the KPI strip —
  // a straight sum of the same counts the action list below already shows.
  const needsActionCount = actionItems.reduce((total, item) => total + item.count, 0);

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
          />
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Coach Dashboard" pageSubtitle="Who needs attention, what needs doing today, what is coming next"
      userName={ownerName} userRole="Progress Coach"
    >
      <PageContainer>

        {/* ═══════════════════════════════════════════════════
            1. CASELOAD HEALTH — the 3-4 numbers that matter, not
               eight equally-loud tiles.
            ═══════════════════════════════════════════════════ */}
        {/* The coach dashboard uses the same opening rhythm as the Super Admin
            dashboard: a welcome row followed by the shared control hero. */}
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground-950 md:text-3xl">Welcome back, {ownerName} 👋</h1>
            <p className="mt-1 text-[11px] text-foreground-500 md:text-xs">Monitor your caseload health, learner progress and coaching actions in real time.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/coach/timetable"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-foreground-200/70 bg-background-50 px-3 text-[11px] font-semibold text-foreground-700 shadow-sm transition-smooth hover:border-primary-300 hover:bg-primary-50/40"
            >
              <AppIcon className="ri-calendar-line text-sm text-foreground-500"></AppIcon>
              <span>{formatWeekRangeLabel()}</span>
              <AppIcon className="ri-arrow-right-s-line text-xs text-foreground-400"></AppIcon>
            </Link>
            <button
              type="button"
              onClick={scrollToAttention}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-foreground-200/70 bg-background-50 px-3 text-[11px] font-semibold text-foreground-700 shadow-sm transition-smooth hover:border-primary-300 hover:bg-primary-50/40"
            >
              <AppIcon className="ri-equalizer-line text-sm text-foreground-500"></AppIcon>
              <span>Filters</span>
            </button>
          </div>
        </div>

        <WorkspaceHeroBanner
          title="Coach Control"
          description="Caseload health, learner progress and coaching actions"
          icon="ri-user-heart-line"
          stats={[
            { label: 'Caseload', value: String(totalCaseload) },
            { label: 'At risk', value: String(atRiskCount) },
            { label: 'Need action', value: String(needsActionCount) },
          ]}
        />

        <SectionReveal delay={40}>
          <div className="space-y-3">
            <SectionHeader icon="ri-pulse-line" title="Caseload health" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <FilterMetricCard
                label="Caseload"
                value={totalCaseload}
                note={`${onTrackCount} on track`}
                tone="brand"
                icon="ri-group-line"
                active={kpiFilter === 'caseload'}
                onFilter={() => applyKpiFilter('caseload')}
                onExpand={() => setSelectedKpi('caseload')}
              />
              <FilterMetricCard
                label="Needs action today"
                value={needsActionCount}
                note={actionItems.length ? `${actionItems.length} item${actionItems.length === 1 ? '' : 's'} to review` : 'Nothing overdue'}
                tone={needsActionCount > 0 ? 'critical' : 'positive'}
                icon="ri-alarm-warning-line"
                active={false}
                onFilter={scrollToToday}
              />
              <FilterMetricCard
                label="At risk"
                value={atRiskCount}
                note={OTJH_STATUS_META['at-risk'].sub}
                tone="critical"
                icon="ri-alarm-warning-line"
                active={kpiFilter === 'at-risk'}
                onFilter={() => applyKpiFilter('at-risk')}
                onExpand={() => setSelectedKpi('at-risk')}
              />
              <FilterMetricCard
                label="Need attention"
                value={needAttentionCount}
                note={OTJH_STATUS_META['need-attention'].sub}
                tone="caution"
                icon="ri-error-warning-line"
                active={kpiFilter === 'need-attention'}
                onFilter={() => applyKpiFilter('need-attention')}
                onExpand={() => setSelectedKpi('need-attention')}
              />
            </div>
            <MetricRow>
              <FilterCompactMetric label="On track" value={onTrackCount} note={OTJH_STATUS_META['on-track'].sub} tone="positive" active={kpiFilter === 'on-track'} onFilter={() => applyKpiFilter('on-track')} />
              <FilterCompactMetric label="Active" value={activeLearners.length} note="Currently active" tone="positive" active={kpiFilter === 'active'} onFilter={() => applyKpiFilter('active')} />
              <FilterCompactMetric label="On break" value={onBreakLearners.length} note="Programme paused" tone="caution" active={kpiFilter === 'on-break'} onFilter={() => applyKpiFilter('on-break')} />
              <FilterCompactMetric label="Gateway" value={gatewayLearners.length} note="At gateway stage" tone="upcoming" active={kpiFilter === 'gateway'} onFilter={() => applyKpiFilter('gateway')} />
              <FilterCompactMetric label="EPA" value={epaLearners.length} note="At EPA stage" tone="info" active={kpiFilter === 'epa'} onFilter={() => applyKpiFilter('epa')} />
              <button type="button" onClick={() => setSelectedKpi('evidence')} className="rounded-lg p-1 text-left transition-colors hover:bg-background-100/70">
                <CompactMetric
                  label="Evidence pending"
                  value={pendingEvidence}
                  note={`${evidenceLearners.length} learner${evidenceLearners.length === 1 ? '' : 's'} waiting`}
                  tone={pendingEvidence > 0 ? 'caution' : 'neutral'}
                />
              </button>
            </MetricRow>
          </div>
        </SectionReveal>

        {(loading || loadWarning) && (
          <div className={`rounded-lg border px-3.5 py-2.5 text-[12.5px] ${loadWarning ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-foreground-200/60 bg-background-50 text-foreground-500'}`}>
            {loading ? 'Loading live coach dashboard data...' : loadWarning}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            2. TODAY & NEEDS ACTION — overdue reviews, at-risk
               learners, evidence and unscheduled sessions.
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={70}>
          <div id="today-actions" className="scroll-mt-4">
          <Panel padding="lg">
            <SectionHeader
              icon="ri-focus-3-line"
              title="Today &amp; needs action"
              description="Overdue reviews, at-risk learners and urgent tasks"
              actions={<StatusBadge tone="info" dot={false} label={`${todayEvents.length} today`} />}
            />

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {actionItems.map(item => (
                <ActionRow
                  key={item.id}
                  tone={ACTION_TONE[item.tone]}
                  onClick={() => (item.to ? navigate(item.to) : item.onClick?.())}
                  leading={
                    <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', toneStyle(ACTION_TONE[item.tone]).bg, toneStyle(ACTION_TONE[item.tone]).text)}>
                      <AppIcon className={cn(item.icon, 'text-[17px]')}></AppIcon>
                    </span>
                  }
                  title={item.label}
                  subtitle={item.hint}
                  meta={<span className={cn('text-[20px] font-semibold tabular-nums', toneStyle(ACTION_TONE[item.tone]).text)}>{item.count}</span>}
                  actions={<AppIcon className="ri-arrow-right-s-line text-[17px] text-foreground-300"></AppIcon>}
                />
              ))}
              {loading && !actionItems.length && (
                <>
                  <LoadingBlock className="h-[76px] rounded-2xl" />
                  <LoadingBlock className="h-[76px] rounded-2xl" />
                </>
              )}
            </div>
            {!loading && !actionItems.length && (
              <EmptyState
                size="sm"
                icon="ri-check-double-line"
                title="Nothing overdue"
                description="No reviews, sessions or evidence are waiting on you."
              />
            )}

            {todayEvents.length > 0 && (
              <div className="mt-4 border-t border-foreground-100 pt-3.5">
                <SectionLabel>On today</SectionLabel>
                <div className="mt-2 flex flex-wrap gap-2">
                  {todayEvents.slice(0, 6).map(event => (
                    <Link
                      key={`today-${event.eventKey || event.id}`}
                      to="/coach/timetable"
                      state={buildTimetableFocusState(event)}
                      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-primary-100 bg-primary-50/60 px-2.5 py-1.5 text-[12px] text-primary-800 transition-colors hover:bg-primary-100"
                    >
                      <span className="font-semibold tabular-nums">{scheduleEventTime(event)}</span>
                      <span className="text-primary-300">&middot;</span>
                      <span className="truncate">{scheduleEventTitle(event)}</span>
                    </Link>
                  ))}
                  {todayEvents.length > 6 && (
                    <span className="inline-flex items-center rounded-lg border border-foreground-200 bg-background-100 px-2.5 py-1.5 text-[12px] text-foreground-500">
                      +{todayEvents.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </Panel>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            3. LEARNERS REQUIRING ATTENTION  +  4. UPCOMING SCHEDULE
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={100}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

            <div id="learner-caseload" className="scroll-mt-4 lg:col-span-2">
            <Panel padding="lg">
              <SectionHeader
                icon="ri-user-search-line"
                title={attentionPanelTitle}
                count={attentionRows.length}
                description={attentionPanelSubtitle}
                actions={
                  <Link
                    to="/coach/caseload"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-[12px] font-semibold text-primary-700 transition-colors hover:bg-primary-100"
                  >
                    <AppIcon className="ri-group-line text-[13px]"></AppIcon>
                    All learners
                  </Link>
                }
              />

              {/* Priority queue filters */}
              <div className="mt-3.5">
                {kpiFilter ? (
                  <FilterChip label="Filter" value={KPI_FILTER_LABEL[kpiFilter]} onRemove={() => setKpiFilter(null)} />
                ) : (
                  <PageTabs
                    label="Filter learners by priority"
                    value={priorityFilter ?? 'all'}
                    onChange={(next) => (next === 'all' ? setPriorityFilter(null) : applyPriorityFilter(next as PriorityKey))}
                    items={priorityTabItems(attentionQueue.length, priorityCounts)}
                  />
                )}
              </div>

              <div className={cn('mt-3.5 space-y-2.5', attentionHasOverflow && 'max-h-[36rem] overflow-y-auto pr-1.5')}>
                {loading && !attentionRows.length && <AttentionSkeleton />}
                {!loading && attentionRows.map((entry, index) => (
                  <AttentionLearnerRow
                    key={entry.learner.id}
                    rank={index + 1}
                    learner={entry.learner}
                    priority={entry.priority}
                    onOpen={() => navigate(`/coach/learner-case-file?id=${encodeURIComponent(entry.learner.id)}`, {
                      state: { learnerId: entry.learner.id, learnerName: entry.learner.name },
                    })}
                  />
                ))}
                {!loading && !attentionRows.length && (
                  <EmptyState
                    variant={kpiFilter || priorityFilter ? 'no-matches' : 'empty'}
                    icon={kpiFilter || priorityFilter ? undefined : 'ri-shield-check-line'}
                    title={kpiFilter || priorityFilter ? 'No learners match this filter' : 'No learners need attention'}
                    description={kpiFilter || priorityFilter
                      ? 'Clear the filter to see the full priority queue.'
                      : 'Everyone on your caseload is on track for hours, attendance and reviews.'}
                  />
                )}
              </div>
            </Panel>
            </div>

            {/* ── Upcoming Schedule (live sessions + calendar, merged) ── */}
            <Panel className="flex flex-col" padding="lg">
              <SectionHeader
                icon="ri-calendar-schedule-line"
                title="Upcoming schedule"
                description={`Next ${COACHING_CALENDAR_WINDOW_DAYS} days · live, coaching & reviews`}
                actions={
                  <Link
                    to="/coach/timetable"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-1.5 text-[12px] font-semibold text-primary-700 transition-colors hover:bg-primary-100"
                  >
                    <AppIcon className="ri-calendar-line text-[13px]"></AppIcon>
                    Calendar
                  </Link>
                }
              />

              <div className="mt-3.5 max-h-[36rem] min-h-0 flex-1 space-y-3 overflow-y-auto pr-1.5">
                {schedulePanelLoading && <ScheduleSkeleton />}
                {!schedulePanelLoading && upcomingScheduleGroups.map(group => (
                  <div key={`schedule-group-${group.date}`} className="rounded-lg border border-foreground-200/60 bg-background-100/40 p-3">
                    <div className="flex items-center justify-between gap-2 border-b border-foreground-100 pb-2">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-[17px] font-bold leading-none text-foreground-900">{formatCalendarDayNumber(group.date)}</span>
                        <span className="min-w-0 truncate text-[12px] font-semibold text-foreground-700">{formatUpcomingLiveSessionDayLabel(group.date)}</span>
                        <span className="shrink-0 text-[12px] text-foreground-400">{formatCalendarWeekday(group.date)} &middot; {formatCalendarMonth(group.date)}</span>
                      </div>
                      <span className="shrink-0 rounded-full bg-background-100 px-2 py-0.5 text-[12px] font-semibold text-foreground-500">{group.events.length}</span>
                    </div>
                    <div className="divide-y divide-foreground-100/80">
                      {group.events.map(event => {
                        const classes = eventStatusClasses(event);
                        return (
                          <Link
                            key={event.eventKey || event.id}
                            to="/coach/timetable"
                            state={buildTimetableFocusState(event)}
                            className="group flex items-center gap-3 py-2.5 transition-colors first:pt-2 last:pb-0.5 hover:text-primary-800"
                          >
                            <span className={cn('w-14 shrink-0 rounded-md px-2 py-1 text-center text-[12px] font-bold tabular-nums', classes.badge)}>
                              {scheduleEventTime(event)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-foreground-900">{scheduleEventTitle(event)}</span>
                              <span className="mt-0.5 block truncate text-[12px] text-foreground-400">{scheduleEventMeta(event)}</span>
                            </span>
                            <AppIcon className={cn('shrink-0 text-[14px] transition-transform group-hover:translate-x-0.5', classes.icon)}></AppIcon>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!schedulePanelLoading && !upcomingScheduleGroups.length && (
                  <EmptyState
                    size="sm"
                    icon="ri-calendar-check-line"
                    title="Nothing scheduled"
                    description={calendarError || liveSessionsError || `Nothing scheduled in the next ${COACHING_CALENDAR_WINDOW_DAYS} days.`}
                  />
                )}
              </div>
            </Panel>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            5. THIS WEEK — weekly activity summary, lowest priority.
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={130}>
          <div className="space-y-3">
            <SectionHeader icon="ri-calendar-2-line" title="This week" description={formatWeekRangeLabel()} />
            <MetricRow>
              <CompactMetric label="Sessions" value={weekEvents.length} />
              <CompactMetric label="Progress reviews" value={weekReviewCount} />
              <CompactMetric label="Coaching sessions" value={weekCoachingCount} />
              <CompactMetric label="Live sessions" value={weekLiveCount} />
              <CompactMetric label="Evidence to mark" value={pendingEvidence} tone={pendingEvidence > 0 ? 'caution' : 'neutral'} />
              <CompactMetric label="Need attention" value={attentionQueue.length} tone={attentionQueue.length > 0 ? 'critical' : 'positive'} />
            </MetricRow>
          </div>
        </SectionReveal>
      </PageContainer>

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

/* ═══════════════════════════════════════════════════════════
   Metric cards — MetricCard/CompactMetric only filter the list
   below when clicked, per the shared component's contract. The
   overlay button adds the one thing that contract doesn't cover
   for this page: a corner control that opens the KPI drill-down
   modal without turning the whole card into a nested button.
   ═══════════════════════════════════════════════════════════ */
function FilterMetricCard({ label, value, note, tone, icon, active, onFilter, onExpand }: {
  label: string;
  value: number;
  note?: string;
  tone: StatusTone;
  icon: string;
  active: boolean;
  onFilter: () => void;
  onExpand?: () => void;
}) {
  return (
    <div className="relative">
      <MetricCard label={label} value={value} note={note} tone={tone} icon={icon} active={active} />
      <button
        type="button"
        onClick={onFilter}
        aria-pressed={active}
        aria-label={`Filter by ${label}`}
        title={`${label}${note ? ` — ${note}` : ''}. Filters the learner list below.`}
        className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      />
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Open ${label} details`}
          title={`Open ${label} details`}
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-background-100 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
        >
          <AppIcon className="ri-arrow-right-up-line text-[13px]"></AppIcon>
        </button>
      ) : null}
    </div>
  );
}

function FilterCompactMetric({ label, value, note, tone, active, onFilter }: {
  label: string;
  value: number;
  note?: string;
  tone: StatusTone;
  active: boolean;
  onFilter: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFilter}
      aria-pressed={active}
      className={cn('rounded-lg p-1 text-left transition-colors', active ? 'bg-primary-50/70' : 'hover:bg-background-100/70')}
    >
      <CompactMetric label={label} value={value} note={note} tone={tone} />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   Today / Needs Action row
   ═══════════════════════════════════════════════════════════ */
interface ActionItem {
  id: string;
  label: string;
  hint: string;
  count: number;
  icon: string;
  tone: 'danger' | 'warning';
  to?: string;
  onClick?: () => void;
}

const ACTION_TONE: Record<ActionItem['tone'], StatusTone> = { danger: 'critical', warning: 'caution' };

/* ═══════════════════════════════════════════════════════════
   Priority filter tabs — "All" plus the five ranked reasons,
   in priority order, hiding whichever have nothing in them.
   ═══════════════════════════════════════════════════════════ */
function priorityTabItems(totalCount: number, counts: Record<PriorityKey, number>): PageTabItem[] {
  return [
    { value: 'all', label: 'All', count: totalCount },
    ...PRIORITY_ORDER.map(key => ({
      value: key,
      label: PRIORITY_META[key].label,
      count: counts[key],
      tone: PRIORITY_TONE[key],
      hideWhenEmpty: true,
    })),
  ];
}

/* ═══════════════════════════════════════════════════════════
   Learners Requiring Attention — one row per learner: rank,
   who, why, and the four figures a coach checks before opening
   the case file.
   ═══════════════════════════════════════════════════════════ */
function AttentionLearnerRow({ rank, learner, priority, onOpen }: {
  rank: number;
  learner: CoachLearner;
  priority: LearnerPriority;
  onOpen: () => void;
}) {
  const primary = priority.primary;
  const tone = primary ? PRIORITY_TONE[primary.key] : 'neutral';
  const extraReasons = Math.max(priority.reasons.length - 1, 0);

  const otjhPercent = otjhPercentFor(learner);
  const otjhLabel = learner.otjhTarget > 0 ? `${formatHours(learner.otjhCompleted)}/${formatHours(learner.otjhTarget)} hrs` : EMPTY_VALUE;
  const progressLabel = learner.overallProgressAvailable ? `${learner.overallProgress}%` : EMPTY_VALUE;
  const attendanceLabel = learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
  const review = nextReviewCell(learner);
  const programmeLine = learner.group !== EMPTY_VALUE ? learner.group : learner.programme;

  const detail = [
    primary?.detail,
    programmeLine !== EMPTY_VALUE ? programmeLine : null,
    extraReasons > 0 ? `+${extraReasons} more reason${extraReasons === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ') || undefined;

  return (
    <ActionRow
      tone={tone}
      onClick={onOpen}
      leading={<LearnerAvatar name={learner.name} initials={learner.initials} tone={tone} />}
      title={
        <span className="flex items-center gap-2">
          <span className="hidden text-[12px] font-semibold text-foreground-300 lg:inline">{rank}</span>
          {learner.name}
        </span>
      }
      status={primary ? <StatusBadge tone={tone} label={PRIORITY_META[primary.key].label} size="sm" /> : null}
      subtitle={
        primary
          ? <ReasonLine icon={PRIORITY_META[primary.key].icon} label={primary.label} detail={detail} tone={tone} />
          : 'On track across hours, attendance and reviews'
      }
      meta={
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
          <CompactMetric label="Progress" value={progressLabel} tone={percentTone(learner.overallProgressAvailable ? learner.overallProgress : null, 40, 75)} />
          <CompactMetric label="OTJH" value={otjhLabel} tone={percentTone(otjhPercent, 45, LOW_OTJH_PERCENT)} />
          <CompactMetric label="Attendance" value={attendanceLabel} tone={percentTone(learner.attendanceRateAvailable ? learner.attendanceRate : null, ATTENDANCE_MINIMUM_RATE, ATTENDANCE_EXPECTED_RATE)} />
          <CompactMetric label="Next review" value={review.value} tone={review.tone} />
        </div>
      }
      actions={<AppIcon className="ri-arrow-right-s-line text-[15px] text-foreground-300"></AppIcon>}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   Next review cell — an overdue review says so rather than
   showing a date the coach has to compare against today.
   ═══════════════════════════════════════════════════════════ */
function nextReviewCell(learner: CoachLearner): { value: string; tone: StatusTone } {
  if (learner.nextReviewStatus === 'overdue') return { value: 'Overdue', tone: 'critical' };
  if (learner.nextReviewStatus === 'needs-schedule') return { value: shortDateLabel(learner.nextReview), tone: 'caution' };
  if (learner.nextReviewStatus === 'upcoming') return { value: shortDateLabel(learner.nextReview), tone: 'neutral' };
  return { value: EMPTY_VALUE, tone: 'neutral' };
}

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
  onFilter: (filter: OtjhFilter) => void;
}) {
  const navigate = useNavigate();
  const meta: Record<DashboardKpi, { title: string; subtitle: string; icon: string; iconStyle: string }> = {
    caseload: { title: 'Learner caseload', subtitle: 'All learners currently assigned to you', icon: 'ri-group-line', iconStyle: 'bg-primary-100 text-primary-600' },
    active: { title: 'Active learners', subtitle: 'Learners currently active on their programme', icon: 'ri-user-follow-line', iconStyle: 'bg-emerald-100 text-emerald-600' },
    'on-break': { title: 'Learners on break', subtitle: 'Learners whose programme is currently paused', icon: 'ri-pause-circle-line', iconStyle: 'bg-amber-100 text-amber-600' },
    'on-track': { title: 'Learners on track', subtitle: 'Learners currently meeting their OTJH target', icon: 'ri-checkbox-circle-line', iconStyle: 'bg-emerald-100 text-emerald-600' },
    'at-risk': { title: 'Learners at risk', subtitle: 'Learners requiring immediate coaching action', icon: 'ri-alarm-warning-line', iconStyle: 'bg-red-100 text-red-600' },
    'need-attention': { title: 'Learners needing attention', subtitle: 'Learners who need targeted support this week', icon: 'ri-error-warning-line', iconStyle: 'bg-amber-100 text-amber-600' },
    gateway: { title: 'Gateway learners', subtitle: 'Learners currently at the gateway stage', icon: 'ri-flag-line', iconStyle: 'bg-accent-100 text-accent-700' },
    epa: { title: 'EPA learners', subtitle: 'Learners currently at the end-point assessment stage', icon: 'ri-award-line', iconStyle: 'bg-secondary-100 text-secondary-700' },
    evidence: { title: 'Evidence awaiting review', subtitle: 'Evidence submissions and review status', icon: 'ri-file-search-line', iconStyle: 'bg-secondary-100 text-secondary-600' },
    reviews: { title: 'Upcoming reviews', subtitle: 'Progress reviews scheduled in the next 14 days', icon: 'ri-file-chart-line', iconStyle: 'bg-primary-100 text-primary-600' },
  };
  const current = meta[type];
  const filterForType: Partial<Record<DashboardKpi, OtjhFilter>> = { 'at-risk': 'at-risk' };
  const modalLearners = type === 'caseload'
    ? learners
    : type === 'active'
      ? learners.filter(isActiveLearner)
      : type === 'on-break'
        ? learners.filter(isOnBreakLearner)
      : type === 'gateway'
        ? learners.filter(isGatewayLearner)
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
      state: { learnerId: learner.id, learnerName: learner.name },
    });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 lg:p-8" role="dialog" aria-modal="true" aria-labelledby="kpi-modal-title" aria-describedby="kpi-modal-description">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-foreground-950/10 backdrop-blur-[5px] backdrop-saturate-125" aria-label="Close popup"></button>
      <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/80 bg-background-50 shadow-xl">
        <header className="relative overflow-hidden border-b border-foreground-100/80 bg-gradient-to-r from-primary-50/90 via-background-50 to-secondary-50/60 px-5 py-5 sm:px-7 sm:py-6">
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
          {(type === 'caseload' || type === 'active' || type === 'on-break' || type === 'on-track' || type === 'at-risk' || type === 'need-attention' || type === 'gateway' || type === 'epa') && (
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
                          ) : type === 'gateway' || type === 'epa' ? (
                            <StatusBadge tone={type === 'gateway' ? 'upcoming' : 'info'} label={type === 'gateway' ? 'Gateway' : 'EPA'} size="sm" />
                          ) : (
                            <StatusBadge tone={status.tone} label={status.label} size="sm" />
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-foreground-500">{learner.programme} <span className="text-foreground-300">·</span> {learner.group}</p>
                      </div>
                    </div>
                    <div className="grid min-w-0 grid-cols-3 gap-2 text-center sm:col-span-2 lg:col-span-1 lg:min-w-[320px]">
                      <ModalMiniMetric label="OTJH" value={otjh} />
                      <ModalMiniMetric label="KSB" value={learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE} />
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
              {evidenceLearners.map(learner => (
                <Link
                  key={learner.id}
                  to={`/coach/learner-case-file?id=${encodeURIComponent(learner.learnerId)}&tab=evidence`}
                  state={{ learnerId: learner.learnerId, learnerName: learner.learner, tab: 'evidence' }}
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
              ))}
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
          {filterForType[type] && <button type="button" onClick={() => onFilter(filterForType[type]!)} className="rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Jump to at-risk list</button>}
          {type === 'evidence' && <Link to="/coach/marking-queue" onClick={onClose} className="rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open marking queue</Link>}
          {type === 'reviews' && <Link to="/coach/progress-reviews" onClick={onClose} className="rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open reviews</Link>}
        </footer>
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
