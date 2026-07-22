import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { fetchCurriculumOverview, type CurriculumGroup, type CurriculumOverview, type CurriculumSession, type CurriculumStaffProfile } from '@/lib/curriculumApi';
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
const CASELOAD_PAGE_SIZE = 5;

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
    avatar: 'bg-red-100 text-red-700 ring-red-200',
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

function mergeAttendanceRates(learners: CoachLearner[], attendanceLearners: AttendanceApiLearner[]) {
  return learners.map((learner) => {
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

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === 'string' ? data.detail : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
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

function nextEventSummaryForLearner(events: CoachCalendarEvent[], learner: CoachLearner, source: string) {
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

function enrichLearnerSchedule(learners: CoachLearner[], events: CoachCalendarEvent[]) {
  return learners.map(learner => {
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
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-white/8' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = {
    primary: 'stroke-primary-400', accent: 'stroke-accent-400', secondary: 'stroke-secondary-400',
    emerald: 'stroke-emerald-400', amber: 'stroke-amber-400', red: 'stroke-red-400',
  };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || colorMap.primary} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

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
  const [viewMode, setViewMode] = useState<OtjhFilter>('all');
  const [caseloadPage, setCaseloadPage] = useState(1);
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpi | null>(null);
  const [selectedLearner, setSelectedLearner] = useState<CoachLearner | null>(null);
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
        fetch(CASELOAD_ENDPOINT, { signal: controller.signal }).then(response => readJson<CaseloadApiResponse>(response)),
        fetch(ATTENDANCE_ENDPOINT, { signal: controller.signal }).then(response => readJson<AttendanceApiResponse>(response)),
        fetchCoachCalendarEvents(controller.signal),
        fetch(ABSENCE_REPORTS_ENDPOINT, { signal: controller.signal }).then(response => readJson<AbsenceReportsResponse>(response)),
        fetchCurriculumOverview(controller.signal),
        fetch(EVIDENCE_AWAITING_REVIEW_ENDPOINT, { signal: controller.signal }).then(response => readJson<MarkingQueueResponse>(response)),
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

  const filteredLearners = viewMode === 'all'
    ? enrichedLearners
    : activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === viewMode);
  const caseloadPageCount = Math.max(1, Math.ceil(filteredLearners.length / CASELOAD_PAGE_SIZE));
  const paginatedLearners = filteredLearners.slice(
    (caseloadPage - 1) * CASELOAD_PAGE_SIZE,
    caseloadPage * CASELOAD_PAGE_SIZE,
  );

  useEffect(() => {
    if (caseloadPage > caseloadPageCount) setCaseloadPage(caseloadPageCount);
  }, [caseloadPage, caseloadPageCount]);

  const atRiskLearners = activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'at-risk');
  const needAttentionLearners = activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'need-attention');
  const onTrackLearners = activeLearners.filter(learner => normalizeOtjhStatus(learner.otjhStatus) === 'on-track');
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

  const openCaseloadFilter = (filter: OtjhFilter) => {
    setViewMode(filter);
    setCaseloadPage(1);
    window.requestAnimationFrame(() => {
      document.getElementById('learner-caseload')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const goToCaseloadPage = (page: number) => {
    setCaseloadPage(Math.min(Math.max(page, 1), caseloadPageCount));
    setSelectedLearner(null);
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
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════════════════════════════════════════════
            SECTION 1 — HERO BANNER
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={0}>
          <section className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
            <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
            <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
            {/* blobs */}
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
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
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
            <div className="bg-red-50/70 border border-red-200/50 rounded-xl p-3 md:p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <i className="ri-alert-fill text-red-600 text-base"></i>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">Risk Alert: {atRiskCount} learners need immediate attention</p>
                <p className="text-[12px] text-red-600 mt-0.5 truncate">
                  {riskSummary || EMPTY_VALUE}
                </p>
              </div>
            </div>
          </SectionReveal>
        )}

        {/* ═══════════════════════════════════════════════════
            MAIN CONTENT — 2 Columns
            ═══════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">

          {/* ─────── Left Column (2/3) ─────── */}
          <div className="lg:col-span-2 space-y-5 md:space-y-6">

            {/* Learner Caseload */}
            <SectionReveal delay={100}>
              <section id="learner-caseload" className="scroll-mt-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-heading font-semibold text-foreground-900">Learner Caseload</h2>
                    <p className="text-sm text-foreground-400 mt-0.5">All {totalCaseload} learners assigned to you — click to expand details</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link to="/coach/caseload" className="text-xs font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer">
                      <i className="ri-table-line mr-1"></i> Full Overview
                    </Link>
                    <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
                    {([
                      { key: 'all', label: 'All', count: totalCaseload },
                      { key: 'at-risk', label: OTJH_STATUS_META['at-risk'].cardLabel, count: atRiskCount },
                      { key: 'need-attention', label: OTJH_STATUS_META['need-attention'].cardLabel, count: needAttentionCount },
                      { key: 'on-track', label: OTJH_STATUS_META['on-track'].cardLabel, count: onTrackCount },
                    ] as { key: OtjhFilter; label: string; count: number }[]).map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => { setViewMode(tab.key); setCaseloadPage(1); setSelectedLearner(null); }}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                          viewMode === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
                        }`}
                      >
                        {tab.label} <span className="text-[10px] opacity-60">({tab.count})</span>
                      </button>
                    ))}
                  </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {paginatedLearners.map(learner => (
                    <LearnerRow
                      key={learner.id}
                      learner={learner}
                      isSelected={selectedLearner?.id === learner.id}
                      onSelect={() => setSelectedLearner(selectedLearner?.id === learner.id ? null : learner)}
                    />
                  ))}
                  {filteredLearners.length === 0 && (
                    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6 text-center text-[12px] text-foreground-400">
                      {loading ? 'Loading learners...' : 'No learners found.'}
                    </div>
                  )}
                </div>
                {filteredLearners.length > CASELOAD_PAGE_SIZE && (
                  <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-xl border border-foreground-200/60 bg-background-50 px-4 py-3 sm:flex-row">
                    <p className="text-[10px] text-foreground-400">
                      Showing {(caseloadPage - 1) * CASELOAD_PAGE_SIZE + 1}–{Math.min(caseloadPage * CASELOAD_PAGE_SIZE, filteredLearners.length)} of {filteredLearners.length} learners
                    </p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => goToCaseloadPage(caseloadPage - 1)} disabled={caseloadPage === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-foreground-200 text-foreground-500 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Previous page"><i className="ri-arrow-left-s-line"></i></button>
                      {Array.from({ length: caseloadPageCount }, (_, index) => index + 1).map(page => (
                        <button key={page} type="button" onClick={() => goToCaseloadPage(page)} className={`h-8 min-w-8 rounded-lg px-2 text-[10px] font-semibold transition-colors ${caseloadPage === page ? 'bg-primary-600 text-white' : 'border border-foreground-200 text-foreground-600 hover:bg-background-100'}`} aria-label={`Page ${page}`} aria-current={caseloadPage === page ? 'page' : undefined}>{page}</button>
                      ))}
                      <button type="button" onClick={() => goToCaseloadPage(caseloadPage + 1)} disabled={caseloadPage === caseloadPageCount} className="flex h-8 w-8 items-center justify-center rounded-lg border border-foreground-200 text-foreground-500 transition-colors hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Next page"><i className="ri-arrow-right-s-line"></i></button>
                    </div>
                  </div>
                )}
              </section>
            </SectionReveal>

            {/* Upcoming Live Sessions */}
            <SectionReveal delay={140}>
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-heading font-semibold text-foreground-900">Upcoming Live Sessions</h2>
                    <p className="mt-0.5 text-sm text-foreground-400">Live tutor-led sessions scheduled for your learners</p>
                  </div>
                  <Link to="/coach/timetable" className="whitespace-nowrap text-xs font-semibold text-primary-600 hover:text-primary-700">
                    <i className="ri-calendar-line mr-1"></i> Full Calendar
                  </Link>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {upcomingLiveSessionCards.map(event => {
                    const sessionDate = eventDisplayDate(event);
                    return (
                      <Link to="/coach/timetable" key={event.eventKey || event.id} className="group w-full rounded-xl border border-sky-100 bg-background-50 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-semibold text-sky-700"><i className="ri-live-line mr-1"></i>Live Session</span>
                          <span className="text-[9px] font-medium text-foreground-400">{formatDateLabel(sessionDate)}</span>
                        </div>
                        <p className="truncate text-[13px] font-semibold text-foreground-900">{displayValue(event.title)}</p>
                        <p className="mt-1 truncate text-[10px] text-foreground-400">{displayValue(event.programme)} · {displayValue(event.cohort)}{event.location ? ` · ${event.location}` : ''}</p>
                        <div className="mt-3 flex items-center justify-between border-t border-background-200/60 pt-3 text-[10px]">
                          <span className="text-foreground-500"><i className="ri-time-line mr-1 text-sky-500"></i>{formatTimeLabel(event)}</span>
                          <span className="text-foreground-400"><i className="ri-video-line mr-1 text-sky-500"></i>{displayValue(event.platform)}</span>
                        </div>
                      </Link>
                    );
                  })}
                  {!upcomingLiveSessionCards.length && (
                    <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-6 text-center text-[11px] text-foreground-400 sm:col-span-2 xl:col-span-3">No upcoming live sessions scheduled.</div>
                  )}
                </div>
              </section>
            </SectionReveal>

            {/* Evidence Queue */}
            <SectionReveal delay={180}>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-heading font-semibold text-foreground-900">Evidence Awaiting Review</h2>
                    <p className="text-sm text-foreground-400 mt-0.5">Learners with evidence waiting to be reviewed</p>
                  </div>
                  <Link to="/coach/marking-queue" className="text-xs font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer">
                    View All <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
                <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {evidenceLearners.map(learner => (
                    <Link
                      key={learner.id}
                      to={`/coach/learner-case-file?id=${encodeURIComponent(learner.learnerId)}&tab=evidence`}
                      state={{ learnerId: learner.learnerId, learnerName: learner.learner, tab: 'evidence' }}
                      className="flex items-center gap-3 rounded-xl border border-foreground-200/60 bg-background-50 p-3 transition-colors hover:border-secondary-200 hover:bg-secondary-50/30"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary-50 text-secondary-600"><i className="ri-file-list-3-line"></i></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-semibold text-foreground-900">{learner.learner}</p>
                        <p className="truncate text-[9px] text-foreground-400">{learner.programme} · {learner.group}</p>
                      </div>
                      <span className="text-right">
                        <span className="block text-[10px] font-bold text-secondary-700">{learner.pendingEvidence} / {learner.totalEvidence}</span>
                        <span className="block text-[7px] text-foreground-400">Pending / Total</span>
                        {learner.lastSubmission !== EMPTY_VALUE && <span className="block text-[7px] text-foreground-400">Last {learner.lastSubmission}</span>}
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
          <div className="space-y-5 md:space-y-5">

            {/* Coaching Calendar */}
            <SectionReveal delay={120}>
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3 md:mb-4">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Coaching Calendar</h3>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{visibleCalendarEvents.length} sessions</span>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {visibleCalendarEvents.length === 0 && (
                    <div className="p-6 text-center text-[12px] text-foreground-400">
                      {loading ? 'Loading calendar...' : 'No calendar events found.'}
                    </div>
                  )}
                  {visibleCalendarEvents.map(event => {
                    const classes = eventStatusClasses(event);
                    const displayDate = eventDisplayDate(event);
                    return (
                      <div key={event.eventKey || event.id} className={`flex items-start gap-3 p-2.5 rounded-lg transition-smooth cursor-pointer ${classes.row}`}>
                        <div className="text-center shrink-0 min-w-[42px]">
                          <p className={`text-[10px] font-semibold uppercase tracking-wider ${classes.date}`}>{formatCalendarMonth(displayDate)}</p>
                          <p className={`text-base font-bold ${isAtRiskEvent(event) ? 'text-red-700' : 'text-foreground-900'}`}>{formatCalendarDayNumber(displayDate)}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground-900">{displayValue(event.learner)}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="text-[10px] text-foreground-400">{formatTimeLabel(event)}</span>
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

            {/* Absence Reports */}
            <SectionReveal delay={160}>
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">
                    Absence Reports
                    <span className="ml-2 text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingAbsenceReports.length} pending</span>
                  </h3>
                  <Link to="/coach/absence-reports" className="text-[10px] font-semibold text-primary-600 hover:text-primary-700">View All <i className="ri-arrow-right-s-line"></i></Link>
                </div>
                <div className="space-y-2">
                  {pendingAbsenceReports.slice(0, 4).map(report => (
                    <Link key={report.id} to="/coach/absence-reports" className="flex items-center gap-3 rounded-lg bg-background-100/50 p-2.5 transition-colors hover:bg-background-100">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600"><i className="ri-emotion-sad-line text-sm"></i></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-foreground-900">{report.learner}</p>
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
  const filterForType: Partial<Record<DashboardKpi, OtjhFilter>> = { caseload: 'all', 'on-track': 'on-track', 'at-risk': 'at-risk', 'need-attention': 'need-attention' };
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="kpi-modal-title">
      <button type="button" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground-950/40 backdrop-blur-[2px]" aria-label="Close popup"></button>
      <div className="relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-foreground-100 px-5 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${current.iconStyle}`}><i className={`${current.icon} text-lg`}></i></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="kpi-modal-title" className="font-heading text-base font-bold text-foreground-900">{current.title}</h2>
                <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-bold text-foreground-600">{type === 'evidence' ? pendingEvidence : type === 'reviews' ? reviews.length : modalLearners.length}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-foreground-400">{current.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-400 transition-colors hover:bg-background-100 hover:text-foreground-700" aria-label="Close"><i className="ri-close-line text-lg"></i></button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-5">
          {(type === 'caseload' || type === 'active' || type === 'on-break' || type === 'on-track' || type === 'at-risk' || type === 'need-attention' || type === 'gateway' || type === 'epa') && (
            <div className="space-y-2">
              {modalLearners.map(learner => {
                const status = OTJH_STATUS_META[normalizeOtjhStatus(learner.otjhStatus)];
                const attendance = learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
                const otjh = learner.otjhTarget > 0 ? `${learner.otjhCompleted}/${learner.otjhTarget}` : EMPTY_VALUE;
                return (
                  <div key={learner.id} className="flex items-center gap-3 rounded-xl border border-foreground-100 bg-background-50 p-3 transition-colors hover:bg-background-100/60">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-2 ${status.avatar}`}><span className="text-[10px] font-bold">{learner.initials}</span></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[11px] font-semibold text-foreground-900">{learner.name}</p>
                        {type === 'active' || type === 'on-break' ? (
                          <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${isActiveLearner(learner) ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>{displayValue(learner.rawProgramStatus)}</span>
                        ) : type === 'gateway' || type === 'epa' ? (
                          <span className="rounded-full border border-secondary-100 bg-secondary-50 px-1.5 py-0.5 text-[8px] font-bold text-secondary-700">{type === 'gateway' ? 'Gateway' : 'EPA'}</span>
                        ) : (
                          <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${status.bg} ${status.text}`}>{status.label}</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[9px] text-foreground-400">{learner.programme} · {learner.group}</p>
                    </div>
                    <div className="hidden items-center gap-4 text-center sm:flex">
                      <div><p className="text-[10px] font-bold text-foreground-800">{otjh}</p><p className="text-[7px] text-foreground-400">OTJH</p></div>
                      <div><p className="text-[10px] font-bold text-foreground-800">{learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE}</p><p className="text-[7px] text-foreground-400">KSB</p></div>
                      <div><p className="text-[10px] font-bold text-foreground-800">{attendance}</p><p className="text-[7px] text-foreground-400">Attendance</p></div>
                    </div>
                  </div>
                );
              })}
              {!modalLearners.length && <ModalEmpty icon={current.icon} title="No learners in this status" description="This list will update automatically when learner data changes." />}
            </div>
          )}

          {type === 'evidence' && (
            <div className="space-y-2">
              {evidenceLearners.map(learner => (
                <Link
                  key={learner.id}
                  to={`/coach/learner-case-file?id=${encodeURIComponent(learner.learnerId)}&tab=evidence`}
                  state={{ learnerId: learner.learnerId, learnerName: learner.learner, tab: 'evidence' }}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl border border-foreground-100 bg-background-50 p-3 transition-colors hover:border-secondary-200 hover:bg-secondary-50/30"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary-50 text-[10px] font-bold text-secondary-700">{learner.initials}</span>
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

        <footer className="flex items-center justify-end gap-2 border-t border-foreground-100 bg-background-100/40 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-foreground-200 bg-background-50 px-3 py-2 text-[10px] font-semibold text-foreground-600 hover:bg-background-100">Close</button>
          {filterForType[type] && <button type="button" onClick={() => onFilter(filterForType[type]!)} className="rounded-lg bg-primary-600 px-3 py-2 text-[10px] font-semibold text-white hover:bg-primary-700">Show in dashboard</button>}
          {type === 'evidence' && <Link to="/coach/marking-queue" onClick={onClose} className="rounded-lg bg-primary-600 px-3 py-2 text-[10px] font-semibold text-white hover:bg-primary-700">Open marking queue</Link>}
          {type === 'reviews' && <Link to="/coach/progress-reviews" onClick={onClose} className="rounded-lg bg-primary-600 px-3 py-2 text-[10px] font-semibold text-white hover:bg-primary-700">Open reviews</Link>}
        </footer>
      </div>
    </div>
  );
}

function ModalEmpty({ icon, title, description }: { icon: string; title: string; description: string }) {
  return <div className="py-12 text-center"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-background-100 text-foreground-400"><i className={`${icon} text-lg`}></i></span><p className="mt-3 text-xs font-semibold text-foreground-700">{title}</p><p className="mx-auto mt-1 max-w-sm text-[10px] leading-4 text-foreground-400">{description}</p></div>;
}

function HeroStatPill({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    accent: 'bg-accent-400/15 text-accent-300 border-accent-400/20',
    primary: 'bg-primary-400/15 text-primary-300 border-primary-400/20',
    secondary: 'bg-secondary-400/15 text-secondary-300 border-secondary-400/20',
    emerald: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/20',
    red: 'bg-red-400/15 text-red-300 border-red-400/20',
    amber: 'bg-amber-400/15 text-amber-300 border-amber-400/20',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${colorMap[color] || colorMap.primary} backdrop-blur-sm`}>
      <i className={`${icon} text-xs opacity-70`}></i>
      <span className="text-[10px] font-bold">{value}</span>
      <span className="text-[10px] opacity-60 whitespace-nowrap">{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Mini Donut Stat (Hero)
   ═══════════════════════════════════════════════════════════ */
function MiniDonutStat({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <DonutRing pct={pct} size={44} stroke={4} color={color} trackClass="text-white/8" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white">{pct}%</span>
        </div>
      </div>
      <span className="text-[9px] text-white/40 font-medium">{label}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Stat Card
   ═══════════════════════════════════════════════════════════ */
function StatCard({ label, value, sub, icon, color, active = false, onClick }: { label: string; value: string; sub: string; icon: string; color: string; active?: boolean; onClick: () => void }) {
  const colorMap: Record<string, { iconBg: string; iconText: string; accent: string }> = {
    primary: { iconBg: 'bg-primary-100', iconText: 'text-primary-600', accent: 'text-primary-700' },
    accent: { iconBg: 'bg-accent-50', iconText: 'text-accent-700', accent: 'text-accent-700' },
    secondary: { iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', accent: 'text-secondary-700' },
    red: { iconBg: 'bg-red-100', iconText: 'text-red-600', accent: 'text-red-700' },
    amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-600', accent: 'text-amber-700' },
    emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', accent: 'text-emerald-700' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${label}`}
      className={`group w-full rounded-xl border bg-background-50 p-3 text-left card-premium cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-primary-200 md:p-4 ${active ? 'border-primary-300 ring-1 ring-primary-100' : 'border-foreground-200/60 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md'}`}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconBg} ${c.iconText}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        <span className="text-[10px] md:text-[11px] text-foreground-400 font-medium">{label}</span>
        <i className="ri-arrow-right-up-line ml-auto text-[11px] text-foreground-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary-500"></i>
      </div>
      <p className={`text-lg md:text-xl font-heading font-bold leading-tight ${c.accent}`}>{value}</p>
      <p className="text-[10px] md:text-[11px] text-foreground-400 mt-1">{sub}</p>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   Learner Row
   ═══════════════════════════════════════════════════════════ */
function ScheduleDateLine({ label, value, status = 'none' }: { label: string; value: string; status?: ScheduleStatus }) {
  const hasDate = displayValue(value) !== EMPTY_VALUE;
  const statusClass = status === 'overdue'
    ? 'border-red-100 bg-red-50 text-red-700'
    : status === 'needs-schedule'
      ? 'border-amber-100 bg-amber-50 text-amber-700'
    : status === 'upcoming'
      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
      : 'border-foreground-100 bg-background-50 text-foreground-400';
  const statusLabel = status === 'overdue' ? 'Overdue' : status === 'needs-schedule' ? 'Need Schedule' : 'Next';

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-background-200 bg-background-50 px-2.5 py-1.5">
      <span className="text-[10px] font-bold text-foreground-500">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[11px] font-semibold text-foreground-900">{hasDate ? value : EMPTY_VALUE}</span>
        {hasDate && status !== 'none' && (
          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${statusClass}`}>
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function LearnerRow({ learner, isSelected, onSelect }: { learner: CoachLearner; isSelected: boolean; onSelect: () => void }) {
  const sc = OTJH_STATUS_META[normalizeOtjhStatus(learner.otjhStatus)];
  const otjhLabel = learner.otjhTarget > 0 ? `${learner.otjhCompleted}/${learner.otjhTarget}` : EMPTY_VALUE;
  const ksbLabel = learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE;
  const attendanceLabel = learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
  const progressLabel = learner.overallProgressAvailable ? `${learner.overallProgress}%` : EMPTY_VALUE;
  const evidenceLabel = learner.evidenceCountAvailable ? String(learner.evidenceCount) : EMPTY_VALUE;
  const attendanceTone = learner.attendanceRateAvailable
    ? learner.attendanceRate >= 90 ? 'text-emerald-600' : learner.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'
    : 'text-foreground-900';

  return (
    <div
      className={`bg-background-50 rounded-xl border p-4 card-premium cursor-pointer transition-smooth ${isSelected ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${sc.avatar}`}>
          <span className="text-sm font-bold">{learner.initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground-900">{learner.name}</p>
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
            {learner.recentFlag && (
              <span className="text-[9px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">{learner.recentFlag}</span>
            )}
          </div>
          <p className="text-[11px] text-foreground-400 mt-0.5">{learner.programme} · {learner.group}</p>
        </div>
        <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
          <span>OTJH: {otjhLabel}</span>
          <span>KSB: {ksbLabel}</span>
          <span>Att: {attendanceLabel}</span>
        </div>
        <i className={`text-foreground-300 shrink-0 ${isSelected ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i>
      </div>

      {/* Risk flags */}
      {learner.riskFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3 ml-14">
          {learner.riskFlags.map(flag => (
            <span key={flag} className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">{flag}</span>
          ))}
        </div>
      )}

      {/* Expanded detail */}
      {isSelected && (
        <div className="mt-4 ml-14 grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-background-200/30">
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">OTJH Progress</p>
            <div className="w-full bg-background-200 rounded-full h-2 mb-1.5">
              <div className={`h-2 rounded-full transition-smooth ${sc.bar}`} style={{ width: `${learner.overallProgressAvailable ? learner.overallProgress : 0}%` }}></div>
            </div>
            <p className="text-lg font-bold text-foreground-900">{progressLabel}</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Attendance</p>
            <p className={`text-lg font-bold ${attendanceTone}`}>{attendanceLabel}</p>
            <p className="text-[10px] text-foreground-400">{learner.attendanceRateAvailable ? learner.attendanceRate >= 90 ? 'On target' : 'Below 90%' : EMPTY_VALUE}</p>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3">
            <p className="text-center text-[10px] text-foreground-400 mb-2">Coaching & Reviews</p>
            <div className="space-y-1.5">
              <ScheduleDateLine label="MCM" value={learner.nextCoaching} status={learner.nextCoachingStatus} />
              <ScheduleDateLine label="PR" value={learner.nextReview} status={learner.nextReviewStatus} />
            </div>
          </div>
          <div className="bg-background-100/50 rounded-lg p-3 text-center">
            <p className="text-[10px] text-foreground-400 mb-1">Evidence</p>
            <p className="text-lg font-bold text-foreground-900">{evidenceLabel}</p>
            <p className="text-[10px] text-foreground-400">items submitted</p>
          </div>
        </div>
      )}
    </div>
  );
}
