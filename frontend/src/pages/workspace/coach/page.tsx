import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { fetchCurriculumOverview, type CurriculumGroup, type CurriculumOverview, type CurriculumSession, type CurriculumStaffProfile } from '@/lib/curriculumApi';
import { fetchSharedJsonGet } from '@/lib/sharedGetJson';
import { roleNavMap } from '@/mocks/navigation';
import {
  DEFAULT_COACH_EMAIL,
  type CoachCalendarEvent,
  eventDisplayDate,
  eventTargetDate,
  eventPeriodLabel,
  fetchCoachCalendarEvents,
  formatDateLabel,
  formatTimeLabel,
  isAtRiskEvent,
  isCompletedEvent,
  parseLocalDate,
  sortEvents,
} from '../../coach/shared/calendarEvents';

const coachNav = roleNavMap.coach;

type OtjhFilter = 'all' | 'at-risk' | 'need-attention' | 'on-track';
type DashboardKpi = 'caseload' | 'active' | 'on-break' | 'on-track' | 'at-risk' | 'need-attention' | 'gateway' | 'epa' | 'evidence' | 'reviews';
type OtjhStatusKey = 'at-risk' | 'need-attention' | 'on-track' | 'unknown';
type PerformanceStatus = 'on-track' | 'at-risk' | 'high' | 'new-starter';
type ScheduleStatus = 'upcoming' | 'overdue' | 'needs-schedule' | 'none';

const EMPTY_VALUE = '--';
const CASELOAD_ENDPOINT = `/coach_api/coach/caseload?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const ATTENDANCE_ENDPOINT = `/coach_api/coach/attendance?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const ABSENCE_REPORTS_ENDPOINT = `/coach_api/coach/absence-reports?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const EVIDENCE_AWAITING_REVIEW_ENDPOINT = `/coach_api/coach/evidence-awaiting-review?owner_email=${encodeURIComponent(DEFAULT_COACH_EMAIL)}`;
const AT_RISK_SCROLL_THRESHOLD = 8;

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

function isLowHoursRiskFlag(value?: string | null) {
  return displayValue(value).toLowerCase().includes('low hours');
}

function riskFlagClass(value?: string | null) {
  return isLowHoursRiskFlag(value)
    ? 'border-red-100 bg-red-50 text-red-600'
    : 'border-amber-100 bg-amber-50 text-amber-700';
}

function normalizeOtjhStatus(value?: string | null): OtjhStatusKey {
  const normalized = displayValue(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'atrisk') return 'at-risk';
  if (normalized === 'needattention' || normalized === 'needsattention') return 'need-attention';
  if (normalized === 'ontrack') return 'on-track';
  return 'unknown';
}

interface CoachAbsenceReport {
  id: string;
  learnerId: string;
  learner: string;
  sessionTitle: string;
  sessionDate: string;
  sessionTime?: string | null;
  reasonCategory: string;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  evidenceProvided: boolean;
}

interface AbsenceReportsResponse {
  items?: CoachAbsenceReport[];
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

const OTJH_STATUS_META: Record<OtjhStatusKey, { label: string; cardLabel: string; sub: string; color: 'primary' | 'emerald' | 'red' | 'amber'; bg: string; text: string; bar: string; avatar: string }> = {
  'at-risk': {
    label: 'OTJH at risk',
    cardLabel: 'At Risk',
    sub: 'OTJH at risk',
    color: 'red',
    bg: 'bg-red-50 border-red-200/50',
    text: 'text-red-700',
    bar: 'bg-red-500',
    avatar: 'bg-primary-50 text-primary-600 ring-primary-100',
  },
  'need-attention': {
    label: 'Need Attention',
    cardLabel: 'Need Attention',
    sub: 'Needs support',
    color: 'amber',
    bg: 'bg-amber-50 border-amber-200/50',
    text: 'text-amber-700',
    bar: 'bg-amber-500',
    avatar: 'bg-amber-100 text-amber-700 ring-amber-200',
  },
  'on-track': {
    label: 'On Track',
    cardLabel: 'On Track',
    sub: 'On target',
    color: 'emerald',
    bg: 'bg-emerald-50 border-emerald-200/50',
    text: 'text-emerald-700',
    bar: 'bg-emerald-500',
    avatar: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  },
  unknown: {
    label: EMPTY_VALUE,
    cardLabel: 'Unknown',
    sub: 'No OTJH status',
    color: 'primary',
    bg: 'bg-foreground-50 border-foreground-200/50',
    text: 'text-foreground-600',
    bar: 'bg-foreground-400',
    avatar: 'bg-foreground-100 text-foreground-600 ring-foreground-200',
  },
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

function getFirstName(name: string) {
  const value = displayValue(name);
  return value === EMPTY_VALUE ? 'Coach' : value.split(/\s+/)[0];
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

function parseTimeHour(value?: string | null): number | undefined {
  const [hour] = displayValue(value).split(':').map(Number);
  return Number.isFinite(hour) ? hour : undefined;
}

function coachMatchesGroup(group: CurriculumGroup, ownerName: string): boolean {
  return normalizeIdentity(group.coach) === normalizeIdentity(ownerName);
}

function curriculumStaffName(profile: CurriculumStaffProfile): string {
  const legacyCoachName = typeof profile.Coach_name === 'string' ? profile.Coach_name : undefined;
  return displayValue(profile.name || legacyCoachName || profile.email);
}

function coachMatchesProfile(profile: CurriculumStaffProfile, ownerName: string, ownerEmail: string): boolean {
  const profileEmail = normalizeIdentity(profile.email);
  if (profileEmail && profileEmail === normalizeIdentity(ownerEmail)) return true;
  return normalizeIdentity(curriculumStaffName(profile)) === normalizeIdentity(ownerName);
}

function curriculumSessionToCalendarEvent(session: CurriculumSession): CoachCalendarEvent {
  const title = displayValue(session.title);
  const moduleName = displayValue(session.module);
  const groupName = displayValue(session.group);

  return {
    id: `curriculum-${session.id}`,
    eventKey: `curriculum-${session.id}`,
    title: title === EMPTY_VALUE ? moduleName : title,
    type: 'live-session',
    date: session.date,
    scheduledDate: session.date || null,
    scheduledTime: session.startTime || null,
    startHour: parseTimeHour(session.startTime),
    endHour: parseTimeHour(session.endTime),
    timeLabel: session.startTime && session.endTime ? `${session.startTime} - ${session.endTime}` : session.startTime || 'Time TBC',
    learner: groupName,
    programme: session.programme,
    cohort: session.cohort,
    status: session.status === 'completed' || session.status === 'cancelled' ? session.status : 'scheduled',
    source: 'live-session',
    platform: displayValue(session.venue) === EMPTY_VALUE ? 'LMS' : displayValue(session.venue),
    location: groupName,
    notes: moduleName === EMPTY_VALUE ? '' : `Module: ${moduleName}${session.week ? ` · Week ${session.week}` : ''}`,
  };
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

function buildRiskSummary(learners: CoachLearner[]) {
  return learners
    .slice(0, 4)
    .map(learner => `${learner.name}: ${learner.riskFlags[0] || learner.recentFlag || 'Needs attention'}`)
    .join('. ');
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
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`transition-all duration-[500ms] ease-out ${className} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Donut Ring
   ═══════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════
   Progress Bar
   ═══════════════════════════════════════════════════════════ */
