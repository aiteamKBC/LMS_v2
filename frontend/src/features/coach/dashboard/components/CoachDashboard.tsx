import { reviewCategory } from '@/lib/reviewCategory';
import { Fragment, useState, useEffect, useMemo, useCallback, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { setCoachViewAs } from '@/lib/coachViewAs';
import { recordAction } from '@/lib/activityTrail';
import { useAuth } from '@/hooks/useAuth';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachAuditTrailNavItem, roleNavMap } from '@/mocks/navigation';
import { CoachDirectoryPicker } from './CoachDirectoryPicker';
import { AllCoachesCalendar } from './AllCoachesCalendar';
import { DashboardMeetingActions } from './DashboardMeetingActions';
import type { DirectoryCoach } from '@/api/coachDirectory';
import { cn } from '@/lib/cn';
import { ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import { isVisibleCaseloadLearner, otjhProgressAsOfToday, parseDisplayDate } from '@/pages/coach/caseload/lib/format';
import styles from '@/pages/workspace/coach/dashboard.module.css';
import modalStyles from './LearnerCaseloadModal.module.css';
import markingStyles from './PendingMarkingModal.module.css';
import { CoachCaseloadContent } from '@/pages/coach/caseload/page';
import { CaseloadLoading } from '@/pages/coach/caseload/components/CaseloadStates';
import caseloadStyles from '@/pages/coach/caseload/caseload.module.css';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import type { ImportedReview } from '@/api/reviewHistory';
import type { EmbeddedCaseloadLearner } from '@/pages/coach/caseload/types';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import {
  type CoachCalendarEvent,
  reviewScheduleAvailable,
  eventDisplayDate,
  eventTargetDate,
  eventPeriodLabel,
  formatDateLabel,
  formatTimeLabel as calendarTimeLabel,
  formatTimeRangeLabel,
  isAtRiskEvent,
  isCompletedEvent,
  needsScheduling,
  parseLocalDate,
  sortEvents,
  startOfDay,
  statusLabel,
} from '@/pages/coach/shared/calendarEvents';
import { clearDashboardLearnerPageCache, fetchCoachDashboard, fetchDashboardSection } from '../api/dashboardApi';
import { selectAtRiskPopupLearners, type DashboardPopupLearner } from '../api/dashboardSummary';
import { getCurrentWorkWeekRange, getNextWorkWeekRange, isEventThisWeek, useDashboardBusinessDate } from '../api/dashboardWeek';

const coachNav = roleNavMap.coach;

type DashboardKpi = 'caseload' | 'active' | 'on-break' | 'on-track' | 'at-risk' | 'need-attention' | 'completed' | 'epa' | 'evidence' | 'reviews' | 'pending-marking' | 'pr-week' | 'mcm-week' | 'catch-ups-week';
type CoachDashboardTab = 'learners' | 'meetings' | 'risk';
type OtjhStatusKey = 'at-risk' | 'need-attention' | 'on-track' | 'unknown';
type PerformanceStatus = 'on-track' | 'at-risk' | 'high' | 'new-starter';
type ScheduleStatus = 'upcoming' | 'overdue' | 'needs-schedule' | 'none';

const EMPTY_VALUE = '--';
const UPCOMING_MEETING_SOURCES = new Set(['progress-review', 'mcr', 'catch-up', 'support', 'student-support', 'live-session']);
const COACH_DASHBOARD_TABS: { id: CoachDashboardTab; label: string }[] = [
  { id: 'learners', label: 'All Learners' },
  { id: 'meetings', label: 'Upcoming Meetings' },
  { id: 'risk', label: 'Risk Insights' },
];

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
  /** Whole-programme training-plan total used to calculate today's target. */
  otjhPlanned?: number | null;
  startDate?: string | null;
  plannedEndDate?: string | null;
  programme: string;
  programmeName?: string | null;
  cohortName?: string | null;
  group: string;
  employer: string;
  avatar: string;
  /** Legacy composite learner performance, not OTJH. See otjhRagStatus. */
  status: PerformanceStatus;
  riskFlags: string[];
  overallProgress: number;
  overallProgressAvailable?: boolean;
  attendanceRate: number;
  attendanceRateAvailable?: boolean;
  attendanceAvailable?: boolean;
  activityProgress?: number | null;
  activityProgressAvailable?: boolean;
  componentsCompleted?: number | null;
  componentsPlanned?: number | null;
  attendancePresent?: number | null;
  attendanceSessions?: number | null;
  attendanceAbsent?: number | null;
  attendanceConsecutiveMissed?: number | null;
  attendanceLastSession?: string | null;
  attendanceLastSessionDate?: string | null;
  otjhCompleted: number;
  otjhTarget: number;
  otjhVariance?: number | null;
  otjhStatus?: string | null;
  otjhTargetAsOfToday?: number | null;
  otjhProgressAsOfToday?: number | null;
  otjhShortfallHours?: number | null;
  otjhDeltaHours?: number | null;
  otjhRagStatus?: 'at-risk' | 'need-attention' | 'on-track' | 'unavailable' | null;
  otjhRagSource?: string | null;
  ksbCompleted?: number | null;
  ksbTarget?: number | null;
  ksbProgress: number | null;
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
  lastActivity?: string;
  lastActivityDate?: string | null;
  lastActivityLabel?: string;
  lastMcm?: string;
  lastPr?: string;
  recentFlag: string | null;
  email?: string | null;
  rawProgramStatus?: string | null;
  enrollmentStatus?: string | null;
  mcmReviews: ImportedReview[];
  reviews: ImportedReview[];
}

type CaseloadApiLearner = EmbeddedCaseloadLearner & Partial<CoachLearner> & {
  cohortName?: string | null;
};

interface CaseloadApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  learners?: CaseloadApiLearner[];
}

interface MonthlyRiskPoint {
  month: string;
  label: string;
  count: number;
  available?: boolean;
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

interface WeeklyCounts { progressReviews: number; monthlyCoaching: number; catchUps: number; reviewsAvailable: boolean }
interface DashboardTotals {
  totalLearners: number;
  otjhAtRisk: number;
  needAttention: number;
  pendingMarking: number | null;
  prThisWeek: number | null;
  mcmThisWeek: number | null;
  catchUpsThisWeek: number;
}

interface CoachDashboardApiResponse extends CaseloadApiResponse {
  popupLearners?: DashboardPopupLearner[];
  popupWeekEvents?: CoachCalendarEvent[];
  totals?: DashboardTotals;
  weeklyCounts?: WeeklyCounts;
  monthlyRisk?: MonthlyRiskPoint[] | null;
  // Attendance is not a separate dataset: the backend overlays the one
  // canonical figure directly onto each learners[] entry
  // (attendanceRate/attendanceRateAvailable/attendanceLastSession*).
  reviewHistory?: {
    learners?: ReviewHistoryApiLearner[];
  };
  meetings?: {
    events?: CoachCalendarEvent[];
    summary?: { progressReviewRows?: number; mcrRows?: number; learnersWithDates?: number; reviewAnchorSkipped?: number; reviewAnchorSkipReasons?: Record<string, number> };
    reviewGenerationIssues?: Array<{ learnerId?: string; code?: string }>;
  };
  marking?: MarkingQueueResponse;
  assignedGroups?: CoachAssignedGroup[];
  errors?: Record<string, string>;
}

interface CachedCoachDashboard {
  popupLearners?: DashboardPopupLearner[];
  popupWeekEvents?: CoachCalendarEvent[];
  totals?: DashboardTotals;
  weeklyCounts?: WeeklyCounts;
  ownerName: string;
  learners: CoachLearner[];
  monthlyRisk: MonthlyRiskPoint[] | null;
  calendarEvents: CoachCalendarEvent[];
  calendarPreviewEvents: CoachCalendarEvent[];
  liveSessionEvents: CoachCalendarEvent[];
  evidenceQueue: EvidenceQueueLearner[];
  markingThisWeek: number | undefined;
  reviewGenerationAvailable: boolean;
  calendarError: string | null;
}

// Keep the last successful dashboard per signed-in account and effective coach.
// Route changes unmount this page, so component state alone would otherwise
// replace useful data with the full-page skeleton every time the coach returns.
const dashboardSessionCache = new Map<string, CachedCoachDashboard>();
const dashboardSectionSessionCache = new Map<string, CoachDashboardApiResponse>();

function dashboardCacheKey(accountEmail: string, coachEmail: string, day: string) {
  return `${accountEmail.trim().toLowerCase()}::${coachEmail.trim().toLowerCase()}::${day}`;
}

export function clearCoachDashboardSessionCache() {
  dashboardSessionCache.clear();
  dashboardSectionSessionCache.clear();
  clearDashboardLearnerPageCache();
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

const compactDecimalFormat = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  useGrouping: false,
});

function formatCompactDecimal(value: number): string {
  return compactDecimalFormat.format(value);
}

function normalizeMonthlyRisk(points?: MonthlyRiskPoint[] | null): MonthlyRiskPoint[] | null {
  if (!Array.isArray(points)) return null;
  return points.slice(-6).map(point => ({
    month: displayValue(point.month),
    label: displayValue(point.label),
    count: Math.max(0, Math.round(toNumber(point.count))),
    available: point.available !== false,
  }));
}