function ProgressBar({ pct, color, height = 3 }: { pct: number; color: string; height?: number }) {
  const barColors: Record<string, string> = {
    primary: 'bg-primary-500', accent: 'bg-accent-500', secondary: 'bg-secondary-500',
    emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500',
  };
  return (
    <div className="w-full rounded-full bg-background-200 overflow-hidden" style={{ height }}>
      <div className={`h-full rounded-full transition-all duration-700 ease-out ${barColors[color] || 'bg-primary-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export default function CoachDashboard() {
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpi | null>(null);
  const [ownerName, setOwnerName] = useState('Med Maher');
  const [ownerEmail, setOwnerEmail] = useState(DEFAULT_COACH_EMAIL);
  const [learners, setLearners] = useState<CoachLearner[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CoachCalendarEvent[]>([]);
  const [curriculumOverview, setCurriculumOverview] = useState<CurriculumOverview | null>(null);
  const [absenceReports, setAbsenceReports] = useState<CoachAbsenceReport[]>([]);
  const [evidenceQueue, setEvidenceQueue] = useState<EvidenceQueueLearner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setLoading(true);
      setLoadWarning(null);
      const warnings: string[] = [];

      const [caseloadResult, attendanceResult, timetableResult, absenceResult, curriculumResult, markingResult] = await Promise.allSettled([
        fetchSharedJsonGet<CaseloadApiResponse>(CASELOAD_ENDPOINT, { signal: controller.signal }),
        fetchSharedJsonGet<AttendanceApiResponse>(ATTENDANCE_ENDPOINT, { signal: controller.signal }),
        fetchCoachCalendarEvents(controller.signal),
        fetchSharedJsonGet<AbsenceReportsResponse>(ABSENCE_REPORTS_ENDPOINT, { signal: controller.signal }),
        fetchCurriculumOverview(controller.signal),
        fetchSharedJsonGet<MarkingQueueResponse>(EVIDENCE_AWAITING_REVIEW_ENDPOINT, { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;

      if (caseloadResult.status === 'fulfilled') {
        setOwnerName(displayValue(caseloadResult.value.owner?.name) === EMPTY_VALUE ? 'Med Maher' : String(caseloadResult.value.owner?.name));
        setOwnerEmail(displayValue(caseloadResult.value.owner?.email) === EMPTY_VALUE ? DEFAULT_COACH_EMAIL : String(caseloadResult.value.owner?.email));
        const normalizedLearners = (caseloadResult.value.learners || []).map(normalizeLearner);
        if (attendanceResult.status === 'fulfilled') {
          setLearners(mergeAttendanceRates(normalizedLearners, attendanceResult.value.learners || []));
        } else {
          setLearners(normalizedLearners);
          warnings.push('attendance');
        }
      } else {
        setLearners([]);
        warnings.push('caseload');
        if (attendanceResult.status === 'rejected') {
          warnings.push('attendance');
        }
      }

      if (timetableResult.status === 'fulfilled') {
        setCalendarEvents(sortEvents(timetableResult.value.events || []));
        if (displayValue(timetableResult.value.owner?.name) !== EMPTY_VALUE) {
          setOwnerName(String(timetableResult.value.owner?.name));
        }
      } else {
        setCalendarEvents([]);
        warnings.push('calendar');
      }

      if (absenceResult.status === 'fulfilled') {
        setAbsenceReports(absenceResult.value.items || []);
      } else {
        setAbsenceReports([]);
        warnings.push('absence reports');
      }

      if (curriculumResult.status === 'fulfilled') {
        setCurriculumOverview(curriculumResult.value);
      } else {
        setCurriculumOverview(null);
        warnings.push('curriculum sessions');
      }

      if (markingResult.status === 'fulfilled') {
        setEvidenceQueue((markingResult.value.items || []).map(normalizeEvidenceQueueLearner));
      } else {
        setEvidenceQueue([]);
        warnings.push('evidence queue');
      }

      setLoadWarning(warnings.length ? `Unable to load ${warnings.join(', ')} data right now.` : null);
      setLoading(false);
    }

    loadDashboard();
    return () => controller.abort();
  }, []);

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
  const activeLearners = enrichedLearners.filter(isActiveLearner);
  const onBreakLearners = enrichedLearners.filter(isOnBreakLearner);
  const gatewayLearners = enrichedLearners.filter(isGatewayLearner);
  const epaLearners = enrichedLearners.filter(isEpaLearner);

  const atRiskLearners = activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'at-risk');
  const needAttentionLearners = activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'need-attention');
  const onTrackLearners = activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'on-track');
  const atRiskCaseloadHasOverflow = atRiskLearners.length > AT_RISK_SCROLL_THRESHOLD;
  const evidenceLearners = evidenceQueue
    .filter(learner => learner.pendingEvidence > 0)
    .sort((a, b) => b.pendingEvidence - a.pendingEvidence || a.learner.localeCompare(b.learner));
  const atRiskCount = atRiskLearners.length;
  const needAttentionCount = needAttentionLearners.length;
  const onTrackCount = onTrackLearners.length;
  const totalCaseload = enrichedLearners.length;
  const pendingEvidence = evidenceLearners.reduce((total, learner) => total + learner.pendingEvidence, 0);
  const completedEvidence = evidenceLearners.reduce((total, learner) => total + learner.acceptedEvidence, 0);
  const activeCalendarEvents = calendarEvents.filter(event => event.source === 'live-session' || activeLearners.some(learner => eventMatchesLearner(event, learner)));
  const visibleCalendarEvents = sortEvents(activeCalendarEvents.filter(isFutureCalendarEvent));
  const curriculumCoachGroupIds = useMemo(() => new Set(
    (curriculumOverview?.coaches || [])
      .filter(profile => coachMatchesProfile(profile, ownerName, ownerEmail))
      .flatMap(profile => profile.assignedGroupIds || []),
  ), [curriculumOverview, ownerEmail, ownerName]);
  const legacyCoachGroupIds = useMemo(() => new Set(
    (curriculumOverview?.groups || [])
      .filter(group => coachMatchesGroup(group, ownerName))
      .map(group => group.id),
  ), [curriculumOverview, ownerName]);
  const assignedCurriculumGroupIds = curriculumCoachGroupIds.size ? curriculumCoachGroupIds : legacyCoachGroupIds;
  const upcomingLiveSessions = useMemo(() => sortEvents(
    (curriculumOverview?.sessions || [])
      .filter(session => assignedCurriculumGroupIds.has(session.groupId || ''))
      .map(curriculumSessionToCalendarEvent)
      .filter(event => !['completed', 'cancelled'].includes(event.status) && isFutureCalendarEvent(event)),
  ), [assignedCurriculumGroupIds, curriculumOverview]);
  const upcomingLiveSessionCards = Array.from(
    upcomingLiveSessions.reduce((byGroup, event) => {
      const groupKey = normalizeIdentity(`${event.programme}-${event.cohort}-${event.location}`);
      if (!byGroup.has(groupKey)) {
        byGroup.set(groupKey, event);
      }
      return byGroup;
    }, new Map<string, CoachCalendarEvent>()).values(),
  );
  const riskSummary = buildRiskSummary(atRiskLearners);
  const pendingAbsenceReports = absenceReports.filter(report => report.status === 'pending');
  const dashboardPanelClass = 'rounded-[24px] border border-foreground-200/70 bg-background-50/95 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)] backdrop-blur-sm';

  const openCaseloadFilter = (_filter: OtjhFilter) => {
    window.requestAnimationFrame(() => {
      document.getElementById('learner-caseload')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <WorkspaceShell
      role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Coach Dashboard" pageSubtitle="Monitor learner progress, manage coaching sessions, and review evidence"
      userName={ownerName} userRole="Progress Coach"
    >
      <div className="space-y-6 p-3 md:p-6">

        {/* ═══════════════════════════════════════════════════
            SECTION 1 — HERO BANNER
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={0}>
          <section
            className="relative overflow-hidden rounded-2xl h-36 md:h-40"
            style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
          >
            <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute opacity-20" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
              <div className="absolute opacity-10" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
            </div>
            <div className="relative h-full flex flex-col justify-center p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                <div className="flex-1 min-w-0 max-w-xl">
                  <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">Good morning, {getFirstName(ownerName)}</h1>
                  <p className="text-[13px] text-white/50 max-w-lg">
                    Manage your complete caseload. Track learner progress, review evidence, and schedule coaching sessions.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 2 — KPI STAT CARDS
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={60}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Caseload" value={String(totalCaseload)} sub={`${onTrackCount} on track`} icon="ri-group-line" color="primary" active={selectedKpi === 'caseload'} onClick={() => setSelectedKpi('caseload')} />
            <StatCard label="Active Learners" value={String(activeLearners.length)} sub="Currently active" icon="ri-user-follow-line" color="emerald" active={selectedKpi === 'active'} onClick={() => setSelectedKpi('active')} />
            <StatCard label="Gateway" value={String(gatewayLearners.length)} sub="At gateway stage" icon="ri-flag-line" color="accent" active={selectedKpi === 'gateway'} onClick={() => setSelectedKpi('gateway')} />
            <StatCard label="EPA" value={String(epaLearners.length)} sub="At EPA stage" icon="ri-award-line" color="secondary" active={selectedKpi === 'epa'} onClick={() => setSelectedKpi('epa')} />
            <StatCard label="On Break" value={String(onBreakLearners.length)} sub="Programme paused" icon="ri-pause-circle-line" color="amber" active={selectedKpi === 'on-break'} onClick={() => setSelectedKpi('on-break')} />
            <StatCard label="On Track" value={String(onTrackCount)} sub={OTJH_STATUS_META['on-track'].sub} icon="ri-checkbox-circle-line" color={OTJH_STATUS_META['on-track'].color} active={selectedKpi === 'on-track'} onClick={() => setSelectedKpi('on-track')} />
            <StatCard label="At Risk" value={String(atRiskCount)} sub={OTJH_STATUS_META['at-risk'].sub} icon="ri-alert-line" color={OTJH_STATUS_META['at-risk'].color} active={selectedKpi === 'at-risk'} onClick={() => setSelectedKpi('at-risk')} />
            <StatCard label="Need Attention" value={String(needAttentionCount)} sub={OTJH_STATUS_META['need-attention'].sub} icon="ri-error-warning-line" color={OTJH_STATUS_META['need-attention'].color} active={selectedKpi === 'need-attention'} onClick={() => setSelectedKpi('need-attention')} />
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 3 — RISK ALERT BANNER
            ═══════════════════════════════════════════════════ */}
        {(loading || loadWarning) && (
          <SectionReveal delay={70}>
            <div className={`rounded-xl border p-3 text-[12px] ${loadWarning ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-background-50 border-foreground-200/60 text-foreground-500'}`}>
              {loading ? 'Loading live coach dashboard data...' : loadWarning}
            </div>
          </SectionReveal>
        )}

        {atRiskCount > 0 && (
          <SectionReveal delay={80}>
            <div className="rounded-xl border border-red-200/50 bg-red-50/70 p-3 md:p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <i className="ri-alert-fill text-red-600 text-base"></i>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">Risk Alert: {atRiskCount} learners need immediate attention</p>
                <p className="mt-0.5 truncate text-[12px] text-red-600">
                  {riskSummary || EMPTY_VALUE}
                </p>
              </div>
            </div>
          </SectionReveal>
        )}

        {/* ═══════════════════════════════════════════════════
            MAIN CONTENT — 2 Columns
            ═══════════════════════════════════════════════════ */}
        <div className="space-y-6">

          {/* ─────── Left Column (2/3) ─────── */}
          <div className="space-y-6">

            {/* Learner Caseload */}
            <SectionReveal delay={100}>
              <section id="learner-caseload" className={`${dashboardPanelClass} scroll-mt-4 p-4 md:p-5`}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-heading font-semibold text-foreground-900">At Risk Learners</h2>
                    <p className="mt-1 text-sm text-foreground-400">Showing only learners currently flagged at risk</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <p className="whitespace-nowrap pt-0.5 text-sm font-medium text-foreground-400">{atRiskCount} learners</p>
                    <Link
                      to="/coach/caseload"
                      className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-primary-100 bg-primary-50 px-3.5 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
                    >
                      <i className="ri-group-line"></i>
                      All Learners
                    </Link>
                  </div>
                </div>
                <div className={`${atRiskCaseloadHasOverflow ? 'max-h-[36rem] overflow-y-auto pr-2' : ''} space-y-3`}>
                  {atRiskLearners.map(learner => (
                    <LearnerRow
                      key={learner.id}
                      learner={learner}
                    />
                  ))}
                  {atRiskLearners.length === 0 && (
                    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6 text-center text-[12px] text-foreground-400">
                      {loading ? 'Loading learners...' : 'No at-risk learners right now.'}
                    </div>
                  )}
                </div>
              </section>
            </SectionReveal>

            <div className="grid grid-cols-1 items-stretch gap-6 lg:h-[680px] lg:grid-cols-2">
            {/* Upcoming Live Sessions */}
            <SectionReveal delay={140} className="lg:min-h-0">
              <section className={`${dashboardPanelClass} flex h-full min-h-0 flex-col p-4 md:p-5`}>
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h2 className="text-lg font-heading font-semibold text-foreground-900">Upcoming Live Sessions</h2>
                    <p className="mt-1 text-sm text-foreground-400">Live tutor-led sessions scheduled for your learners</p>
                  </div>
                  <Link to="/coach/timetable" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-primary-100 bg-primary-50 px-3.5 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-100">
                    <i className="ri-calendar-line"></i> Full Calendar
                  </Link>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {upcomingLiveSessionCards.map(event => {
                    const sessionDate = eventDisplayDate(event);
                    return (
                      <Link to="/coach/timetable" key={event.eventKey || event.id} className="group flex flex-col rounded-2xl border border-sky-100/80 bg-sky-50/35 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_18px_45px_-32px_rgba(14,165,233,0.55)]">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <span className="rounded-full border border-sky-100 bg-background-50 px-2.5 py-1 text-[9px] font-semibold text-sky-700"><i className="ri-live-line mr-1"></i>Live Session</span>
                          <span className="rounded-full bg-background-50 px-2.5 py-1 text-[9px] font-semibold text-foreground-500">{formatDateLabel(sessionDate)}</span>
                        </div>
                        <p className="line-clamp-2 text-[15px] font-semibold leading-6 text-foreground-900">{displayValue(event.title)}</p>
                        <p className="mt-1 truncate text-[10px] text-foreground-400">{displayValue(event.programme)} · {displayValue(event.cohort)}{event.location ? ` · ${event.location}` : ''}</p>
                        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-background-200/70 bg-background-50/80 px-3 py-2.5 text-[10px]">
                          <span className="text-foreground-600"><i className="ri-time-line mr-1 text-sky-500"></i>{upcomingLiveSessionTimeLabel(event)}</span>
                          <span className="text-foreground-500"><i className="ri-video-line mr-1 text-sky-500"></i>{displayValue(event.platform)}</span>
                        </div>
                      </Link>
                    );
                  })}
                  {!upcomingLiveSessionCards.length && (
                    <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-6 text-center text-[11px] text-foreground-400 lg:col-span-2">No upcoming live sessions scheduled.</div>
                  )}
                </div>
              </section>
            </SectionReveal>

            {/* Coaching Calendar */}
            <SectionReveal delay={120} className="lg:min-h-0">
              <section className={`${dashboardPanelClass} flex h-full min-h-0 flex-col p-4 md:p-5`}>
                <div className="flex items-center justify-between mb-3 md:mb-4">
                  <div>
                    <h3 className="text-base font-heading font-semibold text-foreground-900">Coaching Calendar</h3>
                    <p className="mt-1 text-[11px] text-foreground-400">Upcoming learner sessions and review activity</p>
                  </div>
                  <span className="rounded-full bg-background-100 px-2.5 py-1 text-[10px] text-foreground-500">{visibleCalendarEvents.length} sessions</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
                  {visibleCalendarEvents.length === 0 && (
                    <div className="p-6 text-center text-[12px] text-foreground-400">
                      {loading ? 'Loading calendar...' : 'No calendar events found.'}
                    </div>
                  )}
                  {visibleCalendarEvents.map(event => {
                    const classes = eventStatusClasses(event);
                    const displayDate = eventDisplayDate(event);
                    return (
                      <div key={event.eventKey || event.id} className={`flex items-start gap-3 rounded-2xl border border-foreground-200/50 p-3 transition-smooth cursor-pointer ${classes.row}`}>
                        <div className="min-w-[50px] shrink-0 rounded-xl bg-background-50/90 py-2 text-center">
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${classes.date}`}>{formatCalendarMonth(displayDate)}</p>
                          <p className={`text-base font-bold ${isAtRiskEvent(event) ? 'text-red-700' : 'text-foreground-900'}`}>{formatCalendarDayNumber(displayDate)}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-foreground-900">{displayValue(event.learner)}</p>
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-foreground-500">{formatTimeLabel(event)}</span>
                            <span className="text-[8px] text-foreground-300">&middot;</span>
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${classes.badge}`}>{eventTypeLabel(event)}</span>
                          </div>
                        </div>
                        <i className={`text-sm shrink-0 ${classes.icon}`}></i>
                      </div>
                    );
                  })}
                </div>
              </section>
            </SectionReveal>
            </div>

            {/* Evidence Queue */}
            <SectionReveal delay={180}>
              <section className={`${dashboardPanelClass} p-4 md:p-5`}>
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-heading font-semibold text-foreground-900">Evidence Awaiting Review</h2>
                      <span className="rounded-full bg-secondary-50 px-2 py-0.5 text-[10px] font-semibold text-secondary-700">{evidenceLearners.length}</span>
                    </div>
                    <p className="mt-1 text-sm text-foreground-400">Learners with evidence waiting to be reviewed</p>
                  </div>
                  <Link to="/coach/marking-queue" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-primary-100 bg-primary-50 px-3.5 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-100 cursor-pointer">
                    View All <i className="ri-arrow-right-line"></i>
                  </Link>
                </div>
                <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                  {evidenceLearners.map(learner => (
                    <Link
                      key={learner.id}
                      to={`/coach/learner-case-file?id=${encodeURIComponent(learner.learnerId)}&tab=evidence`}
                      state={{ learnerId: learner.learnerId, learnerName: learner.learner, tab: 'evidence' }}
                      className="flex items-center gap-3 rounded-2xl border border-foreground-200/60 bg-background-100/70 p-3.5 transition-all hover:-translate-y-0.5 hover:border-secondary-200 hover:bg-secondary-50/30"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary-50 text-secondary-600"><i className="ri-file-list-3-line"></i></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-foreground-900">{learner.learner}</p>
                        <p className="truncate text-[9px] text-foreground-400">{learner.programme} · {learner.group}</p>
                      </div>
                      <span className="text-right">
                        <span className="block text-[11px] font-bold text-secondary-700">{learner.pendingEvidence} / {learner.totalEvidence}</span>
                        <span className="block text-[8px] text-foreground-400">Pending / Total</span>
                        {learner.lastSubmission !== EMPTY_VALUE && <span className="block text-[8px] text-foreground-400">Last {learner.lastSubmission}</span>}
                      </span>
                      <i className="ri-arrow-right-s-line text-foreground-300"></i>
                    </Link>
                  ))}
                  {!evidenceLearners.length && <ModalEmpty icon="ri-file-search-line" title="No evidence awaiting review" description="Learners will appear here when submitted evidence needs marking." />}
                </div>
              </section>
            </SectionReveal>
          </div>

          {/* ─────── Right Column (1/3) ─────── */}
          <div className="space-y-5">
            {/* Absence Reports */}
            <SectionReveal delay={160}>
              <section className={`${dashboardPanelClass} p-4 md:p-5`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-heading font-semibold text-foreground-900">
                    Absence Reports
                    <span className="ml-2 text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingAbsenceReports.length} pending</span>
                  </h3>
                  <Link to="/coach/absence-reports" className="text-[10px] font-semibold text-primary-600 hover:text-primary-700">View All <i className="ri-arrow-right-s-line"></i></Link>
                </div>
                <div className="space-y-2.5">
                  {pendingAbsenceReports.slice(0, 4).map(report => (
                    <Link key={report.id} to="/coach/absence-reports" className="flex items-center gap-3 rounded-2xl border border-foreground-200/60 bg-background-100/60 p-3 transition-colors hover:bg-background-100">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600"><i className="ri-emotion-sad-line text-sm"></i></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold text-foreground-900">{report.learner}</p>
                        <p className="truncate text-[10px] text-foreground-400">{formatDateLabel(report.sessionDate)} · {report.reason}</p>
                      </div>
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[8px] font-semibold capitalize text-amber-700">{report.reasonCategory}</span>
                    </Link>
                  ))}
                  {!pendingAbsenceReports.length && <div className="rounded-lg bg-background-100/50 p-5 text-center text-[10px] text-foreground-400">{loading ? 'Loading absence reports...' : 'No pending absence reports.'}</div>}
                </div>
              </section>
            </SectionReveal>

          </div>
        </div>

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

/* ═══════════════════════════════════════════════════════════
   Hero Stat Pill
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

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="kpi-modal-title">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-foreground-950/45 backdrop-blur-[5px]" aria-label="Close popup"></button>
      <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-foreground-200/70 bg-background-50/95 shadow-[0_36px_90px_-38px_rgba(15,23,42,0.5)]">
        <header className="flex items-start justify-between gap-4 border-b border-foreground-100/80 bg-background-50/95 px-5 py-5 md:px-6">
          <div className="flex items-center gap-3">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35)] ${current.iconStyle}`}><i className={`${current.icon} text-lg`}></i></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="kpi-modal-title" className="font-heading text-lg font-bold text-foreground-900">{current.title}</h2>
                <span className="rounded-full border border-foreground-200/70 bg-background-100 px-2.5 py-1 text-[10px] font-bold text-foreground-600">{type === 'evidence' ? pendingEvidence : type === 'reviews' ? reviews.length : modalLearners.length}</span>
              </div>
              <p className="mt-1 text-[11px] text-foreground-400">{current.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-transparent text-foreground-400 transition-colors hover:border-foreground-200 hover:bg-background-100 hover:text-foreground-700" aria-label="Close"><i className="ri-close-line text-lg"></i></button>
        </header>

        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-background-50 to-background-100/35 p-4 md:p-5">
          {(type === 'caseload' || type === 'active' || type === 'on-break' || type === 'on-track' || type === 'at-risk' || type === 'need-attention' || type === 'gateway' || type === 'epa') && (
            <div className="space-y-3">
              {modalLearners.map(learner => {
                const status = OTJH_STATUS_META[normalizeOtjhStatus(learner.otjhStatus)];
                const attendance = learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
                const otjh = learner.otjhTarget > 0 ? `${learner.otjhCompleted}/${learner.otjhTarget}` : EMPTY_VALUE;
                const badge = learnerStageBadge(learner);
                return (
                  <div key={learner.id} className="rounded-2xl border border-foreground-200/70 bg-background-50 px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all hover:-translate-y-px hover:border-foreground-300/70 hover:shadow-[0_14px_32px_-24px_rgba(15,23,42,0.28)]">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${badge.avatarClass}`}><span>{learner.initials}</span></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[12px] font-semibold text-foreground-900">{learner.name}</p>
                        {type === 'active' || type === 'on-break' ? (
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${isActiveLearner(learner) ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>{displayValue(learner.rawProgramStatus)}</span>
                        ) : type === 'gateway' || type === 'epa' ? (
                          <span className="rounded-full border border-secondary-100 bg-secondary-50 px-2 py-0.5 text-[9px] font-semibold text-secondary-700">{type === 'gateway' ? 'Gateway' : 'EPA'}</span>
                        ) : (
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${status.bg} ${status.text}`}>{status.label}</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[9px] text-foreground-400">{learner.programme} · {learner.group}</p>
                    </div>
                    <div className="hidden grid-cols-3 gap-2 text-center md:grid md:min-w-[250px]">
                      <ModalMiniMetric label="OTJH" value={otjh} />
                      <ModalMiniMetric label="KSB" value={learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE} />
                      <ModalMiniMetric label="Attendance" value={attendance} tone={toneFromPercent(learner.attendanceRateAvailable ? learner.attendanceRate : null, 80, 90)} />
                    </div>
                    </div>
                  </div>
                );
              })}
              {!modalLearners.length && <ModalEmpty icon={current.icon} title="No learners in this status" description="This list will update automatically when learner data changes." />}
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
                  className="flex items-center gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all hover:-translate-y-px hover:border-secondary-200 hover:bg-secondary-50/30 hover:shadow-[0_14px_32px_-24px_rgba(15,23,42,0.28)]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-50 text-[10px] font-bold text-secondary-700">{learner.initials}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-foreground-900">{learner.learner}</p><p className="mt-0.5 truncate text-[9px] text-foreground-400">{learner.programme} · {learner.group}</p></div>
                  <div className="text-right"><p className="text-sm font-bold text-secondary-700">{learner.pendingEvidence} / {learner.totalEvidence}</p><p className="text-[8px] text-foreground-400">Pending / Total</p>{learner.isOverdue && <p className="mt-0.5 text-[8px] font-semibold text-red-600">Overdue</p>}</div>
                  <i className="ri-arrow-right-s-line text-foreground-300"></i>
                </Link>
              ))}
              {!evidenceLearners.length && <ModalEmpty icon="ri-file-search-line" title="No evidence awaiting review" description="Learners will appear here when submitted evidence needs marking." />}
            </div>
          )}

          {type === 'reviews' && (
            <div className="space-y-2">
              {reviews.map(event => {
                const date = eventDisplayDate(event);
                return <div key={event.eventKey || event.id} className="flex items-center gap-3 rounded-xl border border-foreground-100 p-3"><span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-50 text-primary-700"><span className="text-[7px] font-bold uppercase">{formatCalendarMonth(date)}</span><span className="text-sm font-bold leading-none">{formatCalendarDayNumber(date)}</span></span><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-foreground-900">{displayValue(event.learner)}</p><p className="mt-0.5 text-[9px] text-foreground-400">{formatTimeLabel(event)} · {eventTypeLabel(event)}</p></div><i className="ri-arrow-right-s-line text-foreground-300"></i></div>;
              })}
              {!reviews.length && <ModalEmpty icon="ri-calendar-check-line" title="No reviews due" description="There are no progress reviews scheduled in the next 14 days." />}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-foreground-100 bg-background-100/50 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-foreground-200 bg-background-50 px-3.5 py-2 text-[10px] font-semibold text-foreground-600 transition-colors hover:bg-background-100">Close</button>
          {filterForType[type] && <button type="button" onClick={() => onFilter(filterForType[type]!)} className="rounded-xl bg-primary-600 px-3.5 py-2 text-[10px] font-semibold text-white transition-colors hover:bg-primary-700">Jump to at-risk list</button>}
          {type === 'evidence' && <Link to="/coach/marking-queue" onClick={onClose} className="rounded-xl bg-primary-600 px-3.5 py-2 text-[10px] font-semibold text-white transition-colors hover:bg-primary-700">Open marking queue</Link>}
          {type === 'reviews' && <Link to="/coach/progress-reviews" onClick={onClose} className="rounded-xl bg-primary-600 px-3.5 py-2 text-[10px] font-semibold text-white transition-colors hover:bg-primary-700">Open reviews</Link>}
        </footer>
      </div>
    </div>
  );
}

function ModalMiniMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: MetricTone }) {
  const toneClass = tone === 'danger'
    ? 'border-red-100 bg-red-50/70 text-red-700'
    : tone === 'warning'
      ? 'border-amber-100 bg-amber-50/70 text-amber-700'
      : tone === 'success'
        ? 'border-emerald-100 bg-emerald-50/70 text-emerald-700'
        : tone === 'primary'
          ? 'border-primary-100 bg-primary-50/70 text-primary-700'
          : 'border-foreground-200/60 bg-background-50 text-foreground-800';

  return (
    <div className={`rounded-xl border px-2.5 py-2 ${toneClass}`}>
      <p className="text-[10px] font-bold leading-none">{value}</p>
      <p className="mt-1 text-[7px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</p>
    </div>
  );
}

function ModalEmpty({ icon, title, description }: { icon: string; title: string; description: string }) {
  return <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-50/80 py-12 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-background-100 text-foreground-400"><i className={`${icon} text-lg`}></i></span><p className="mt-3 text-xs font-semibold text-foreground-700">{title}</p><p className="mx-auto mt-1 max-w-sm text-[10px] leading-4 text-foreground-400">{description}</p></div>;
}

/* ═══════════════════════════════════════════════════════════
   Mini Donut Stat (Hero)
   ═══════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════
   Stat Card
   ═══════════════════════════════════════════════════════════ */
function StatCard({ label, value, sub, icon, color, active = false, onClick }: { label: string; value: string; sub: string; icon: string; color: string; active?: boolean; onClick: () => void }) {
  const colorMap: Record<string, { iconBg: string; iconText: string; accent: string; glow: string; border: string }> = {
    primary: { iconBg: 'bg-primary-100', iconText: 'text-primary-600', accent: 'text-primary-700', glow: 'from-primary-500/70 to-primary-300/50', border: 'border-primary-200/80' },
    accent: { iconBg: 'bg-accent-50', iconText: 'text-accent-700', accent: 'text-accent-700', glow: 'from-accent-500/70 to-accent-300/50', border: 'border-accent-200/80' },
    secondary: { iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', accent: 'text-secondary-700', glow: 'from-secondary-500/70 to-secondary-300/50', border: 'border-secondary-200/80' },
    red: { iconBg: 'bg-red-100', iconText: 'text-red-600', accent: 'text-red-700', glow: 'from-red-500/70 to-red-300/50', border: 'border-red-200/80' },
    amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-600', accent: 'text-amber-700', glow: 'from-amber-500/70 to-amber-300/50', border: 'border-amber-200/80' },
    emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', accent: 'text-emerald-700', glow: 'from-emerald-500/70 to-emerald-300/50', border: 'border-emerald-200/80' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${label}`}
      className={`group relative isolate w-full overflow-hidden rounded-2xl border bg-background-50/95 p-4 text-left card-premium cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-primary-200 md:p-5 ${active ? `${c.border} ring-1 ring-primary-100 shadow-[0_22px_45px_-34px_rgba(79,70,229,0.48)]` : 'border-foreground-200/60 hover:-translate-y-0.5 hover:border-foreground-300/70 hover:shadow-[0_22px_45px_-34px_rgba(15,23,42,0.24)]'}`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.glow}`}></span>
      <div className="mb-3 flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.iconBg} ${c.iconText}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">{label}</span>
        <i className="ri-arrow-right-up-line ml-auto text-[11px] text-foreground-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary-500"></i>
      </div>
      <p className={`text-2xl font-heading font-bold leading-tight ${c.accent}`}>{value}</p>
      <p className="mt-2 text-[11px] leading-5 text-foreground-400">{sub}</p>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   Learner Row
   ═══════════════════════════════════════════════════════════ */
type MetricTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

function toneFromPercent(value?: number | null, warningThreshold = 50, successThreshold = 75): MetricTone {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'neutral';
  if (value >= successThreshold) return 'success';
  if (value >= warningThreshold) return 'warning';
  return 'danger';
}

function CompactProgressRail({
  label,
  value,
  progress,
  tone = 'primary',
}: {
  label: string;
  value: string;
  progress?: number;
  tone?: MetricTone;
}) {
  const barClass = tone === 'danger'
    ? 'bg-amber-400'
    : tone === 'warning'
      ? 'bg-amber-500'
      : tone === 'success'
        ? 'bg-emerald-500'
        : tone === 'primary'
          ? 'bg-primary-500'
          : 'bg-foreground-400';
  const width = typeof progress === 'number' ? Math.max(0, Math.min(progress, 100)) : 0;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium text-foreground-500">{label}</p>
        <p className="text-[11px] font-semibold text-foreground-700">{value}</p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#eadfd9]">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }}></div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = 'primary',
  progress,
}: {
  label: string;
  value: string;
  icon: string;
  tone?: MetricTone;
  progress?: number;
  helper?: string;
}) {
  return <CompactProgressRail label={label} value={value} progress={progress} tone={tone} />;
}

function MiniScheduleTile({ label, value }: { label: string; value: string; status?: ScheduleStatus }) {
  return (
    <div className="rounded-2xl border border-foreground-200/60 bg-white px-3 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-foreground-500">{label}</p>
        <i className={`${label === 'PR' ? 'ri-calendar-event-line' : 'ri-user-voice-line'} text-[12px] text-foreground-400`}></i>
      </div>
      <p className="text-[11px] font-semibold text-foreground-700">{value}</p>
    </div>
  );
}

function learnerStageBadge(learner: CoachLearner): { label: string; className: string; avatarClass: string; arrowClass: string } {
  const otjhStatus = normalizeOtjhStatus(learner.otjhStatus);
  const programmeStatus = normalizedProgramStatus(learner);

  if (otjhStatus === 'at-risk') {
    return {
      label: 'At Risk',
      className: 'border-red-200 bg-red-50 text-red-700',
      avatarClass: 'bg-primary-50 text-primary-600',
      arrowClass: 'bg-primary-50 text-primary-400',
    };
  }
  if (otjhStatus === 'need-attention') {
    return {
      label: 'Need Attention',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      avatarClass: 'bg-amber-50 text-amber-600',
      arrowClass: 'bg-amber-50 text-amber-400',
    };
  }
  if (programmeStatus === 'gateway') {
    return {
      label: 'Gateway',
      className: 'border-violet-200 bg-violet-50 text-violet-700',
      avatarClass: 'bg-violet-50 text-violet-700',
      arrowClass: 'bg-violet-50 text-violet-400',
    };
  }
  if (programmeStatus === 'epa') {
    return {
      label: 'EPA',
      className: 'border-sky-200 bg-sky-50 text-sky-700',
      avatarClass: 'bg-sky-50 text-sky-700',
      arrowClass: 'bg-sky-50 text-sky-400',
    };
  }
  return {
    label: 'Apprentice',
    className: 'border-primary-100 bg-primary-50 text-primary-700',
    avatarClass: 'bg-primary-50 text-primary-600',
    arrowClass: 'bg-primary-50 text-primary-400',
  };
}

function LearnerRow({ learner }: { learner: CoachLearner }) {
  const badge = learnerStageBadge(learner);
  const otjhLabel = learner.otjhTarget > 0 ? `${learner.otjhCompleted}/${learner.otjhTarget} hrs` : EMPTY_VALUE;
  const ksbLabel = learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE;
  const otjhPercent = learner.otjhTarget > 0 ? clampPercent((learner.otjhCompleted / learner.otjhTarget) * 100) : 0;
  const ksbPercent = learner.ksbProgressAvailable ? clampPercent(learner.ksbProgress) : 0;
  const primaryRisk = learner.recentFlag || learner.riskFlags[0] || null;
  const additionalFlags = learner.riskFlags.filter(flag => flag !== primaryRisk).slice(0, 1);
  const programmeLine = learner.group !== EMPTY_VALUE ? learner.group : learner.programme;
  const otjhTone = toneFromPercent(otjhPercent, 45, 75);
  const ksbTone = toneFromPercent(learner.ksbProgressAvailable ? learner.ksbProgress : null, 45, 75);
  const sc = OTJH_STATUS_META[normalizeOtjhStatus(learner.otjhStatus)];
  const attendanceLabel = learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
  const progressLabel = learner.overallProgressAvailable ? `${learner.overallProgress}%` : EMPTY_VALUE;
  const evidenceLabel = learner.evidenceCountAvailable ? String(learner.evidenceCount) : EMPTY_VALUE;
  const attendanceTone = toneFromPercent(learner.attendanceRateAvailable ? learner.attendanceRate : null, 80, 90);
  const progressTone = toneFromPercent(learner.overallProgressAvailable ? learner.overallProgress : null, 40, 75);
  const evidenceTone: MetricTone = learner.evidenceCountAvailable && learner.evidenceCount > 0 ? 'primary' : 'neutral';
  const visibleFlags = additionalFlags;
  const remainingFlagCount = 0;
  const compactLayout = Boolean(learner.id);
  const learnerCaseFilePath = `/coach/learner-case-file?id=${encodeURIComponent(learner.id)}`;
  const learnerCaseFileState = { learnerId: learner.id, learnerName: learner.name };

  if (compactLayout) {
    return (
      <div className="rounded-2xl border border-foreground-200/70 bg-background-50 px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Link
              to={learnerCaseFilePath}
              state={learnerCaseFileState}
              aria-label={`Open ${learner.name} profile`}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold transition-transform hover:scale-[1.03] ${badge.avatarClass}`}
            >
              {learner.initials}
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[14px] font-semibold text-foreground-900">{learner.name}</p>
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
              <p className="mt-1 truncate text-[12px] text-foreground-400">{programmeLine}</p>
              {(primaryRisk || additionalFlags.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {primaryRisk && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskFlagClass(primaryRisk)}`}>
                      {primaryRisk}
                    </span>
                  )}
                  {additionalFlags.map(flag => (
                    <span key={flag} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskFlagClass(flag)}`}>
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <CompactProgressRail label="OTJH" value={otjhLabel} progress={otjhPercent} tone={otjhTone} />
            <CompactProgressRail label="KSB" value={ksbLabel} progress={ksbPercent} tone={ksbTone} />
          </div>

          <Link
            to={learnerCaseFilePath}
            state={learnerCaseFileState}
            aria-label={`Open ${learner.name} profile`}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all hover:scale-105 hover:shadow-sm ${badge.arrowClass}`}
          >
            <i className="ri-arrow-right-s-line text-lg"></i>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-foreground-200/70 bg-background-50 px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
      {/* Header row */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold ${badge.avatarClass}`}>
            {learner.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[14px] font-semibold text-foreground-900">{learner.name}</p>
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-foreground-400">{learner.programme} · {learner.group}</p>
          </div>
        </div>
      </div>

      {/* Risk flags */}
      {primaryRisk && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold ${riskFlagClass(primaryRisk)}`}>
            <i className="ri-error-warning-fill text-[10px]"></i>
            {primaryRisk}
          </span>
          {visibleFlags.map(flag => (
            <span key={flag} className="rounded-full border border-amber-100 bg-amber-50 px-2 py-1 text-[9px] font-medium text-amber-700">{flag}</span>
          ))}
          {remainingFlagCount > 0 && (
            <span className="rounded-full border border-foreground-200 bg-white px-2 py-1 text-[9px] font-medium text-foreground-500">+{remainingFlagCount} more</span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-foreground-100 pt-3 sm:grid-cols-3 xl:grid-cols-7">
        <MetricTile
          label="OTJH"
          value={otjhLabel}
          icon="ri-time-line"
          tone={otjhTone}
          progress={otjhPercent}
          helper={learner.otjhTarget > 0 ? `${otjhPercent}% of target` : 'No target'}
        />
        <MetricTile
          label="KSB"
          value={ksbLabel}
          icon="ri-book-open-line"
          tone={ksbTone}
          progress={learner.ksbProgressAvailable ? learner.ksbProgress : undefined}
        />
        <MetricTile
          label="Attendance"
          value={attendanceLabel}
          icon="ri-calendar-check-line"
          tone={attendanceTone}
          progress={learner.attendanceRateAvailable ? learner.attendanceRate : undefined}
        />
        <MetricTile
          label="OTJH Progress"
          value={progressLabel}
          icon="ri-line-chart-line"
          tone={progressTone}
          progress={learner.overallProgressAvailable ? learner.overallProgress : undefined}
        />
        <MiniScheduleTile label="MCM" value={learner.nextCoaching} status={learner.nextCoachingStatus} />
        <MiniScheduleTile label="PR" value={learner.nextReview} status={learner.nextReviewStatus} />
        <MetricTile
          label="Evidence"
          value={evidenceLabel}
          icon="ri-file-list-3-line"
          tone={evidenceTone}
          helper={learner.evidenceCountAvailable ? 'Awaiting coach review' : 'No evidence data'}
        />
      </div>
    </div>
  );
}