function clampPercent(value?: number | string | null, preservePrecision = false): number {
  const percent = toNumber(value);
  return Math.max(0, Math.min(100, preservePrecision ? percent : Math.round(percent)));
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

function canonicalOtjhStatus(learner: CoachLearner): OtjhStatusKey {
  const status = otjhProgressAsOfToday(learner).status;
  return status === 'unavailable' ? 'unknown' : status;
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
  submittedAt?: string | null;
  oldestPendingDate?: string | null;
  latestPendingDate?: string | null;
  isOverdue: boolean;
}

interface MarkingQueueResponse {
  items?: Partial<EvidenceQueueLearner>[];
  summary?: {
    pendingItems?: number;
  };
}

function isActiveLearner(learner: CoachLearner): boolean {
  // This is the single dashboard risk population: active and delivery
  // learners are both currently in service. Total Learners intentionally
  // remains the full caseload.
  const status = normalizedProgramStatus(learner);
  return status === 'active' || status === 'delivery';
}

function normalizedProgramStatus(learner: CoachLearner): string {
  return displayValue(learner.rawProgramStatus).toLowerCase().replace(/[\s_-]+/g, '');
}

function isRiskInsightsLearner(learner: CoachLearner): boolean {
  if (!isActiveLearner(learner)) return false;
  const programmeStages = [learner.rawProgramStatus, learner.enrollmentStatus]
    .map(value => displayValue(value).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return !programmeStages.some(status => (
    status.startsWith('onboarding')
    || status.startsWith('withdrawn')
    || status.startsWith('enteredepa')
  ));
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
  const apiProgrammeName = displayValue(learner.programmeName);
  const programmeName = apiProgrammeName === EMPTY_VALUE ? displayValue(learner.programme) : apiProgrammeName;
  const programme = programmeName === EMPTY_VALUE ? displayValue(learner.cohortName) : programmeName;
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
    otjhPlanned: learner.otjhPlanned ?? null,
    startDate: learner.startDate ?? null,
    plannedEndDate: learner.plannedEndDate ?? null,
    programme,
    programmeName: programmeName === EMPTY_VALUE ? null : programmeName,
    cohortName: cohortName === EMPTY_VALUE ? null : cohortName,
    group: displayValue(learner.group),
    employer: displayValue(learner.employer),
    avatar: displayValue(learner.avatar),
    status: statusFromApi(learner.status),
    riskFlags,
    overallProgress: clampPercent(learner.overallProgress),
    overallProgressAvailable: learner.overallProgressAvailable,
    // The backend already joined this by stable learner id -- read it
    // as-is rather than re-deriving it from a separate dataset.
    attendanceRate: (learner.attendanceAvailable ?? learner.attendanceRateAvailable) ? clampPercent(learner.attendanceRate) : 0,
    attendanceRateAvailable: Boolean(learner.attendanceAvailable ?? learner.attendanceRateAvailable),
    attendanceAvailable: Boolean(learner.attendanceAvailable ?? learner.attendanceRateAvailable),
    activityProgress: learner.activityProgress == null ? null : clampPercent(learner.activityProgress, true),
    activityProgressAvailable: Boolean(learner.activityProgressAvailable),
    componentsCompleted: learner.componentsCompleted ?? null,
    componentsPlanned: learner.componentsPlanned ?? null,
    attendancePresent: learner.attendancePresent ?? null,
    attendanceSessions: learner.attendanceSessions ?? null,
    attendanceAbsent: learner.attendanceAbsent ?? null,
    attendanceConsecutiveMissed: learner.attendanceConsecutiveMissed ?? null,
    attendanceLastSession: learner.attendanceLastSession ?? null,
    attendanceLastSessionDate: learner.attendanceLastSessionDate ?? null,
    otjhCompleted: toNumber(learner.otjhCompleted),
    otjhTarget: Math.max(toNumber(learner.otjhTarget), 0),
    otjhTargetAsOfToday: learner.otjhTargetAsOfToday ?? null,
    otjhProgressAsOfToday: learner.otjhProgressAsOfToday ?? null,
    otjhShortfallHours: learner.otjhShortfallHours ?? null,
    otjhDeltaHours: learner.otjhDeltaHours ?? null,
    otjhRagStatus: learner.otjhRagStatus ?? null,
    otjhRagSource: learner.otjhRagSource ?? null,
    otjhVariance: learner.otjhVariance ?? null,
    otjhStatus: displayValue(learner.otjhStatus),
    ksbCompleted: learner.ksbCompleted ?? null,
    ksbTarget: learner.ksbTarget ?? null,
    ksbProgress: learner.ksbProgress == null ? null : clampPercent(learner.ksbProgress, true),
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
    lastActivity: displayValue(learner.lastActivity),
    lastActivityDate: learner.lastActivityDate || null,
    lastActivityLabel: displayValue(learner.lastActivityLabel),
    lastMcm: learner.lastMcm || undefined,
    lastPr: learner.lastPr || undefined,
    recentFlag,
    email: learner.email || null,
    rawProgramStatus: learner.rawProgramStatus || null,
    enrollmentStatus: learner.enrollmentStatus || null,
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


function eventBelongsToLearner(event: CoachCalendarEvent, learner: CoachLearner) {
  const learnerId = normalizeIdentity(learner.id);
  return Boolean(learnerId && normalizeIdentity(event.learnerId) === learnerId);
}

function latestCompletedSessionDate(
  learner: CoachLearner,
  events: CoachCalendarEvent[],
  matchesType: (event: CoachCalendarEvent) => boolean = () => true,
) {
  const latest = events
    .filter(event => isCompletedEvent(event) && matchesType(event) && eventBelongsToLearner(event, learner))
    .map(event => eventDisplayDate(event))
    .map(value => ({ value, date: parseLocalDate(value) }))
    .filter((entry): entry is { value: string; date: Date } => Boolean(entry.date))
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  return latest?.value;
}

function formatCompletedSessionDate(value?: string | null) {
  const date = parseLocalDate(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
    : displayValue(value);
}

function mergeAttendanceRates(
  learners: CoachLearner[],
  events: CoachCalendarEvent[],
): CoachLearner[] {
  return learners.map((learner): CoachLearner => {
    // Attendance is already joined onto this learner server-side by stable
    // id (see coach_dashboard/apply_attendance_summary) -- no client-side
    // matching by name/email against a separate dataset.
    const hasAttendance = Boolean(learner.attendanceRateAvailable);
    const attendanceDate = hasAttendance ? parseLocalDate(learner.attendanceLastSessionDate) : undefined;
    const completedEventDate = latestCompletedSessionDate(learner, events);
    const parsedCompletedEventDate = parseLocalDate(completedEventDate);
    const learningActivityDate = parseLocalDate(learner.lastActivityDate);
    const latestAttendanceDate = parsedCompletedEventDate
      && (!attendanceDate || parsedCompletedEventDate.getTime() > attendanceDate.getTime())
      ? parsedCompletedEventDate
      : attendanceDate;
    const attendanceIsLatestActivity = Boolean(
      latestAttendanceDate
      && (!learningActivityDate || latestAttendanceDate.getTime() > learningActivityDate.getTime()),
    );
    const lastSession = parsedCompletedEventDate
      && (!attendanceDate || parsedCompletedEventDate.getTime() > attendanceDate.getTime())
      ? formatDateLabel(completedEventDate)
      : displayValue(learner.attendanceLastSession) !== EMPTY_VALUE
        ? displayValue(learner.attendanceLastSession)
        : formatDateLabel(learner.attendanceLastSessionDate);

    return {
      ...learner,
      // Use the latest completed occurrence across coaching, progress reviews
      // and live sessions. Future, in-progress and cancelled events are not
      // contacts, and the caseload payload's owner name is intentionally ignored.
      lastContact: lastSession,
      lastActivity: attendanceIsLatestActivity ? lastSession : learner.lastActivity,
      lastActivityDate: attendanceIsLatestActivity
        ? (parsedCompletedEventDate && latestAttendanceDate === parsedCompletedEventDate ? completedEventDate : learner.attendanceLastSessionDate || null)
        : learner.lastActivityDate,
      lastActivityLabel: attendanceIsLatestActivity ? 'Attendance' : learner.lastActivityLabel,
      // The calendar payload is intentionally windowed for performance. The
      // backend learner fields come from the unbounded shared resolved Review
      // history and therefore remain authoritative for these two columns.
      lastMcm: formatCompletedSessionDate(learner.lastMcm),
      lastPr: formatCompletedSessionDate(learner.lastPr),
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

  queue.forEach((item) => {
    const learnerId = normalizeIdentity(item.learnerId || item.id);
    if (learnerId) byId.set(learnerId, item);
  });

  return learners.map((learner) => {
    const match = byId.get(normalizeIdentity(learner.id));
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
    pendingEvidence: item.pendingEvidence == null ? 1 : toNumber(item.pendingEvidence),
    acceptedEvidence: toNumber(item.acceptedEvidence),
    referredEvidence: toNumber(item.referredEvidence),
    totalEvidence: toNumber(item.totalEvidence),
    lastSubmission: displayValue(item.lastSubmission),
    lastSubmissionIso: item.lastSubmissionIso || null,
    oldestPendingDate: item.submittedAt || item.lastSubmissionIso || null,
    latestPendingDate: item.submittedAt || item.lastSubmissionIso || null,
    isOverdue: Boolean(item.isOverdue),
  };
}

function eventMatchesLearner(event: CoachCalendarEvent, learner: CoachLearner) {
  const eventLearnerId = displayValue(event.learnerId);
  const learnerId = displayValue(learner.id);
  return eventLearnerId !== EMPTY_VALUE && learnerId !== EMPTY_VALUE && eventLearnerId === learnerId;
}

function groupPendingMarkingByLearner(items: EvidenceQueueLearner[]): EvidenceQueueLearner[] {
  const grouped = new Map<string, EvidenceQueueLearner>();
  for (const item of items) {
    const key = normalizeIdentity(item.learnerId);
    if (!key) continue;
    const existing = grouped.get(key);
    if (!existing) { grouped.set(key, { ...item }); continue; }
    existing.pendingEvidence += item.pendingEvidence;
    const dates = [existing.oldestPendingDate, item.oldestPendingDate].filter(Boolean).sort();
    existing.oldestPendingDate = dates[0] || null;
    existing.latestPendingDate = dates[dates.length - 1] || null;
  }
  return Array.from(grouped.values());
}

function learnerIdentityIndex(learners: CoachLearner[]) {
  const learnerIds = new Set<string>();

  learners.forEach((learner) => {
    const learnerId = displayValue(learner.id);
    if (learnerId !== EMPTY_VALUE) learnerIds.add(learnerId);
  });

  return { learnerIds };
}

function eventMatchesLearnerIndex(
  event: CoachCalendarEvent,
  index: ReturnType<typeof learnerIdentityIndex>,
) {
  const eventLearnerId = displayValue(event.learnerId);
  if (eventLearnerId !== EMPTY_VALUE && index.learnerIds.has(eventLearnerId)) return true;

  return false;
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
      reviewCategory(event) === source &&
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

function isWithinNextWorkWeek(event: CoachCalendarEvent) {
  const date = parseLocalDate(eventDisplayDate(event));
  if (!date || isCompletedEvent(event)) return false;
  const { start, end } = getNextWorkWeekRange();
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function formatTimeLabel(event: CoachCalendarEvent) {
  const label = calendarTimeLabel(event);
  return label === 'Time TBC' ? '-' : label;
}

function upcomingLiveSessionTimeLabel(event: CoachCalendarEvent) {
  if (event.timeLabel && event.timeLabel !== 'Time TBC') {
    return event.timeLabel;
  }
  if (event.scheduledTime) {
    return event.scheduledTime.slice(0, 5);
  }
  return '-';
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

function formatCalendarMonthShort(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date).toUpperCase().replace('SEPT', 'SEP');
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

function eventTypeLabel(event: CoachCalendarEvent) {
  if (reviewCategory(event) === 'progress-review') return eventPeriodLabel(event);
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
  const progress = otjhProgressAsOfToday(learner);
  return progress.percent === null ? null : clampPercent(progress.percent);
}

function otjhVarianceLabel(learner: CoachLearner): string {
  const progress = otjhProgressAsOfToday(learner);
  if (progress.deltaHours === null) return EMPTY_VALUE;
  if (learner.otjhVariance !== undefined && learner.otjhVariance !== null) {
    const variance = Math.round(learner.otjhVariance * 10) / 10;
    return `${variance > 0 ? '+' : ''}${variance}h`;
  }
  const variance = Math.round(progress.deltaHours * 10) / 10;
  return `${variance > 0 ? '+' : ''}${variance}h`;
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
    const review = matches.find(event => reviewCategory(event) === 'progress-review');
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
  const otjhStatus = canonicalOtjhStatus(learner);
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
  const otjhStatus = canonicalOtjhStatus(learner);
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
  return '-';
}

/** Just the start, for the fixed-size "Next" badge -- a live session's
 * "09:00 - 11:00" wraps and overflows a box sized for a single time. */

function formatWeekRangeLabel() {
  const { start, end } = getCurrentWorkWeekRange();
  return formatDateRangeLabel(start, end);
}

function formatDateRangeLabel(start: Date, end: Date) {
  const format = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
  const compact = (value: Date) => format.format(value).replace('Sept', 'Sep');
  return `${compact(start)} – ${compact(end)}`;
}

function formatUpcomingRangeLabel() {
  const { start, end } = getNextWorkWeekRange();
  return formatDateRangeLabel(start, end);
}

function LoadingBlock({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-background-100/90 ${className}`} style={style}></div>;
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

// The loading skeletons reuse the loaded dashboard's own layout classes, so
// every card, table and chart keeps its real size and responsive breakpoints
// and nothing shifts when the data arrives.
function MetricCardSkeleton() {
  return <div className={styles.metric} data-skeleton="metric">
    <LoadingBlock className={styles.metricSkeletonIcon} />
    <LoadingBlock className={styles.metricSkeletonLabel} />
    <LoadingBlock className={styles.metricSkeletonValue} />
    <LoadingBlock className={styles.metricSkeletonNote} />
  </div>;
}

function LearnerTableSkeleton() {
  return <div className={styles.fullWidthCaseload}>
    <section className={`${caseloadStyles.page} ${caseloadStyles.embedded}`}>
      <header className={`${caseloadStyles.pageHeader} flex flex-wrap items-center justify-between gap-4`}>
        <div className={caseloadStyles.titleGroup}>
          <LoadingBlock className="h-[46px] w-[46px] rounded-xl" />
          <div className={caseloadStyles.title}><h1>All Learners</h1><LoadingBlock className="mt-1 h-3 w-52" /></div>
        </div>
        <LoadingBlock className="h-9 w-[104px] rounded-md" />
      </header>
      <section className={caseloadStyles.panel}>
        <CaseloadLoading rows={7} />
      </section>
    </section>
  </div>;
}

type RiskInsightTone = 'warning' | 'critical';

function riskTone(value: number, warningAt: number, criticalAt: number): RiskInsightTone | null {
  if (value >= criticalAt) return 'critical';
  if (value >= warningAt) return 'warning';
  return null;
}

function daysSince(value?: string | null, today = new Date()): number | null {
  const date = parseDisplayDate(value);
  if (!date) return null;
  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.floor((todayDay - dateDay) / 86_400_000));
}

function strongerTone(left: RiskInsightTone | null, right: RiskInsightTone | null): RiskInsightTone | null {
  if (left === 'critical' || right === 'critical') return 'critical';
  if (left === 'warning' || right === 'warning') return 'warning';
  return null;
}

function RiskStatus({ tone }: { tone: RiskInsightTone }) {
  return <span className={styles.riskStatus} data-tone={tone}>{tone === 'critical' ? 'Critical' : 'Warning'}</span>;
}

function RiskLearner({ learner }: { learner: CoachLearner }) {
  return <div className={styles.identity}>
    <LearnerAvatar name={learner.name} initials={learner.initials} tone={learnerAvatarTone(learner)} />
    <Link
      className={styles.riskLearnerLink}
      to={`/coach/learner-case-file?id=${encodeURIComponent(learner.id)}`}
      state={{
        learnerId: learner.id,
        learnerName: learner.name,
        ...(learner.learnerType ? { kind: learner.learnerType } : {}),
        ...(learner.enrolmentId ? { enrolmentId: learner.enrolmentId } : {}),
      }}
    >{learner.name}</Link>
  </div>;
}

function ReviewAge({ value, days, tone, label }: {
  value?: string | null;
  days: number | null;
  tone: RiskInsightTone | null;
  label: 'PR' | 'MCM';
}) {
  return <div className={styles.reviewAge} data-tone={tone || undefined}>
    <strong>{formatCompletedSessionDate(value)}</strong>
    <small>{days === null ? `No ${label} yet` : `${days} days ago`}</small>
  </div>;
}

function EmptyRiskRow({ columns, message }: { columns: number; message: string }) {
  return <tr><td className={styles.emptyRiskRow} colSpan={columns}>{message}</td></tr>;
}

function RiskInsightPanel({ id, title, icon, description, children }: {
  id: string;
  title: string;
  icon: string;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return <Panel className={styles.panel}>
    <SectionHeader
      title={title}
      icon={icon}
      description={description}
      actions={<button
        type="button"
        className={styles.riskInsightToggle}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
        onClick={() => setOpen(current => !current)}
      >
        <AppIcon className="ri-arrow-down-s-line" aria-hidden="true" />
      </button>}
    />
    <div id={id} hidden={!open}>{children}</div>
  </Panel>;
}

function RiskInsightsTables({ learners, unavailable }: { learners: CoachLearner[]; unavailable: boolean }) {
  const attendanceRows = learners
    .map(learner => ({ learner, missed: learner.attendanceConsecutiveMissed ?? 0 }))
    .map(row => ({ ...row, tone: riskTone(row.missed, 2, 3) }))
    .filter((row): row is typeof row & { tone: RiskInsightTone } => Boolean(row.tone))
    .sort((left, right) => right.missed - left.missed);

  const otjhRows = learners
    .map(learner => ({ learner, target: otjhProgressAsOfToday(learner).targetHours }))
    .filter((row): row is typeof row & { target: number } => row.target !== null && row.target > 0)
    .map(row => ({ ...row, gap: Math.max(row.target - row.learner.otjhCompleted, 0) }))
    .map(row => ({ ...row, tone: riskTone(row.gap, 30, 40) }))
    .filter((row): row is typeof row & { tone: RiskInsightTone } => Boolean(row.tone))
    .sort((left, right) => right.gap - left.gap);

  const reviewRows = learners
    .map(learner => {
      const prDays = daysSince(learner.lastPr);
      const mcmDays = daysSince(learner.lastMcm);
      const prTone = prDays === null ? null : riskTone(prDays, 70, 84);
      const mcmTone = mcmDays === null ? null : riskTone(mcmDays, 21, 28);
      return { learner, prDays, mcmDays, prTone, mcmTone, tone: strongerTone(prTone, mcmTone) };
    })
    .filter((row): row is typeof row & { tone: RiskInsightTone } => Boolean(row.tone))
    .sort((left, right) => (right.tone === 'critical' ? 1 : 0) - (left.tone === 'critical' ? 1 : 0));

  const dataUnavailable = unavailable ? 'Risk insight data is not available.' : null;

  return <section className={styles.riskInsights} aria-label="Learner risk insights">
    <RiskInsightPanel id="attendance-risk-insights" title="Attendance Insights" icon="ri-calendar-check-line" description="Two consecutive absences are a warning; three or more are critical.">
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Attendance risk insights">
        <table className={`${styles.table} ${styles.riskInsightTable}`}>
          <thead><tr><th scope="col">Learner</th><th scope="col">Programme</th><th scope="col">Consecutive absences</th><th scope="col">Status</th></tr></thead>
          <tbody>{attendanceRows.length ? attendanceRows.map(({ learner, missed, tone }) => <tr key={learner.id} data-tone={tone}>
            <td><RiskLearner learner={learner} /></td><td>{learner.programme}</td><td><strong>{missed}</strong></td><td><RiskStatus tone={tone} /></td>
          </tr>) : <EmptyRiskRow columns={4} message={dataUnavailable || 'No attendance warnings.'} />}</tbody>
        </table>
      </div>
    </RiskInsightPanel>

    <RiskInsightPanel id="otjh-risk-insights" title="OTJH Insights" icon="ri-time-line" description="30 hours behind target is a warning; 40 hours or more is critical.">
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="OTJH risk insights">
        <table className={`${styles.table} ${styles.riskInsightTable}`}>
          <thead><tr><th scope="col">Learner</th><th scope="col">Programme</th><th scope="col">Actual</th><th scope="col">Target</th><th scope="col">Behind</th><th scope="col">Status</th></tr></thead>
          <tbody>{otjhRows.length ? otjhRows.map(({ learner, target, gap, tone }) => <tr key={learner.id} data-tone={tone}>
            <td><RiskLearner learner={learner} /></td><td>{learner.programme}</td><td>{formatCompactDecimal(learner.otjhCompleted)}h</td><td>{target}h</td><td><strong>{Math.round(gap * 10) / 10}h</strong></td><td><RiskStatus tone={tone} /></td>
          </tr>) : <EmptyRiskRow columns={6} message={dataUnavailable || 'No OTJH warnings.'} />}</tbody>
        </table>
      </div>
    </RiskInsightPanel>

    <RiskInsightPanel id="review-risk-insights" title="Review Insights" icon="ri-file-list-3-line" description="PR: warning after 10 weeks, critical after 12. MCM: warning after 3 weeks, critical after 4.">
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Review risk insights">
        <table className={`${styles.table} ${styles.riskInsightTable}`}>
          <thead><tr><th scope="col">Learner</th><th scope="col">Programme</th><th scope="col">Last PR</th><th scope="col">Last MCM</th><th scope="col">Status</th></tr></thead>
          <tbody>{reviewRows.length ? reviewRows.map(({ learner, prDays, mcmDays, prTone, mcmTone, tone }) => <tr key={learner.id} data-tone={tone}>
            <td><RiskLearner learner={learner} /></td><td>{learner.programme}</td>
            <td><ReviewAge value={learner.lastPr} days={prDays} tone={prTone} label="PR" /></td>
            <td><ReviewAge value={learner.lastMcm} days={mcmDays} tone={mcmTone} label="MCM" /></td>
            <td><RiskStatus tone={tone} /></td>
          </tr>) : <EmptyRiskRow columns={5} message={dataUnavailable || 'No review warnings.'} />}</tbody>
        </table>
      </div>
    </RiskInsightPanel>
  </section>;
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
  const businessDate = useDashboardBusinessDate();
  const cacheKey = dashboardCacheKey(adminEmail, authenticatedCoachEmail, businessDate);
  const initialDashboard = dashboardSessionCache.get(cacheKey);
  // KPI cards open a quick drill-down first. The modal can still apply the
  // same filter to the caseload list when the coach wants to keep working there.
  const [summaryReload, setSummaryReload] = useState(0);
  const [sectionReload, setSectionReload] = useState(0);
  const [weeklyCounts, setWeeklyCounts] = useState<WeeklyCounts | undefined>(() => initialDashboard?.weeklyCounts);
  const [totals, setTotals] = useState<DashboardTotals | undefined>(() => initialDashboard?.totals);
  const [popupWeekEvents, setPopupWeekEvents] = useState<CoachCalendarEvent[] | undefined>(() => initialDashboard?.popupWeekEvents);
  const [popupLearners, setPopupLearners] = useState<DashboardPopupLearner[]>(() => initialDashboard?.popupLearners || []);
  const [meetingsLoadedKey, setMeetingsLoadedKey] = useState<string | null>(null);
  const [riskLoadedKey, setRiskLoadedKey] = useState<string | null>(null);
  const [riskLearners, setRiskLearners] = useState<CoachLearner[]>([]);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [kpiFilter, setKpiFilter] = useState<DashboardKpi | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpi | null>(null);
  const [ownerName, setOwnerName] = useState(() => initialDashboard?.ownerName || 'Coach');
  const [learners, setLearners] = useState<CoachLearner[]>(() => initialDashboard?.learners || []);
  const [monthlyRisk, setMonthlyRisk] = useState<MonthlyRiskPoint[] | null>(() => initialDashboard?.monthlyRisk || null);
  const [calendarEvents, setCalendarEvents] = useState<CoachCalendarEvent[]>(() => initialDashboard?.calendarEvents || []);
  const [calendarPreviewEvents, setCalendarPreviewEvents] = useState<CoachCalendarEvent[]>(() => initialDashboard?.calendarPreviewEvents || []);
  const [liveSessionEvents, setLiveSessionEvents] = useState<CoachCalendarEvent[]>(() => initialDashboard?.liveSessionEvents || []);
  const [evidenceQueue, setEvidenceQueue] = useState<EvidenceQueueLearner[]>(() => initialDashboard?.evidenceQueue || []);
  const [markingThisWeek, setMarkingThisWeek] = useState<number | undefined>(() => initialDashboard?.markingThisWeek);
  const [reviewGenerationAvailable, setReviewGenerationAvailable] = useState(() => initialDashboard?.reviewGenerationAvailable ?? true);
  const [loading, setLoading] = useState(() => !initialDashboard);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [loadedCoachEmail, setLoadedCoachEmail] = useState<string | null>(() => initialDashboard ? authenticatedCoachEmail : null);
  const [calendarLoading, setCalendarLoading] = useState(() => !initialDashboard);
  const [calendarError, setCalendarError] = useState<string | null>(() => initialDashboard?.calendarError || null);
  const [liveSessionsLoading, setLiveSessionsLoading] = useState(() => !initialDashboard);
  const [scheduleExpanded, setScheduleExpanded] = useState(true);
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [activeDashboardTab, setActiveDashboardTab] = useState<CoachDashboardTab>('learners');
  const [directoryCoaches, setDirectoryCoaches] = useState<DirectoryCoach[]>([]);
  const activeDashboardTabIndex = COACH_DASHBOARD_TABS.findIndex(tab => tab.id === activeDashboardTab);
  const handleDashboardTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? COACH_DASHBOARD_TABS.length - 1
      : (activeDashboardTabIndex + (event.key === 'ArrowRight' ? 1 : COACH_DASHBOARD_TABS.length - 1)) % COACH_DASHBOARD_TABS.length;
    const nextTab = COACH_DASHBOARD_TABS[nextIndex];
    setActiveDashboardTab(nextTab.id);
    document.getElementById(`coach-dashboard-tab-${nextTab.id}`)?.focus();
  };
  const updateDashboardMeeting = (updated: CoachCalendarEvent) => {
    const replace = (events: CoachCalendarEvent[]) => events.map(event => (event.eventKey || event.id) === (updated.eventKey || updated.id) ? updated : event);
    setCalendarEvents(replace);
    setCalendarPreviewEvents(events => replace(events).filter(isWithinNextWorkWeek));
  };
  const handleDirectoryLoaded = useCallback((nextCoaches: DirectoryCoach[]) => {
    setDirectoryCoaches(nextCoaches);
  }, []);

  /**
   * Open a coach's workspace as somebody else, and say so in the audit trail.
   *
   * The selection itself lives in the browser, so nothing on the server knew it
   * had been made. Every page opened afterwards was recorded against the
   * administrator who opened it -- a caseload, a marking queue, a set of
   * meeting notes -- with nothing anywhere saying whose they were. This is the
   * one row that answers that, and it carries the coach's name and address
   * only: no caseload, no learner, nothing that was on the screen.
   */
  const openCoachWorkspace = useCallback((selected: DirectoryCoach) => {
    setCoachViewAs({ email: selected.email, name: selected.name }, adminEmail);
    // Guarded the same way `setCoachViewAs` guards itself, so the trail never
    // claims a workspace was opened when nothing was.
    if (!selected.email || !adminEmail) return;
    recordAction(
      'record_view',
      { scope: 'coach-workspace' },
      { type: 'coach', id: selected.email, label: selected.name || selected.email },
    );
  }, [adminEmail]);

  const openCoachCalendar = useCallback((selected: DirectoryCoach, event: CoachCalendarEvent) => {
    openCoachWorkspace(selected);
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
  }, [openCoachWorkspace, navigate]);

  useEffect(() => {
    if (!isInitialized) return;
    const controller = new AbortController();
    const cached = dashboardSessionCache.get(cacheKey);
    setLoadWarning(null);
    setLoading(!cached);
    setLoadedCoachEmail(cached ? authenticatedCoachEmail : null);
    setOwnerName(cached?.ownerName || authenticatedCoachName);
    setLearners(cached?.learners || []);
    setMonthlyRisk(cached?.monthlyRisk || null);
    setWeeklyCounts(cached?.weeklyCounts);
    setTotals(cached?.totals);
    setPopupWeekEvents(cached?.popupWeekEvents);
    setPopupLearners(cached?.popupLearners || []);
    setEvidenceQueue(cached?.evidenceQueue || []);
    setMarkingThisWeek(cached?.markingThisWeek);
    setReviewGenerationAvailable(cached?.reviewGenerationAvailable ?? true);
    setCalendarEvents(cached?.calendarEvents || []);
    setCalendarPreviewEvents(cached?.calendarPreviewEvents || []);
    setLiveSessionEvents(cached?.liveSessionEvents || []);
    setCalendarError(null);
    setMeetingsLoadedKey(null);
    setRiskLoadedKey(null);
    setRiskLearners([]);
    setRiskError(null);

    if (!authenticatedCoachEmail) {
      setLoadWarning(coach.canChooseCoach ? null : 'Coach access is required to load this dashboard.');
      setLoading(false);
      setLoadedCoachEmail(authenticatedCoachEmail);
      return () => controller.abort();
    }

    async function loadSummary() {
      try {
        const dashboard = await fetchCoachDashboard<CoachDashboardApiResponse>(controller.signal);
        if (controller.signal.aborted) return;
        const seenSubmissionIds = new Set<string>();
        const queueItems = groupPendingMarkingByLearner((dashboard.marking?.items || [])
          .filter(item => {
            const id = String(item.id || '');
            if (!id || seenSubmissionIds.has(id)) return false;
            seenSubmissionIds.add(id);
            return true;
          }).map(normalizeEvidenceQueueLearner));
        const nextLearners = mergeEvidenceQueueIntoLearners((dashboard.learners || []).map(normalizeLearner), queueItems);
        const nextOwnerName = optionalDisplayValue(dashboard.owner?.name) || authenticatedCoachName;
        const nextMarking = dashboard.marking?.summary?.pendingItems === undefined
          ? undefined : toNumber(dashboard.marking.summary.pendingItems);
        const previous = dashboardSessionCache.get(cacheKey);
        const available = dashboard.weeklyCounts?.reviewsAvailable ?? reviewScheduleAvailable(
          dashboard.meetings?.summary, dashboard.meetings?.events || [], dashboard.meetings?.reviewGenerationIssues || [],
        );
        dashboardSessionCache.set(cacheKey, {
          ownerName: nextOwnerName, learners: nextLearners, monthlyRisk: null,
          popupLearners: dashboard.popupLearners,
          weeklyCounts: dashboard.weeklyCounts, totals: dashboard.totals, popupWeekEvents: dashboard.popupWeekEvents,
          calendarEvents: previous?.calendarEvents || [], calendarPreviewEvents: previous?.calendarPreviewEvents || [],
          liveSessionEvents: previous?.liveSessionEvents || [], evidenceQueue: queueItems,
          markingThisWeek: nextMarking, reviewGenerationAvailable: available, calendarError: previous?.calendarError || null,
        });
        setOwnerName(nextOwnerName);
        setLearners(nextLearners);
        setWeeklyCounts(dashboard.weeklyCounts);
        setTotals(dashboard.totals);
        setPopupWeekEvents(dashboard.popupWeekEvents);
        setPopupLearners(dashboard.popupLearners || []);
        setEvidenceQueue(queueItems);
        setMarkingThisWeek(nextMarking);
        setReviewGenerationAvailable(available);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadWarning(error instanceof Error ? error.message : 'Unable to load coach dashboard summary.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadedCoachEmail(authenticatedCoachEmail);
        }
      }
    }
    void loadSummary();
    return () => controller.abort();
  }, [authenticatedCoachEmail, authenticatedCoachName, cacheKey, coach.canChooseCoach, isInitialized, summaryReload]);

  const meetingKpiSelected = selectedKpi === 'pr-week' || selectedKpi === 'mcm-week' || selectedKpi === 'catch-ups-week' || selectedKpi === 'reviews';
  const needsMeetings = activeDashboardTab === 'meetings' || (meetingKpiSelected && popupWeekEvents === undefined);

  useEffect(() => {
    if (!isInitialized || !authenticatedCoachEmail || !needsMeetings || meetingsLoadedKey === cacheKey) return;
    const controller = new AbortController();
    const sectionKey = `${cacheKey}:meetings`;
    const cached = dashboardSectionSessionCache.get(sectionKey);
    const applyMeetings = (dashboard: CoachDashboardApiResponse) => {
      const events = sortEvents(dashboard.meetings?.events || []);
      const nonLive = events.filter(event => event.source !== 'live-session');
      setCalendarEvents(nonLive);
      setCalendarPreviewEvents(nonLive.filter(isWithinNextWorkWeek));
      setLiveSessionEvents(events.filter(event => event.source === 'live-session'));
      setCalendarError(dashboard.errors?.meetings || null);
    };
    if (cached) applyMeetings(cached);
    setCalendarLoading(!cached);
    setLiveSessionsLoading(!cached);
    setCalendarError(null);
    void fetchDashboardSection<CoachDashboardApiResponse>('meetings', controller.signal).then(dashboard => {
      if (controller.signal.aborted) return;
      dashboardSectionSessionCache.set(sectionKey, dashboard);
      applyMeetings(dashboard);
      setMeetingsLoadedKey(cacheKey);
    }).catch(error => {
      if (!controller.signal.aborted) setCalendarError(error instanceof Error ? error.message : 'Unable to load meetings.');
    }).finally(() => {
      if (!controller.signal.aborted) {
        setCalendarLoading(false);
        setLiveSessionsLoading(false);
      }
    });
    return () => controller.abort();
  }, [authenticatedCoachEmail, cacheKey, isInitialized, meetingsLoadedKey, needsMeetings, sectionReload]);

  useEffect(() => {
    if (!isInitialized || !authenticatedCoachEmail || activeDashboardTab !== 'risk' || riskLoadedKey === cacheKey) return;
    const controller = new AbortController();
    const sectionKey = `${cacheKey}:risk`;
    const cached = dashboardSectionSessionCache.get(sectionKey);
    if (cached) setRiskLearners((cached.learners || []).map(normalizeLearner));
    setRiskLoading(!cached);
    setRiskError(null);
    void fetchDashboardSection<CoachDashboardApiResponse>('risk', controller.signal).then(dashboard => {
      if (controller.signal.aborted) return;
      dashboardSectionSessionCache.set(sectionKey, dashboard);
      setRiskLearners((dashboard.learners || []).map(normalizeLearner));
      setRiskLoadedKey(cacheKey);
    }).catch(error => {
      if (!controller.signal.aborted) setRiskError(error instanceof Error ? error.message : 'Unable to load risk insights.');
    }).finally(() => {
      if (!controller.signal.aborted) setRiskLoading(false);
    });
    return () => controller.abort();
  }, [activeDashboardTab, authenticatedCoachEmail, cacheKey, isInitialized, riskLoadedKey, sectionReload]);

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
  const visibleLearners = useMemo(
    () => enrichedLearners.filter(isVisibleCaseloadLearner),
    [enrichedLearners],
  );
  const activeLearners = useMemo(() => visibleLearners.filter(isActiveLearner), [visibleLearners]);
  const riskInsightsLearners = useMemo(
    () => riskLearners.filter(isVisibleCaseloadLearner).filter(isRiskInsightsLearner),
    [riskLearners],
  );
  const atRiskLearners = useMemo(
    () => selectAtRiskPopupLearners(popupLearners),
    [popupLearners],
  );
  const needAttentionLearners = useMemo(
    () => activeLearners.filter(learner => canonicalOtjhStatus(learner) === 'need-attention'),
    [activeLearners],
  );
  const evidenceLearners = useMemo(
    () => evidenceQueue
      .filter(learner => learner.pendingEvidence > 0)
      .sort((a, b) => b.pendingEvidence - a.pendingEvidence || a.learner.localeCompare(b.learner)),
    [evidenceQueue],
  );
  const atRiskCount = totals ? atRiskLearners.length : undefined;
  const totalCaseload = totals?.totalLearners;
  const pendingEvidence = useMemo(
    () => evidenceLearners.reduce((total, learner) => total + learner.pendingEvidence, 0),
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
    () => upcomingLiveSessions.filter(isWithinNextWorkWeek),
    [upcomingLiveSessions],
  );

  /* ── Upcoming Schedule: live sessions + coaching + reviews, one list ── */
  const upcomingScheduleEvents = useMemo(
    () => sortEvents([
      ...visibleCalendarSourceEvents.filter(event => UPCOMING_MEETING_SOURCES.has(event.source)),
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
  const progressReviewsThisWeek = popupWeekEvents === undefined && meetingsLoadedKey === cacheKey ? weekEvents.filter(event => reviewCategory(event) === 'progress-review').length : totals?.prThisWeek ?? undefined;
  const monthlyCoachingThisWeek = popupWeekEvents === undefined && meetingsLoadedKey === cacheKey ? weekEvents.filter(event => event.source === 'mcr').length : totals?.mcmThisWeek ?? undefined;
  const catchUpsThisWeek = popupWeekEvents === undefined && meetingsLoadedKey === cacheKey ? weekEvents.filter(event => event.source === 'catch-up').length : totals?.catchUpsThisWeek;

  /* ── Learners Requiring Attention (Risk Alert + At Risk Learners, merged) ── */
  const schedulePanelLoading = (calendarLoading || liveSessionsLoading) && !upcomingScheduleEvents.length;
  const dashboardLoading = loading || loadedCoachEmail !== authenticatedCoachEmail;

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

  // An administrator reaches this page with no caseload of their own. The
  // cross-coach dashboard also remains the entry point into an individual
  // workspace; that selection travels with every coach request (see
  // `@/lib/coachViewAs`), so the remaining coach pages follow the same coach.
  if (coach.canChooseCoach && !coach.isViewingAsCoach) {
    return (
      <WorkspaceShell
        // Almost no sidebar until a coach is chosen: every other coach page
        // reads the selected coach, so those links would open a caseload, a
        // timetable and a marking queue belonging to nobody. The rest of the
        // nav returns with the choice.
        //
        // The Audit Trail is the exception, and it belongs here rather than
        // only inside a chosen workspace: it reads every coach at once, so it
        // has nothing to be scoped to, and this picker is where somebody asking
        // "who opened whose workspace" actually starts. `rbac.ts` still decides
        // who sees it, so a coach lands on an empty rail exactly as before.
        role="coach" roleLabel={coachNav.label} navItems={[coachAuditTrailNavItem]} workspaceLabel={coachNav.workspaceLabel}
        pageTitle="Performance Dashboard" pageSubtitle="Compare coach performance and open any workspace in read-only mode"
        userName={auth.account?.displayName || auth.user?.fullName || 'Administrator'} userRole="Administrator"
      >
        <div className="space-y-6 p-3 md:p-6">
          <CoachDirectoryPicker
            onSelect={openCoachWorkspace}
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
        {loadWarning && <Panel className={styles.panel}>
          <EmptyState icon="ri-error-warning-line" title="Unable to load coach dashboard summary" description={loadWarning} />
          <button type="button" className={styles.textButton} onClick={() => setSummaryReload(value => value + 1)}>Retry summary</button>
        </Panel>}
        {dashboardLoading ? <div role="status" aria-label="Loading coach dashboard">
          <span className="sr-only">Loading coach dashboard summary</span>
          <section className={styles.metrics} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <MetricCardSkeleton key={index} />)}</section>
        </div> : <>
        <section className={styles.metrics} aria-label="Coach dashboard metrics">
          <DashboardMetric kind="caseload" label="Total learners" value={loading || loadWarning ? undefined : totalCaseload} icon="ri-group-line" onClick={() => setSelectedKpi('caseload')} />
          <DashboardMetric kind="risk" label="OTJH at risk" value={loading || loadWarning ? undefined : atRiskCount} note={loading || loadWarning || totals?.needAttention === undefined ? undefined : `${totals.needAttention} need attention`} icon="ri-alarm-warning-line" tone="critical" onClick={() => setSelectedKpi('at-risk')} />
          <DashboardMetric kind="marking" label="Pending marking" value={loading || loadWarning ? undefined : totals?.pendingMarking ?? undefined} note="Pending submissions" icon="ri-file-list-3-line" onClick={() => setSelectedKpi('pending-marking')} />
          <DashboardMetric kind="pr" label="PR this week" value={loading || loadWarning ? undefined : reviewGenerationAvailable ? progressReviewsThisWeek : EMPTY_VALUE} note={reviewGenerationAvailable ? `Progress reviews · ${formatWeekRangeLabel()}` : 'Review schedule data unavailable'} icon="ri-focus-3-line" tone="caution" onClick={() => setSelectedKpi('pr-week')} />
          <DashboardMetric kind="mcm" label="MCM this week" value={loading || loadWarning ? undefined : reviewGenerationAvailable ? monthlyCoachingThisWeek : EMPTY_VALUE} note={reviewGenerationAvailable ? `Monthly coaching · ${formatWeekRangeLabel()}` : 'Review schedule data unavailable'} icon="ri-history-line" tone="caution" onClick={() => setSelectedKpi('mcm-week')} />
          <DashboardMetric kind="catchup" label="Catch-ups this week" value={loading || loadWarning ? undefined : catchUpsThisWeek} note={`Catch-up sessions · ${formatWeekRangeLabel()}`} icon="ri-calendar-event-line" tone="caution" onClick={() => setSelectedKpi('catch-ups-week')} />
        </section>
        </>}

        <section className={styles.dashboardTabs} aria-label="Coach dashboard sections">
          <div className={styles.dashboardTabList} role="tablist" aria-label="Dashboard tabs">
            {COACH_DASHBOARD_TABS.map(tab => <button key={tab.id} id={`coach-dashboard-tab-${tab.id}`} type="button" role="tab"
              className={styles.dashboardTab} aria-selected={activeDashboardTab === tab.id} aria-controls={`coach-dashboard-panel-${tab.id}`}
              tabIndex={activeDashboardTab === tab.id ? 0 : -1} onClick={() => setActiveDashboardTab(tab.id)} onKeyDown={handleDashboardTabKeyDown}>
              {tab.label}
            </button>)}
          </div>

          <div id={`coach-dashboard-panel-${activeDashboardTab}`} role="tabpanel" aria-labelledby={`coach-dashboard-tab-${activeDashboardTab}`} className={styles.dashboardTabPanel}>
          {activeDashboardTab === 'learners' && <div id="learner-caseload" className={styles.fullWidthCaseload}>
            <CoachCaseloadContent key={cacheKey} embedded dashboard />
          </div>}

          {activeDashboardTab === 'meetings' && <>
        <header className={styles.dueActivitiesHero}>
          <div className={styles.dueActivitiesHeroContent}>
            <span className={styles.dueActivitiesHeroIcon}><AppIcon name="ri-calendar-event-line" aria-hidden="true" /></span>
            <div>
              <h2>Upcoming Meetings</h2>
              <p>Your scheduled meetings and live sessions in the next work week</p>
              <span className={styles.dueActivitiesRange}><AppIcon name="ri-calendar-line" aria-hidden="true" />{formatUpcomingRangeLabel()}</span>
            </div>
          </div>
          <div className={styles.dueActivitiesArtwork} aria-hidden="true">
            <AppIcon name="ri-calendar-2-line" /><AppIcon name="ri-time-line" />
          </div>
          <div className={styles.dueActivitiesActions}>
            <Link to="/coach/timetable" className={`${styles.textButton} ${styles.dueActivitiesSecondaryAction}`}><AppIcon name="ri-calendar-line" />Calendar</Link>
            <Link to="/coach/timetable" className={`${styles.textButton} ${styles.dueActivitiesPrimaryAction}`}>View all meetings <AppIcon name="ri-arrow-right-line" /></Link>
          </div>
        </header>
        <Panel className={styles.panel}>
          <SectionHeader icon="ri-calendar-schedule-line" title="Learner Meetings"
            actions={<div className={styles.dueActivitySectionActions}>
              <span>{upcomingScheduleGroups.reduce((total, group) => total + group.events.length, 0)} meetings next week</span>
              <button type="button" className={styles.iconButton} onClick={() => setScheduleExpanded(current => !current)}
                aria-expanded={scheduleExpanded} aria-controls="coach-schedule-content" aria-label={`${scheduleExpanded ? 'Collapse' : 'Expand'} upcoming schedule`}>
                <AppIcon name={scheduleExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
              </button>
            </div>} />
          {scheduleExpanded && (
            <div id="coach-schedule-content">
              {scheduleNotice && <p className={styles.notice} role="status">{scheduleNotice}</p>}
              {schedulePanelLoading && <ScheduleSkeleton />}
              {!schedulePanelLoading && upcomingScheduleGroups.length > 0 && (
                <div className={`${styles.tableScroll} ${styles.meetingsTableScroll}`} tabIndex={0} role="region" aria-label="Upcoming meetings and live sessions">
                  <table className={`${styles.table} ${styles.meetingsTable}`}>
                    <caption className="sr-only">Meetings and live sessions in the next work week</caption>
                    <thead className="sr-only"><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Learner / session</th><th scope="col">Meeting type</th><th scope="col">Status</th><th scope="col">Reschedule</th><th scope="col">Send Reminder</th><th scope="col">Generate Presentation</th><th scope="col">View Form</th></tr></thead>
                    <tbody>{upcomingScheduleGroups.flatMap((group, groupIndex) => group.events.map((event, eventIndex) => (
                      <Fragment key={event.eventKey || event.id}>
                      {eventIndex === 0 && groupIndex > 0 && <tr className={styles.meetingDaySpacer} data-day-spacer="true" aria-hidden="true"><td colSpan={9} /></tr>}
                      {eventIndex === 0 && event.source === 'live-session' && <tr><th colSpan={9} className="text-left">Live Sessions</th></tr>}
                      <tr className={cn(styles.meetingRow, eventIndex === 0 && styles.meetingDayFirstRow, eventIndex === group.events.length - 1 && styles.meetingDayLastRow)}
                        data-meeting-row="true" data-day-first={eventIndex === 0 ? 'true' : undefined} data-day-last={eventIndex === group.events.length - 1 ? 'true' : undefined}>
                        {eventIndex === 0 && <td className={`${styles.dateCell} ${styles.meetingDateCell}`} rowSpan={group.events.length}><time className={styles.meetingDate} dateTime={group.date}><span>{formatCalendarWeekday(group.date)}</span><strong>{formatDateLabel(group.date)}</strong></time></td>}
                        <td className={styles.dateCell}><span className={styles.meetingTime}><AppIcon name="ri-time-line" aria-hidden="true" />{scheduleEventTime(event)}</span></td>
                        <td><div className={styles.identity}>
                          <LearnerAvatar name={scheduleEventTitle(event)} />
                          <span className={styles.meetingIdentityText}><span className={styles.identityName}>{scheduleEventTitle(event)}</span>{optionalDisplayValue(event.group) && <span className={styles.meetingIdentityMeta}>{event.group}</span>}</span>
                        </div></td>
                        <td><span className={styles.meetingType}><span className={styles.meetingTypeIcon}><AppIcon name="ri-book-open-line" aria-hidden="true" /></span>{scheduleEventMeta(event)}</span></td>
                        <td><StatusBadge status={event.status} label={statusLabel(event.status)} size="sm" /></td>
                        {event.source === 'live-session' ? <td colSpan={4}><Link to="/coach/timetable" state={buildTimetableFocusState(event)} className={styles.textButton} aria-label={`View ${scheduleEventTitle(event)} in calendar`}><AppIcon name="ri-calendar-line" /> View in calendar</Link></td>
                          : <DashboardMeetingActions event={event} onUpdated={updateDashboardMeeting} onScheduleNotice={setScheduleNotice} />}
                      </tr></Fragment>
                    )))}</tbody>
                  </table>
                </div>
              )}
              {calendarError && <div role="alert"><p>{calendarError}</p><button type="button" className={styles.textButton} onClick={() => { setMeetingsLoadedKey(null); setSectionReload(value => value + 1); }}>Retry meetings</button></div>}
              {!schedulePanelLoading && !calendarError && !upcomingScheduleGroups.length && (
                <EmptyState size="sm" icon="ri-calendar-check-line" title="No learner meetings scheduled" description={calendarError || 'No learner meetings scheduled in the next work week.'} />
              )}
            </div>
          )}
        </Panel>
        </>}

        {activeDashboardTab === 'risk' && <>
          {riskLoading ? <div role="status" aria-label="Loading risk insights"><ScheduleSkeleton /></div>
            : <RiskInsightsTables learners={riskInsightsLearners} unavailable={Boolean(riskError)} />}
          {riskError && <div role="alert"><p>{riskError}</p><button type="button" className={styles.textButton} onClick={() => { setRiskLoadedKey(null); setSectionReload(value => value + 1); }}>Retry risk insights</button></div>}
        </>}
          </div>
        </section>

      </div>

      {selectedKpi && (
        <KpiDetailModal
          type={selectedKpi}
          loading={meetingKpiSelected && popupWeekEvents === undefined && meetingsLoadedKey !== cacheKey && !calendarError}
          error={meetingKpiSelected && popupWeekEvents === undefined ? calendarError : null}
          onRetry={() => { setMeetingsLoadedKey(null); setSectionReload(value => value + 1); }}
          learners={visibleLearners}
          popupLearners={popupLearners}
          calendarEvents={activeCalendarEvents}
          weekEvents={popupWeekEvents ?? weekEvents}
          evidenceQueue={evidenceLearners}
          pendingEvidence={pendingEvidence}
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

function DashboardLoadingSkeleton() {
  return (
    <div aria-label="Loading coach dashboard" role="status" className="min-w-0">
      <span className="sr-only">Loading coach dashboard data</span>
      <div className={styles.loadingDashboard} aria-hidden="true">
        <section className={styles.metrics}>{Array.from({ length: 6 }, (_, index) => <MetricCardSkeleton key={index} />)}</section>
        <section className={styles.dashboardTabs}>
          <div className={styles.dashboardTabList}>
            {COACH_DASHBOARD_TABS.map(tab => (
              <span key={tab.id} className={styles.dashboardTab} aria-current={tab.id === 'learners' ? 'page' : undefined}>
                {tab.label}
              </span>
            ))}
          </div>
          <div className={styles.dashboardTabPanel}>
            <LearnerTableSkeleton />
          </div>
        </section>
      </div>
    </div>
  );
}

type MetricKind = 'caseload' | 'risk' | 'marking' | 'pr' | 'mcm' | 'catchup';

function DashboardMetric({ kind, label, value, note, icon, tone, onClick }: {
  kind: MetricKind;
  label: string;
  value?: number | string;
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
  </>;
  return onClick ? (
    <button type="button" className={styles.metric} data-kind={kind} data-tone={tone} data-unavailable={unavailable} onClick={onClick} aria-label={`Open ${label} details`}>{content}</button>
  ) : (
    <div className={styles.metric} data-kind={kind} data-unavailable={unavailable}>{content}</div>
  );
}

function MonthlyRiskChart({ points, unavailable }: { points: MonthlyRiskPoint[] | null; unavailable: boolean }) {
  if (unavailable || !points?.length || points.some(point => point.available === false)) {
    return <div className={styles.unavailableChart}>
      <AppIcon name="ri-line-chart-line" aria-hidden="true" />
      <p>History not available</p><span>Monthly risk data is not available yet.</span>
    </div>;
  }

  const highestCount = Math.max(...points.map(point => point.count), 1);
  return <div className={styles.monthlyRiskChart}>
    <ol className={styles.monthlyBars} aria-label="Learners at risk at each month end">
      {points.map(point => (
        <li key={point.month} aria-label={`${point.label}: ${point.count} learners at risk`}>
          <strong>{point.count}</strong>
          <span className={styles.monthlyBarTrack} aria-hidden="true">
            <span
              className={styles.monthlyBar}
              data-empty={point.count === 0}
              style={{ height: `${point.count ? Math.max(12, point.count / highestCount * 100) : 4}%` }}
            />
          </span>
          <small>{point.label}</small>
        </li>
      ))}
    </ol>
  </div>;
}

function OtjhDistribution({ learners, unavailable }: { learners: CoachLearner[]; unavailable: boolean }) {
  const statuses: { key: OtjhStatusKey; label: string; color: string }[] = [
    { key: 'at-risk', label: 'At Risk', color: '#e51e50' },
    { key: 'need-attention', label: 'Need Attention', color: '#e4a400' },
    { key: 'on-track', label: 'On Track', color: '#249b61' },
    { key: 'unknown', label: 'Unavailable', color: '#9895ab' },
  ];
  const total = learners.length;
  let cursor = 0;
  const segments = statuses.map(status => {
    const count = learners.filter(learner => canonicalOtjhStatus(learner) === status.key).length;
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
/* ═══════════════════════════════════════════════════════════
   Next review cell — an overdue review says so rather than
   showing a date the coach has to compare against today.
   ═══════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════
   KPI drill-down modal
   ═══════════════════════════════════════════════════════════ */
function KpiDetailModal({ type, loading, error, onRetry, learners, popupLearners, calendarEvents, weekEvents, evidenceQueue, pendingEvidence, onClose, onFilter }: {
  type: DashboardKpi;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  learners: CoachLearner[];
  popupLearners: DashboardPopupLearner[];
  calendarEvents: CoachCalendarEvent[];
  weekEvents: CoachCalendarEvent[];
  evidenceQueue: EvidenceQueueLearner[];
  pendingEvidence: number;
  onClose: () => void;
  onFilter: (filter: DashboardKpi) => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OtjhStatusKey | 'all'>('all');
  const modalPanel = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const isCaseload = type === 'caseload';
  const isPendingMarking = type === 'pending-marking';
  const [markingProgramme, setMarkingProgramme] = useState('');
  const isLightweightPopup = isCaseload || type === 'at-risk' || type === 'need-attention' || type === 'on-track';
  useEffect(() => {
    if (!isCaseload && !isPendingMarking) return;
    const previousFocus = document.activeElement;
    searchInput.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isCaseload, isPendingMarking]);
  const trapCaseloadFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((!isCaseload && !isPendingMarking) || event.key !== 'Tab') return;
    const controls = Array.from(modalPanel.current?.querySelectorAll<HTMLElement>('*') ?? [])
      .filter(element => element.matches('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
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
    'pending-marking': { title: 'Pending marking', subtitle: 'Submissions currently waiting for your review', icon: 'ri-file-list-3-line', iconStyle: 'bg-primary-50 text-primary-700' },
    'pr-week': { title: 'Progress reviews this week', subtitle: formatWeekRangeLabel(), icon: 'ri-focus-3-line', iconStyle: 'bg-amber-100 text-amber-700' },
    'mcm-week': { title: 'Monthly coaching this week', subtitle: formatWeekRangeLabel(), icon: 'ri-history-line', iconStyle: 'bg-amber-100 text-amber-700' },
    'catch-ups-week': { title: 'Catch-ups this week', subtitle: formatWeekRangeLabel(), icon: 'ri-calendar-event-line', iconStyle: 'bg-amber-100 text-amber-700' },
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
      : [];
  const lightweightLearners = type === 'at-risk'
    ? selectAtRiskPopupLearners(popupLearners)
    : type === 'on-track' || type === 'need-attention'
      ? popupLearners.filter(learner => learner.otjh.ragStatus === type)
      : popupLearners;
  const reviews = sortEvents(calendarEvents.filter(event => reviewCategory(event) === 'progress-review' && isWithinNextDays(event, 14)));
  const searchedLearners = lightweightLearners.filter(learner =>
    (statusFilter === 'all' || learner.otjh.ragStatus === statusFilter)
    && `${learner.name} ${learner.programme} ${learner.group}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const evidenceLearners = evidenceQueue;
  const markingProgrammes = [...new Set(evidenceQueue.map(learner => learner.programme).filter(value => value && value !== EMPTY_VALUE))].sort();
  const searchedMarkingLearners = evidenceQueue.filter(learner =>
    (!markingProgramme || learner.programme === markingProgramme)
    && `${learner.learner} ${learner.programme} ${learner.group}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const weeklyEventSource = type === 'pr-week' ? 'progress-review' : type === 'mcm-week' ? 'mcr' : type === 'catch-ups-week' ? 'catch-up' : null;
  const weeklyDetails = weeklyEventSource ? sortEvents(weekEvents.filter(event => reviewCategory(event) === weeklyEventSource)) : [];
  const detailCount = type === 'evidence' || type === 'pending-marking'
    ? pendingEvidence
    : type === 'reviews'
      ? reviews.length
      : weeklyEventSource
        ? weeklyDetails.length
        : isLightweightPopup ? lightweightLearners.length : modalLearners.length;

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

  const openLearnerProfile = (learner: Pick<CoachLearner, 'id' | 'name' | 'learnerType' | 'enrolmentId'>) => {
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
      <div className={cn("relative mx-auto flex min-h-full w-full items-start justify-center", isPendingMarking ? markingStyles.width : "max-w-5xl")}>
        <div ref={modalPanel} onKeyDown={trapCaseloadFocus} className={cn("relative my-auto flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-white/80 bg-background-50 shadow-xl", isPendingMarking && markingStyles.panel)}>
        {/* shrink-0 so a long caseload cannot squeeze the header away: the body
            below is the flex child that scrolls, and this stays put. */}
        <header className={cn(
          'relative z-10 shrink-0 overflow-hidden border-b border-foreground-100/80 px-5 py-5 sm:px-7 sm:py-6',
          isCaseload || isPendingMarking || type === 'mcm-week' || type === 'pr-week' ? 'bg-background-50' : 'bg-gradient-to-r from-primary-50/90 via-background-50 to-secondary-50/60',
          isCaseload && '!py-4',
          isPendingMarking && markingStyles.header,
        )}>
          {!isCaseload && !isPendingMarking && type !== 'mcm-week' && type !== 'pr-week' && <div className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-primary-200/25 blur-3xl"></div>}
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className={cn(`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-white/80 sm:h-14 sm:w-14 ${current.iconStyle}`, isPendingMarking && markingStyles.headerIcon)}><AppIcon className={`${current.icon} text-xl`}></AppIcon></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 id="kpi-modal-title" className="font-heading text-xl font-bold tracking-tight text-foreground-900 sm:text-2xl">{current.title}</h2>
                  <span aria-label={`${detailCount} total`} className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-primary-200/80 bg-background-50 px-2.5 text-xs font-bold text-primary-700 shadow-sm">{detailCount}</span>
                </div>
                <p id="kpi-modal-description" className="mt-1.5 text-xs leading-5 text-foreground-500 sm:text-sm">{current.subtitle}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-foreground-200/80 bg-background-50/90 text-foreground-500 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground-300 hover:text-foreground-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2" aria-label="Close"><AppIcon className="ri-close-line text-xl"></AppIcon></button>
          </div>
          {isCaseload && <div className={modalStyles.controls}>
            <label className={modalStyles.search}>
              <AppIcon className="ri-search-line" aria-hidden="true" />
              <span className="sr-only">Search learners</span>
              <input ref={searchInput} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, programme or group" />
            </label>
            <div className={modalStyles.filters} role="group" aria-label="Filter learners by OTJH status">
              {([{ key: 'all', label: 'All' }, { key: 'at-risk', label: 'At Risk' }, { key: 'need-attention', label: 'Need Attention' }, { key: 'on-track', label: 'On Track' }] as const).map(filter =>
                <button key={filter.key} type="button" aria-pressed={statusFilter === filter.key} onClick={() => setStatusFilter(filter.key)}>{filter.label}</button>,
              )}
            </div>
          </div>}
          {isPendingMarking && <div className={markingStyles.toolbar}>
            <label className={markingStyles.search}>
              <AppIcon className="ri-search-line" aria-hidden="true" />
              <span className="sr-only">Search learner</span>
              <input ref={searchInput} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search learner, programme or group" />
            </label>
            {markingProgrammes.length > 1 && <select className={markingStyles.filter} aria-label="Filter by programme" value={markingProgramme} onChange={event => setMarkingProgramme(event.target.value)}>
              <option value="">All programmes</option>
              {markingProgrammes.map(programme => <option key={programme} value={programme}>{programme}</option>)}
            </select>}
          </div>}
        </header>

        <div className={cn(
          'min-h-0 flex-1 overflow-y-auto p-4 sm:p-6',
          isCaseload || isPendingMarking || type === 'mcm-week' || type === 'pr-week' ? 'bg-background-50' : 'bg-gradient-to-b from-background-50 to-background-100/50',
          isCaseload && '!px-5 !py-2 sm:!px-7',
          isPendingMarking && markingStyles.body,
        )}>
          {loading && <div role="status" aria-label="Loading meeting details"><ScheduleSkeleton /></div>}
          {error && <div role="alert"><p>{error}</p><button type="button" onClick={onRetry}>Retry meetings</button></div>}
          {!loading && !error && (type === 'mcm-week' || type === 'pr-week') && (
            <CompactWeeklyMeetingDetails
              events={weeklyDetails}
              summaryLabel={type === 'mcm-week' ? 'Monthly coaching' : 'Progress review'}
              emptyIcon={current.icon}
            />
          )}
          {isLightweightPopup && <>
            <p className={modalStyles.resultCount} role="status">Showing {searchedLearners.length} of {lightweightLearners.length} learners</p>
            <ul className={modalStyles.list} aria-label="Learners">
              {searchedLearners.map(learner => {
                const status = OTJH_STATUS_META[learner.otjh.ragStatus === 'unavailable' ? 'unknown' : learner.otjh.ragStatus];
                const { completed, target } = learner.otjh;
                const hasHours = completed !== null && target !== null && target > 0;
                const percent = hasHours ? clampPercent(completed! / target! * 100) : null;
                const secondary = [learner.programme, learner.group].filter(value => value && value !== EMPTY_VALUE).join(' · ');
                return <li key={learner.id}>
                  <button type="button" className={modalStyles.row} onClick={() => openLearnerProfile(learner)} aria-label={`Open ${learner.name}'s profile`}>
                    <div className={modalStyles.identity}>
                      <LearnerAvatar name={learner.name} initials={learner.initials} size="sm" />
                      <div className={modalStyles.identityText}>
                        <div className={modalStyles.nameLine}>
                          <span className={modalStyles.name} title={learner.name}>{learner.name}</span>
                          {status.label !== EMPTY_VALUE && <StatusBadge tone={status.tone} label={status.label} size="sm" />}
                        </div>
                        <p className={modalStyles.secondary} title={secondary}>{secondary}</p>
                      </div>
                    </div>
                    <div className={modalStyles.hours}>
                      <div className={modalStyles.metricLine}><span>OTJH</span><strong>{hasHours ? `${completed} / ${target}h` : EMPTY_VALUE}</strong></div>
                      <div className={modalStyles.progressLine}>
                        <span className={modalStyles.progressTrack} aria-hidden="true"><span className="bg-primary-500" style={{ width: `${percent ?? 0}%` }} /></span>
                        <span>{percent === null ? EMPTY_VALUE : `${percent}%`}</span>
                      </div>
                    </div>
                    <AppIcon className={cn('ri-arrow-right-s-line', modalStyles.chevron)} aria-hidden="true" />
                  </button>
                </li>;
              })}
            </ul>
            {!searchedLearners.length && <EmptyState icon="ri-search-line" title="No learners found" description="Try another search or status filter." />}
          </>}
          {(type === 'active' || type === 'on-break' || type === 'completed' || type === 'epa') && (
            <div className="space-y-3.5">
              {modalLearners.map(learner => {
                const status = OTJH_STATUS_META[canonicalOtjhStatus(learner)];
                const otjhProgress = otjhProgressAsOfToday(learner);
                const otjh = otjhProgress.targetHours !== null && otjhProgress.targetHours > 0
                  ? `${otjhProgress.actualHours}/${otjhProgress.targetHours}`
                  : EMPTY_VALUE;
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
                      <ModalMiniMetric label="Attendance" value={learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE} tone={percentTone(learner.attendanceRateAvailable ? learner.attendanceRate : null, ATTENDANCE_MINIMUM_RATE, ATTENDANCE_EXPECTED_RATE)} />
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

          {isPendingMarking && <>
            <p className={markingStyles.resultCount} role="status">Showing {searchedMarkingLearners.length} of {evidenceLearners.length} learners</p>
            <ul className={markingStyles.list} aria-label="Learners awaiting marking">
              {searchedMarkingLearners.map(learner => {
                const caseloadMatch = learners.find(candidate => candidate.id === learner.learnerId);
                const context = [learner.programme, learner.group].filter(value => value && value !== EMPTY_VALUE).join(' \u00b7 ');
                return <li key={learner.id}>
                  <Link className={markingStyles.row} to={`/coach/marking-queue?learnerId=${encodeURIComponent(learner.learnerId)}`}
                    aria-label={`Open marking for ${learner.learner}`}
                    state={{ learnerId: learner.learnerId, learnerName: learner.learner, tab: 'evidence',
                      ...(caseloadMatch?.learnerType ? { kind: caseloadMatch.learnerType } : {}),
                      ...(caseloadMatch?.enrolmentId ? { enrolmentId: caseloadMatch.enrolmentId } : {}),
                    }} onClick={onClose}>
                    <div className={markingStyles.identity}>
                      <LearnerAvatar name={learner.learner} initials={learner.initials} tone="brand" size="sm" />
                      <div className={markingStyles.identityText}>
                        <p className={markingStyles.name} title={learner.learner}>{learner.learner}</p>
                        {context && <p className={markingStyles.context} title={context}>{context}</p>}
                      </div>
                    </div>
                    <div className={markingStyles.date}>
                      <span>Oldest pending</span>
                      <strong>{learner.oldestPendingDate ? formatCompletedSessionDate(learner.oldestPendingDate) : EMPTY_VALUE}</strong>
                    </div>
                    <div className={markingStyles.pending}>
                      <span className={markingStyles.badge}>{learner.pendingEvidence} Pending</span>
                      {learner.isOverdue && <span className={cn(markingStyles.overdue, 'text-red-600')}>Overdue</span>}
                    </div>
                    <AppIcon className={cn('ri-arrow-right-s-line', markingStyles.chevron)} aria-hidden="true" />
                  </Link>
                </li>;
              })}
            </ul>
            {!searchedMarkingLearners.length && <EmptyState icon="ri-file-search-line"
              title={evidenceLearners.length ? 'No learners found' : 'No evidence awaiting review'}
              description={evidenceLearners.length ? 'Try another search or programme filter.' : 'Learners will appear here when submitted evidence needs marking.'} />}
          </>}

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

          {weeklyEventSource && type !== 'mcm-week' && type !== 'pr-week' && (
            <div className="space-y-2">
              {weeklyDetails.map(event => {
                const date = eventDisplayDate(event);
                return (
                  <div key={event.eventKey || event.id} className="flex items-center gap-3 rounded-lg border border-foreground-100 bg-background-50 p-3">
                    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                      <span className="text-[12px] font-bold uppercase">{formatCalendarMonth(date)}</span>
                      <span className="text-sm font-bold leading-none">{formatCalendarDayNumber(date)}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-foreground-900">{displayValue(event.learner || event.title)}</p>
                      <p className="mt-0.5 text-[12px] text-foreground-400">{formatTimeLabel(event)} · {eventTypeLabel(event)}</p>
                    </div>
                    <StatusBadge status={event.status} label={statusLabel(event.status)} size="sm" />
                  </div>
                );
              })}
              {!weeklyDetails.length && (
                <EmptyState icon={current.icon} title="Nothing scheduled this week" description="There are no matching sessions in the current week." />
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

        <footer className={cn("sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-foreground-100 bg-background-50 px-5 py-4 sm:px-7", isPendingMarking && markingStyles.footer)}>
          <button type="button" onClick={onClose} className="rounded-xl border border-foreground-200 bg-background-50 px-4 py-2.5 text-xs font-semibold text-foreground-700 shadow-sm transition-colors hover:bg-background-100 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Close</button>
          {filterForType[type] && <button type="button" onClick={() => onFilter(filterForType[type]!)} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">View in caseload list</button>}
          {(type === 'evidence' || type === 'pending-marking') && <Link to="/coach/marking-queue" onClick={onClose} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open marking queue</Link>}
          {type === 'reviews' && <Link to="/coach/progress-reviews" onClick={onClose} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open reviews</Link>}
          {type === 'pr-week' && <Link to="/coach/progress-reviews" onClick={onClose} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open progress reviews</Link>}
          {type === 'mcm-week' && <Link to="/coach/monthly-coaching" onClick={onClose} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open monthly coaching</Link>}
          {type === 'catch-ups-week' && <Link to="/coach/timetable" onClick={onClose} className="primary-action rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">Open timetable</Link>}
        </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CompactWeeklyMeetingDetails({
  events,
  summaryLabel,
  emptyIcon,
}: {
  events: CoachCalendarEvent[];
  summaryLabel: string;
  emptyIcon: string;
}) {
  const notScheduled = events.filter(event => event.status === 'not-scheduled').length;
  const scheduled = events.length - notScheduled;
  const dayGroups = Array.from(events.reduce((groups, event) => {
    const date = eventDisplayDate(event);
    const existing = groups.get(date);
    if (existing) existing.push(event);
    else groups.set(date, [event]);
    return groups;
  }, new Map<string, CoachCalendarEvent[]>()));

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" aria-label={`${summaryLabel} summary`}>
        <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-800">
          <span className="h-1.5 w-1.5 rounded-full bg-primary-500" aria-hidden="true"></span>
          Scheduled <strong>{scheduled}</strong>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-foreground-200 bg-background-100 px-3 py-1.5 text-xs font-semibold text-foreground-700">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground-400" aria-hidden="true"></span>
          Not Scheduled <strong>{notScheduled}</strong>
        </span>
      </div>
      <div className="space-y-6">
        {dayGroups.map(([date, dayEvents]) => (
          <section key={date} aria-label={formatDateLabel(date)}>
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground-500">
              <span className="text-foreground-800">{formatCalendarWeekday(date)}</span>
              <span>{formatCalendarDayNumber(date)} {formatCalendarMonthShort(date)}</span>
            </h3>
            <div className="divide-y divide-foreground-100 border-y border-foreground-100">
              {dayEvents.map(event => {
                const context = [displayValue(event.programme), displayValue(event.group)]
                  .filter(value => value !== EMPTY_VALUE)
                  .join(' · ');
                return (
                  <div key={event.eventKey || event.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-2.5 sm:flex-nowrap sm:px-2">
                    <LearnerAvatar name={displayValue(event.learner || event.title)} size="sm" />
                    <div className="min-w-0 flex-1 basis-[12rem]">
                      <p className="truncate text-[13px] font-semibold text-foreground-900">{displayValue(event.learner || event.title)}</p>
                      {context && <p className="mt-0.5 truncate text-[11px] text-foreground-400">{context}</p>}
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground-600">{formatTimeLabel(event)}</span>
                    <StatusBadge status={event.status} label={statusLabel(event.status)} size="sm" />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {!events.length && (
          <EmptyState icon={emptyIcon} title="Nothing scheduled this week" description="There are no matching sessions in the current week." />
        )}
      </div>
    </div>
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
