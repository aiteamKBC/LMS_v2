import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { roleNavMap } from '@/mocks/navigation';

type PerformanceStatus = 'at-risk' | 'on-track' | 'high' | 'new-starter';
type EnrollmentStatus = 'all' | 'active' | 'break' | 'withdrawn' | 'ready-to-enrol' | 'unknown';
type LearnerMetric = 'otjh' | 'ksb' | 'components';
type SummaryFilter =
  | 'all'
  | 'active'
  | 'withdrawn'
  | 'break'
  | 'ready-to-enrol'
  | 'on-track'
  | 'need-attention'
  | 'at-risk';

interface Learner {
  id: string;
  name: string;
  initials: string;
  employer: string;
  cohortId: string;
  cohortName: string;
  group: string;
  status: PerformanceStatus;
  enrollmentStatus: EnrollmentStatus;
  riskFlags: string[];
  overallProgress: number;
  overallProgressAvailable?: boolean;
  attendanceRate: number;
  attendanceRateAvailable?: boolean;
  liveAttendanceRate?: number | null;
  liveAttendanceRateAvailable?: boolean;
  attendanceSessions?: number | null;
  componentsCompleted?: number;
  componentsPlanned?: number;
  otjhCompleted: number;
  otjhTarget: number;
  otjhStatus?: string;
  ksbCompleted?: number;
  ksbTarget?: number;
  ksbStatus?: string;
  ksbProgress: number;
  ksbProgressAvailable?: boolean;
  evidenceCount: number;
  evidenceCountAvailable?: boolean;
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
  email?: string;
  employerEmail?: string;
  employerPhone?: string;
}

interface CaseloadApiLearner {
  id: string;
  name: string;
  initials: string;
  employer: string;
  cohortId: string;
  cohortName: string;
  group: string;
  status: PerformanceStatus;
  enrollmentStatus: Exclude<EnrollmentStatus, 'all'>;
  riskFlags: string[];
  overallProgress: number;
  overallProgressAvailable?: boolean;
  attendanceRate: number;
  attendanceRateAvailable?: boolean;
  componentsCompleted?: number;
  componentsPlanned?: number;
  otjhCompleted: number;
  otjhTarget: number;
  otjhStatus?: string;
  ksbCompleted?: number;
  ksbTarget?: number;
  ksbStatus?: string;
  ksbProgress: number;
  ksbProgressAvailable?: boolean;
  evidenceCount: number;
  evidenceCountAvailable?: boolean;
  nextCoaching: string;
  nextReview: string;
  lastContact: string;
  lastAttendanceDate: string;
  lastProgressReview: string;
  lastReview: string;
  lastCoachingSession: string;
  lastSubmittedEvidence: string;
  recentFlag: string | null;
  progressVariance?: string;
  startDate?: string;
  gatewayReviewDate?: string;
  plannedEndDate?: string;
  coachName?: string;
  coachEmail?: string;
  rawProgramStatus?: string;
  coachRag?: string;
  email?: string | null;
  employerEmail?: string | null;
  employerPhone?: string | null;
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
  sessions: number | null;
  hasAttendance: boolean;
}

interface AttendanceApiResponse {
  learners?: AttendanceApiLearner[];
}

const coachNav = roleNavMap.coach;
const PAGE_SIZE = 8;
const DEFAULT_COACH_NAME = 'Med Maher';
const DEFAULT_COACH_EMAIL = 'Med.Maher@kentbusinesscollege.com';
const EMPTY_VALUE = '--';
const API_ENDPOINT = '/coach_api/coach/caseload';
const ATTENDANCE_ENDPOINT = '/coach_api/coach/attendance';
const COACH_RAG_ENDPOINT = (learnerId: string) => `/coach_api/coach/caseload/${learnerId}/coach-rag`;
const COACH_RAG_OPTIONS = [
  { value: '', label: EMPTY_VALUE },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'red', label: 'Red' },
];

function displayValue(value?: string | null): string {
  if (!value) return EMPTY_VALUE;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'â€”' || trimmed === '—') return EMPTY_VALUE;
  return trimmed;
}

function formatCoachRagValue(value?: string | null): string {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'green') return 'Green';
  if (normalized === 'amber') return 'Amber';
  if (normalized === 'red') return 'Red';
  return EMPTY_VALUE;
}

function getCoachRagOptionValue(value?: string | null): string {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'green' || normalized === 'amber' || normalized === 'red' ? normalized : '';
}

function getCoachRagDotClass(value?: string | null): string {
  const normalized = displayValue(value).toLowerCase();
  if (normalized === 'green') return 'bg-emerald-500';
  if (normalized === 'amber') return 'bg-amber-500';
  if (normalized === 'red') return 'bg-red-500';
  return 'bg-foreground-300';
}

function normalizeIdentity(value?: string | number | null): string {
  if (value === null || value === undefined) {
    return '';
  }

  return displayValue(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function clampPercent(value?: number | string | null): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function findAttendanceRecord(learner: CaseloadApiLearner, attendanceLearners: AttendanceApiLearner[]) {
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
      || (learnerName && attendanceName && learnerName === attendanceName)
    );
  }) || null;
}

function normalizeLearner(learner: CaseloadApiLearner, attendance?: AttendanceApiLearner | null): Learner {
  const startDate = displayValue(learner.startDate || learner.lastAttendanceDate);
  const gatewayReviewDate = displayValue(
    learner.gatewayReviewDate || learner.lastProgressReview || learner.lastReview || learner.nextReview,
  );
  const plannedEndDate = displayValue(
    learner.plannedEndDate || learner.nextCoaching || learner.lastCoachingSession,
  );
  const hasAttendance = Boolean(
    attendance
    && attendance.attendance !== null
    && attendance.attendance !== undefined
    && attendance.hasAttendance !== false
  );

  return {
    ...learner,
    nextCoaching: displayValue(learner.nextCoaching),
    nextReview: displayValue(learner.nextReview),
    lastContact: displayValue(learner.lastContact),
    lastAttendanceDate: startDate,
    liveAttendanceRate: hasAttendance ? clampPercent(attendance?.attendance) : null,
    liveAttendanceRateAvailable: hasAttendance,
    attendanceSessions: hasAttendance && typeof attendance?.sessions === 'number' ? attendance.sessions : null,
    lastProgressReview: gatewayReviewDate,
    lastReview: gatewayReviewDate,
    lastCoachingSession: plannedEndDate,
    lastSubmittedEvidence: displayValue(learner.lastSubmittedEvidence),
    progressVariance: displayValue(learner.progressVariance),
    startDate,
    gatewayReviewDate,
    plannedEndDate,
    coachName: displayValue(learner.coachName),
    coachEmail: displayValue(learner.coachEmail),
    rawProgramStatus: displayValue(learner.rawProgramStatus),
    coachRag: formatCoachRagValue(learner.coachRag),
    otjhStatus: displayValue(learner.otjhStatus),
    ksbStatus: displayValue(learner.ksbStatus),
    email: learner.email || undefined,
    employerEmail: learner.employerEmail || undefined,
    employerPhone: learner.employerPhone || undefined,
  };
}

function parseVariance(value: string): number {
  const match = value.match(/-?\d+/);
  return match ? Number(match[0]) : 0;
}

function hasActiveTextSelection(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(window.getSelection()?.toString().trim());
}

function getProgramStatusStyle(value?: string) {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'withdrawn') {
    return { bg: 'bg-foreground-100 border-foreground-200/50', text: 'text-foreground-500' };
  }
  if (normalized === 'break' || normalized === 'onbreak' || normalized === 'onabreak') {
    return { bg: 'bg-amber-50 border-amber-200/50', text: 'text-amber-700' };
  }
  if (normalized === 'readytoenrol') {
    return { bg: 'bg-primary-50 border-primary-200/50', text: 'text-primary-700' };
  }
  if (normalized === 'active') {
    return { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700' };
  }
  return { bg: 'bg-background-100 border-foreground-200/50', text: 'text-foreground-600' };
}

function getProgramStatusKey(value?: string) {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'active') return 'active';
  if (normalized === 'withdrawn') return 'withdrawn';
  if (normalized === 'break' || normalized === 'onbreak' || normalized === 'onabreak') return 'break';
  if (normalized === 'readytoenrol') return 'ready-to-enrol';
  return 'other';
}

function getCoachRagStyle(value?: string) {
  const normalized = displayValue(value).toLowerCase();
  if (normalized === 'red') {
    return { bg: 'bg-red-50 border-red-200/50', text: 'text-red-700' };
  }
  if (normalized === 'amber') {
    return { bg: 'bg-amber-50 border-amber-200/50', text: 'text-amber-700' };
  }
  if (normalized === 'green') {
    return { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700' };
  }
  return { bg: 'bg-background-100 border-foreground-200/50', text: 'text-foreground-600' };
}

function getOtjhStatusKey(value?: string) {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'ontrack') return 'on-track';
  if (normalized === 'needattention') return 'need-attention';
  if (normalized === 'atrisk') return 'at-risk';
  return 'other';
}

function getOtjhStatusRank(value?: string) {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'needattention') return 0;
  if (normalized === 'ontrack') return 1;
  return 2;
}

function getOtjhStatusMeta(value?: string) {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'ontrack') {
    return { dot: 'bg-emerald-500', text: 'text-emerald-700' };
  }
  if (normalized === 'needattention') {
    return { dot: 'bg-amber-500', text: 'text-amber-700' };
  }
  if (normalized === 'atrisk') {
    return { dot: 'bg-red-500', text: 'text-red-700' };
  }
  return { dot: 'bg-foreground-300', text: 'text-foreground-500' };
}

function getOtjhSortValue(status?: string, variance?: string) {
  return (getOtjhStatusRank(status) * 1000) + parseVariance(variance || '0%');
}

function getKsbStatusMeta(value?: string) {
  const normalized = displayValue(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === 'completed') {
    return { dot: 'bg-emerald-500', text: 'text-emerald-700' };
  }
  if (normalized === 'inprogress') {
    return { dot: 'bg-amber-500', text: 'text-amber-700' };
  }
  if (normalized === 'notstarted') {
    return { dot: 'bg-foreground-300', text: 'text-foreground-500' };
  }
  return { dot: 'bg-foreground-300', text: 'text-foreground-500' };
}

function formatRatio(completed?: number, target?: number) {
  const safeCompleted = typeof completed === 'number' ? completed : null;
  const safeTarget = typeof target === 'number' ? target : null;
  if (safeCompleted === null || safeTarget === null || safeTarget <= 0) {
    return EMPTY_VALUE;
  }
  return `${safeCompleted}/${safeTarget}`;
}

function formatPercentValue(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return EMPTY_VALUE;
  }
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)}%`;
}

function formatComponentsValue(learner: Learner) {
  if (
    typeof learner.componentsCompleted === 'number'
    && typeof learner.componentsPlanned === 'number'
    && learner.componentsPlanned > 0
  ) {
    return `${learner.componentsCompleted}/${learner.componentsPlanned}`;
  }

  return learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE;
}

function formatComponentsHint(learner: Learner) {
  return learner.attendanceRateAvailable ? `${learner.attendanceRate}% complete` : null;
}

function formatHoursValue(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
}

function getComponentsTooltip(learner: Learner) {
  if (!learner.attendanceRateAvailable || typeof learner.componentsCompleted !== 'number' || typeof learner.componentsPlanned !== 'number' || learner.componentsPlanned <= 0) {
    return 'Components progress is not available.';
  }
  return `Components = completed components / planned components. ${learner.componentsCompleted}/${learner.componentsPlanned} = ${learner.attendanceRate}%`;
}

function getProgressTooltip(learner: Learner) {
  if (!learner.overallProgressAvailable) {
    return 'Progress is not available.';
  }
  return `Progress = completed OTJH hours / target hours. ${formatHoursValue(learner.otjhCompleted)}/${formatHoursValue(learner.otjhTarget)}h = ${learner.overallProgress}%`;
}

function sortCoachRagOptions(values: string[]) {
  const priority: Record<string, number> = {
    Red: 0,
    Amber: 1,
    Green: 2,
    '--': 3,
  };
  return [...values].sort((a, b) => {
    const priorityDiff = (priority[a] ?? 99) - (priority[b] ?? 99);
    return priorityDiff !== 0 ? priorityDiff : a.localeCompare(b);
  });
}

function DonutChart({ percentage, size = 72, strokeWidth = 6, color = 'primary', label }: { percentage: number; size?: number; strokeWidth?: number; color?: string; label?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const colorMap: Record<string, { stroke: string; bg: string; text: string }> = {
    primary: { stroke: 'stroke-primary-500', bg: 'bg-primary-50', text: 'text-primary-700' },
    accent: { stroke: 'stroke-accent-500', bg: 'bg-accent-50', text: 'text-accent-700' },
    emerald: { stroke: 'stroke-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    amber: { stroke: 'stroke-amber-500', bg: 'bg-amber-50', text: 'text-amber-700' },
    red: { stroke: 'stroke-red-500', bg: 'bg-red-50', text: 'text-red-700' },
    secondary: { stroke: 'stroke-secondary-500', bg: 'bg-secondary-50', text: 'text-secondary-700' },
  };

  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="transform -rotate-90" width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-background-200"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={`${c.stroke} transition-all duration-700`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-sm font-bold ${c.text}`}>{percentage}%</span>
        </div>
      </div>
      {label && <span className="text-[10px] font-medium text-foreground-400">{label}</span>}
    </div>
  );
}

async function fetchAttendanceLearners(signal: AbortSignal, ownerEmail: string) {
  const endpoints = [
    `${ATTENDANCE_ENDPOINT}?owner_email=${encodeURIComponent(ownerEmail)}`,
    ATTENDANCE_ENDPOINT,
  ];

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { signal });
    if (!response.ok) {
      continue;
    }

    const data: AttendanceApiResponse = await response.json();
    const learners = data.learners || [];
    if (learners.length > 0 || endpoint === ATTENDANCE_ENDPOINT) {
      return learners;
    }
  }

  return [];
}

export default function CoachCaseload() {
  const navigate = useNavigate();
  const [ownerName, setOwnerName] = useState(DEFAULT_COACH_NAME);
  const [ownerEmail, setOwnerEmail] = useState(DEFAULT_COACH_EMAIL);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [programStatusFilter, setProgramStatusFilter] = useState('all');
  const [coachRagFilter, setCoachRagFilter] = useState('all');
  const [employerFilter, setEmployerFilter] = useState('all');
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>('all');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [selectedMetricDetail, setSelectedMetricDetail] = useState<{ learner: Learner; metric: LearnerMetric } | null>(null);
  const [sortKey, setSortKey] = useState<'name' | 'progress' | 'attendance' | 'components' | 'ksb' | 'otjh'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [showProgressReport, setShowProgressReport] = useState(false);
  const [isTableDragging, setIsTableDragging] = useState(false);
  const [savingCoachRagId, setSavingCoachRagId] = useState<string | null>(null);
  const [openCoachRagId, setOpenCoachRagId] = useState<string | null>(null);
  const [coachRagSaveError, setCoachRagSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedLearnerIds, setSelectedLearnerIds] = useState<Set<string>>(() => new Set());
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const tableDragStateRef = useRef({
    isPointerDown: false,
    isDragging: false,
    pointerId: null as number | null,
    startX: 0,
    scrollLeft: 0,
  });
  const suppressRowClickRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCaseload() {
      setLoading(true);
      setError(null);

      try {
        const caseloadResponse = await fetch(API_ENDPOINT, { signal: controller.signal });

        if (!caseloadResponse.ok) {
          throw new Error(`Request failed with status ${caseloadResponse.status}`);
        }

        const data: CaseloadApiResponse = await caseloadResponse.json();
        const resolvedOwnerName = data.owner?.name || DEFAULT_COACH_NAME;
        const resolvedOwnerEmail = data.owner?.email || DEFAULT_COACH_EMAIL;
        const attendanceLearners = await fetchAttendanceLearners(controller.signal, resolvedOwnerEmail);

        setOwnerName(resolvedOwnerName);
        setOwnerEmail(resolvedOwnerEmail);
        setLearners((data.learners || []).map((learner) => (
          normalizeLearner(learner, findAttendanceRecord(learner, attendanceLearners))
        )));
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        console.error('Unable to load coach caseload', err);
        setError('Unable to load live learner data right now.');
        setLearners([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadCaseload();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [exportMenuOpen]);

  const cohortOptions = useMemo(
    () =>
      Array.from(new Map(learners.map(learner => [learner.cohortId, learner.cohortName])).entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [learners],
  );

  const groupOptions = useMemo(
    () =>
      [...new Set(learners.map(learner => learner.group))]
        .sort((a, b) => a.localeCompare(b))
        .map(group => ({ value: group, label: group })),
    [learners],
  );

  const programStatusOptions = useMemo(
    () =>
      [...new Set(learners.map(learner => displayValue(learner.rawProgramStatus)))]
        .sort((a, b) => a.localeCompare(b))
        .map(status => ({ value: status, label: status })),
    [learners],
  );

  const coachRagOptions = useMemo(
    () =>
      sortCoachRagOptions([...new Set(learners.map(learner => displayValue(learner.coachRag)))])
        .map(status => ({ value: status, label: status })),
    [learners],
  );

  const employerOptions = useMemo(
    () => [...new Set(learners.map((learner) => displayValue(learner.employer)))]
      .sort((left, right) => left.localeCompare(right))
      .map((employer) => ({ value: employer, label: employer })),
    [learners],
  );

  const summaryCounts = useMemo(
    () => ({
      total: learners.length,
      active: learners.filter(learner => getProgramStatusKey(learner.rawProgramStatus) === 'active').length,
      withdrawn: learners.filter(learner => getProgramStatusKey(learner.rawProgramStatus) === 'withdrawn').length,
      break: learners.filter(learner => getProgramStatusKey(learner.rawProgramStatus) === 'break').length,
      readyToEnrol: learners.filter(learner => getProgramStatusKey(learner.rawProgramStatus) === 'ready-to-enrol').length,
      onTrack: learners.filter(learner => getOtjhStatusKey(learner.otjhStatus) === 'on-track').length,
      needAttention: learners.filter(learner => getOtjhStatusKey(learner.otjhStatus) === 'need-attention').length,
      atRisk: learners.filter(learner => getOtjhStatusKey(learner.otjhStatus) === 'at-risk').length,
    }),
    [learners],
  );

  const applySummaryFilter = useCallback((list: Learner[]) => {
    switch (summaryFilter) {
      case 'active':
      case 'withdrawn':
      case 'break':
      case 'ready-to-enrol':
        return list.filter(learner => getProgramStatusKey(learner.rawProgramStatus) === summaryFilter);
      case 'on-track':
      case 'need-attention':
      case 'at-risk':
        return list.filter(learner => getOtjhStatusKey(learner.otjhStatus) === summaryFilter);
      default:
        return list;
    }
  }, [summaryFilter]);

  const filtered = useMemo(() => {
    let list = [...learners];
    list = applySummaryFilter(list);
    if (programStatusFilter !== 'all') list = list.filter(l => displayValue(l.rawProgramStatus) === programStatusFilter);
    if (coachRagFilter !== 'all') list = list.filter(l => displayValue(l.coachRag) === coachRagFilter);
    if (employerFilter !== 'all') list = list.filter(l => displayValue(l.employer) === employerFilter);
    if (cohortFilter !== 'all') list = list.filter(l => l.cohortId === cohortFilter);
    if (groupFilter !== 'all') list = list.filter(l => l.group === groupFilter);
    if (search) {
      const normalizedSearch = search.toLowerCase();
      list = list.filter(l =>
        l.name.toLowerCase().includes(normalizedSearch)
        || l.cohortName.toLowerCase().includes(normalizedSearch)
        || l.group.toLowerCase().includes(normalizedSearch)
        || l.employer.toLowerCase().includes(normalizedSearch)
      );
    }
    list.sort((a, b) => {
      let va: number | string = 0, vb: number | string = 0;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'progress': va = a.overallProgress; vb = b.overallProgress; break;
        case 'attendance': va = a.liveAttendanceRate ?? -1; vb = b.liveAttendanceRate ?? -1; break;
        case 'components': va = a.attendanceRate; vb = b.attendanceRate; break;
        case 'ksb': va = a.ksbProgress; vb = b.ksbProgress; break;
        case 'otjh': va = getOtjhSortValue(a.otjhStatus, a.progressVariance); vb = getOtjhSortValue(b.otjhStatus, b.progressVariance); break;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return list;
  }, [learners, applySummaryFilter, programStatusFilter, coachRagFilter, employerFilter, cohortFilter, groupFilter, search, sortKey, sortDir]);

  const filteredLearnerIds = useMemo(
    () => filtered.map((learner) => learner.id),
    [filtered],
  );

  useEffect(() => {
    const filteredIdSet = new Set(filteredLearnerIds);
    setSelectedLearnerIds((current) => {
      const next = new Set([...current].filter((id) => filteredIdSet.has(id)));
      if (next.size !== current.size) {
        return next;
      }

      for (const id of current) {
        if (!next.has(id)) {
          return next;
        }
      }

      return current;
    });
  }, [filteredLearnerIds]);

  const selectedLearners = useMemo(
    () => filtered.filter((learner) => selectedLearnerIds.has(learner.id)),
    [filtered, selectedLearnerIds],
  );

  const selectedCount = selectedLearners.length;

  const handleExportPdf = useCallback((scope: 'selected' | 'filtered') => {
    setExportMenuOpen(false);
    setIsExportingPdf(true);

    window.setTimeout(() => {
      try {
        downloadLearnersPdf(scope === 'selected' ? selectedLearners : filtered, ownerName);
      } finally {
        setIsExportingPdf(false);
      }
    }, 0);
  }, [filtered, ownerName, selectedLearners]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const selectedPageCount = useMemo(
    () => paginated.filter((learner) => selectedLearnerIds.has(learner.id)).length,
    [paginated, selectedLearnerIds],
  );

  const allPageSelected = paginated.length > 0 && selectedPageCount === paginated.length;
  const allFilteredSelected = filtered.length > 0 && selectedCount === filtered.length;

  const selectedLearner = learners.find(learner => learner.id === selectedLearnerId) || null;

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); } else { setSortKey(key); setSortDir('asc'); }
  };

  const handleSummaryCardClick = (filter: SummaryFilter) => {
    setSummaryFilter(current => current === filter ? 'all' : filter);
    setCurrentPage(1);
  };

  const toggleLearnerSelection = useCallback((learnerId: string) => {
    setSelectedLearnerIds((current) => {
      const next = new Set(current);
      if (next.has(learnerId)) next.delete(learnerId);
      else next.add(learnerId);
      return next;
    });
  }, []);

  const handleTogglePageSelection = useCallback(() => {
    setSelectedLearnerIds((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        paginated.forEach((learner) => next.delete(learner.id));
      } else {
        paginated.forEach((learner) => next.add(learner.id));
      }
      return next;
    });
  }, [allPageSelected, paginated]);

  const handleSelectAllFiltered = useCallback(() => {
    setSelectedLearnerIds(new Set(filtered.map((learner) => learner.id)));
  }, [filtered]);

  const handleClearSelection = useCallback(() => {
    setSelectedLearnerIds(new Set());
  }, []);

  const setLearnerCoachRag = (learnerId: string, coachRag: string | null | undefined) => {
    setLearners(current =>
      current.map(learner => (
        learner.id === learnerId
          ? { ...learner, coachRag: formatCoachRagValue(coachRag) }
          : learner
      )),
    );
  };

  const handleCoachRagChange = async (learnerId: string, nextValue: string) => {
    const previousValue = learners.find(learner => learner.id === learnerId)?.coachRag || EMPTY_VALUE;
    setCoachRagSaveError(null);
    setSavingCoachRagId(learnerId);
    setLearnerCoachRag(learnerId, nextValue);

    try {
      const response = await fetch(COACH_RAG_ENDPOINT(learnerId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachRag: nextValue || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || `Request failed with status ${response.status}`);
      }
      setLearnerCoachRag(learnerId, payload.coachRag);
    } catch (err) {
      console.error('Unable to save coach RAG', err);
      setLearnerCoachRag(learnerId, previousValue);
      setCoachRagSaveError('Unable to save Coach RAG right now.');
    } finally {
      setSavingCoachRagId(current => (current === learnerId ? null : current));
    }
  };

  const endTableDrag = () => {
    const dragState = tableDragStateRef.current;
    const wasDragging = dragState.isDragging;
    dragState.isPointerDown = false;
    dragState.isDragging = false;
    dragState.pointerId = null;
    setIsTableDragging(false);

    if (wasDragging) {
      suppressRowClickRef.current = true;
      window.setTimeout(() => {
        suppressRowClickRef.current = false;
      }, 0);
    }
  };

  const handleTablePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = tableScrollRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, label')) {
      return;
    }
    if (target.closest('[data-allow-selection="true"]')) {
      return;
    }

    tableDragStateRef.current = {
      isPointerDown: true,
      isDragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: container.scrollLeft,
    };

    container.setPointerCapture(event.pointerId);
  };

  const handleTablePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = tableScrollRef.current;
    const dragState = tableDragStateRef.current;
    if (!container || !dragState.isPointerDown) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    if (!dragState.isDragging && Math.abs(deltaX) > 6) {
      dragState.isDragging = true;
      setIsTableDragging(true);
    }

    if (dragState.isDragging) {
      container.scrollLeft = dragState.scrollLeft - deltaX;
      event.preventDefault();
    }
  };

  const handleTablePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = tableScrollRef.current;
    if (container && tableDragStateRef.current.pointerId !== null) {
      container.releasePointerCapture(event.pointerId);
    }
    endTableDrag();
  };

  const handleRowSelection = (learnerId: string, isSelected: boolean) => {
    if (suppressRowClickRef.current) {
      return;
    }
    if (hasActiveTextSelection()) {
      return;
    }
    setSelectedLearnerId(isSelected ? null : learnerId);
  };

  const handleMetricDetailClick = (event: React.MouseEvent, learner: Learner, metric: LearnerMetric) => {
    event.stopPropagation();
    setSelectedLearnerId(null);
    setSelectedMetricDetail({ learner, metric });
  };

  const handleOpenMetricCaseFile = () => {
    if (!selectedMetricDetail) {
      return;
    }
    const tab = selectedMetricDetail.metric === 'ksb' ? 'ksbs' : selectedMetricDetail.metric === 'otjh' ? 'otjh' : 'activity';
    navigate('/coach/learner-case-file', {
      state: {
        learnerId: selectedMetricDetail.learner.id,
        learnerName: selectedMetricDetail.learner.name,
        tab,
      },
    });
  };

  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    'on-track': { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', label: 'On Track' },
    'at-risk': { bg: 'bg-red-50 border-red-200/50', text: 'text-red-700', label: 'At Risk' },
    'high': { bg: 'bg-accent-50 border-accent-200/50', text: 'text-accent-700', label: 'High Performer' },
    'new-starter': { bg: 'bg-primary-50 border-primary-200/50', text: 'text-primary-700', label: 'New Starter' },
  };

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="My Learners"
      pageSubtitle="Monitor progress and open complete learner profiles"
      userName={ownerName}
      userRole="Progress Coach"
    >
      <main className="min-h-screen bg-[#f7f6fb] p-3 md:p-5">
        <div className="w-full space-y-3">
          <section
            className="rounded-2xl border border-white/10 px-6 py-6 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)]"
            style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
          >
            <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="mb-2.5 flex items-center gap-2 text-[11px] text-white/55">
                  <span>Coach Workspace</span>
                  <i className="ri-arrow-right-s-line"></i>
                  <span className="font-semibold text-white">My Learners</span>
                </div>
                <h1 className="text-3xl font-heading font-bold tracking-[-0.03em] text-white">My Learners</h1>
                <p className="mt-1.5 max-w-xl text-[13px] leading-5 text-white/70">
                  Monitor learner progress, identify who needs support, and access complete learner profiles.
                </p>
              </div>

              <div className="flex flex-wrap items-stretch gap-2 xl:flex-nowrap">
                <HeaderMetric icon="ri-group-line" label="Total Learners" value={summaryCounts.total} tone="primary" />
                <HeaderMetric icon="ri-user-follow-line" label="Active" value={summaryCounts.active} tone="emerald" />
                <HeaderMetric icon="ri-error-warning-line" label="Need Attention" value={summaryCounts.needAttention} tone="amber" />
                <HeaderMetric icon="ri-alarm-warning-line" label="At Risk" value={summaryCounts.atRisk} tone="red" />
                <div ref={exportMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setExportMenuOpen((current) => !current)}
                    className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-xl bg-white px-4 text-[11px] font-bold text-primary-800 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition hover:bg-primary-50"
                  >
                    <i className={`${isExportingPdf ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'}`}></i>
                    {selectedCount > 0 ? `Export Selected (${selectedCount})` : 'Export Learners'}
                    <i className={`ri-arrow-down-s-line transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`}></i>
                  </button>

                  {exportMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[230px] rounded-2xl border border-foreground-200/70 bg-white p-1.5 shadow-[0_18px_45px_rgba(28,12,58,0.16)]">
                      <div className="border-b border-foreground-100 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Export Options</p>
                        <p className="mt-1 text-[11px] text-foreground-500">
                          {selectedCount > 0 ? `${selectedCount} selected learners` : `${filtered.length} learners in current view`}
                        </p>
                      </div>
                      <div className="pt-1">
                        {selectedCount > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleExportPdf('selected')}
                              disabled={isExportingPdf}
                              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[11px] font-medium text-foreground-700 transition hover:bg-background-100 hover:text-foreground-900 disabled:cursor-wait disabled:opacity-60"
                            >
                              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
                                <i className={`${isExportingPdf ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-2-line'} text-sm`}></i>
                              </span>
                              <span className="flex-1">
                                <span className="block font-semibold">Selected PDF</span>
                                <span className="block text-[10px] text-foreground-400">Only selected learners</span>
                              </span>
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleExportPdf('filtered')}
                          disabled={isExportingPdf}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[11px] font-medium text-foreground-700 transition hover:bg-background-100 hover:text-foreground-900 disabled:cursor-wait disabled:opacity-60"
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
                            <i className={`${isExportingPdf ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-2-line'} text-sm`}></i>
                          </span>
                          <span className="flex-1">
                            <span className="block font-semibold">Current View PDF</span>
                            <span className="block text-[10px] text-foreground-400">All filtered learners</span>
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="flex gap-2 overflow-x-auto rounded-2xl border border-foreground-200/55 bg-white p-3 shadow-sm scrollbar-hide">
            <CaseloadStatusTab label="All Learners" count={summaryCounts.total} active={summaryFilter === 'all'} onClick={() => handleSummaryCardClick('all')} />
            <CaseloadStatusTab label="Active" count={summaryCounts.active} active={summaryFilter === 'active'} onClick={() => handleSummaryCardClick('active')} />
            <CaseloadStatusTab label="On Track" count={summaryCounts.onTrack} active={summaryFilter === 'on-track'} onClick={() => handleSummaryCardClick('on-track')} />
            <CaseloadStatusTab label="Need Attention" count={summaryCounts.needAttention} active={summaryFilter === 'need-attention'} onClick={() => handleSummaryCardClick('need-attention')} />
            <CaseloadStatusTab label="At Risk" count={summaryCounts.atRisk} active={summaryFilter === 'at-risk'} onClick={() => handleSummaryCardClick('at-risk')} />
            <CaseloadStatusTab label="On Break" count={summaryCounts.break} active={summaryFilter === 'break'} onClick={() => handleSummaryCardClick('break')} />
            <CaseloadStatusTab label="Completed" count={learners.filter((learner) => displayValue(learner.rawProgramStatus).toLowerCase() === 'completed').length} active={false} onClick={() => undefined} />
          </section>

          <section className="rounded-2xl border border-foreground-200/60 bg-white p-3 shadow-sm">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
              <div className="relative w-full xl:max-w-[360px]">
                <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }}
                  placeholder="Search by learner name or email..."
                  className="h-10 w-full rounded-xl border border-foreground-200 bg-background-100/70 pl-10 pr-3 text-[12px] text-foreground-900 outline-none transition focus:border-primary-300 focus:bg-white focus:ring-2 focus:ring-primary-100"
                />
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <CaseloadMenuSelect
                  value={sortKey}
                  onChange={(value) => {
                    const next = value as 'name' | 'progress' | 'attendance' | 'components' | 'ksb' | 'otjh';
                    setSortKey(next);
                    setSortDir(next === 'name' ? 'asc' : 'desc');
                  }}
                  options={[
                    { value: 'name', label: 'Learner Name' },
                    { value: 'progress', label: 'Overall Progress' },
                    { value: 'otjh', label: 'OTJH' },
                    { value: 'attendance', label: 'Attendance' },
                    { value: 'components', label: 'Components' },
                    { value: 'ksb', label: 'KSB' },
                  ]}
                  minWidth="min-w-[164px]"
                  icon="ri-sort-asc"
                />
                <FilterDropdown label="Cohort" value={cohortFilter} onChange={(value) => { setCohortFilter(value); setCurrentPage(1); }} options={cohortOptions} />
                <FilterDropdown label="Group" value={groupFilter} onChange={(value) => { setGroupFilter(value); setCurrentPage(1); }} options={groupOptions} />
                <FilterDropdown label="Programme" value={programStatusFilter} onChange={(value) => { setProgramStatusFilter(value); setCurrentPage(1); }} options={programStatusOptions} />
                <FilterDropdown label="Employer" value={employerFilter} onChange={(value) => { setEmployerFilter(value); setCurrentPage(1); }} options={employerOptions} />
                <FilterDropdown label="Learner Status" value={coachRagFilter} onChange={(value) => { setCoachRagFilter(value); setCurrentPage(1); }} options={coachRagOptions} />
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setCohortFilter('all');
                    setGroupFilter('all');
                    setProgramStatusFilter('all');
                    setCoachRagFilter('all');
                    setEmployerFilter('all');
                    setSummaryFilter('all');
                    setCurrentPage(1);
                  }}
                  className="h-10 rounded-xl px-3 text-[11px] font-semibold text-foreground-400 transition hover:bg-background-100 hover:text-foreground-700"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-foreground-100 px-4 py-3">
              <div className="inline-flex rounded-xl bg-background-100 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${viewMode === 'cards' ? 'bg-white text-foreground-900 shadow-sm' : 'text-foreground-400'}`}
                >
                  <i className="ri-layout-grid-line"></i> Card View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${viewMode === 'table' ? 'bg-white text-foreground-900 shadow-sm' : 'text-foreground-400'}`}
                >
                  <i className="ri-table-line"></i> Table View
                </button>
              </div>
              <span className="text-[11px] text-foreground-400">
                {selectedCount > 0 ? `${selectedCount} selected` : `${filtered.length} learners`}
              </span>
            </div>

            {!loading && !error && filtered.length > 0 && (
              <div className="flex flex-col gap-2 border-b border-foreground-100 bg-background-100/30 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePageSelection}
                    className={`rounded-xl px-3 py-2 text-[11px] font-semibold transition ${
                      allPageSelected
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'bg-white text-foreground-600 ring-1 ring-foreground-200 hover:ring-primary-200 hover:text-primary-700'
                    }`}
                  >
                    {allPageSelected ? `Clear Page (${paginated.length})` : `Select Page (${paginated.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectAllFiltered}
                    disabled={allFilteredSelected}
                    className="rounded-xl bg-white px-3 py-2 text-[11px] font-semibold text-foreground-600 ring-1 ring-foreground-200 transition hover:ring-primary-200 hover:text-primary-700 disabled:cursor-default disabled:opacity-50"
                  >
                    Select All Filtered ({filtered.length})
                  </button>
                  {selectedCount > 0 && (
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="rounded-xl px-3 py-2 text-[11px] font-semibold text-foreground-500 transition hover:bg-white hover:text-foreground-800"
                    >
                      Clear Selection
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-foreground-400">
                  {selectedCount > 0
                    ? `${selectedCount} learner${selectedCount === 1 ? '' : 's'} selected across your filtered results.`
                    : 'Selections stay active while you move between pages.'}
                </p>
              </div>
            )}

            {coachRagSaveError && <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-[11px] text-red-700">{coachRagSaveError}</div>}

            {loading ? (
              <div className="py-20 text-center">
                <i className="ri-loader-4-line mb-2 block animate-spin text-3xl text-primary-500"></i>
                <p className="text-sm text-foreground-400">Loading learners...</p>
              </div>
            ) : error ? (
              <div className="py-20 text-center text-sm text-red-600">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center">
                <i className="ri-user-search-line mb-2 block text-3xl text-foreground-300"></i>
                <p className="text-sm text-foreground-400">No learners match your filters.</p>
              </div>
            ) : viewMode === 'cards' ? (
              <div className="grid items-stretch gap-3 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {paginated.map((learner) => (
                  <ReferenceLearnerCard
                    key={learner.id}
                    learner={learner}
                    selected={selectedLearnerIds.has(learner.id)}
                    onToggleSelect={() => toggleLearnerSelection(learner.id)}
                    onOpen={() => navigate('/coach/learner-case-file', { state: { learnerId: learner.id, learnerName: learner.name } })}
                  />
                ))}
              </div>
            ) : (
              <ReferenceLearnerTable
                learners={paginated}
                selectedLearnerIds={selectedLearnerIds}
                onToggleSelect={toggleLearnerSelection}
                onOpen={(learner) => navigate('/coach/learner-case-file', { state: { learnerId: learner.id, learnerName: learner.name } })}
              />
            )}

            {!loading && !error && filtered.length > 0 && (
              <ReferencePagination
                page={safePage}
                totalPages={totalPages}
                total={filtered.length}
                pageSize={PAGE_SIZE}
                onPage={setCurrentPage}
              />
            )}
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Learner Overview" pageSubtitle="Complete caseload with filters by cohort, group, and live status data" userName={ownerName} userRole="Progress Coach">
      <div className="p-3 md:p-6 space-y-4 md:space-y-5">

        {/* Hero Banner — Professional */}
        <section className="relative rounded-2xl overflow-hidden h-36 md:h-40" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          {/* Subtle top highlight */}
          <div className="absolute top-0 left-0 right-0 h-px bg-white/10"></div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-black/10"></div>
          
          <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6">
              {/* Left: Title & subtitle */}
              <div className="flex-1 min-w-0 max-w-xl">
                <h1 className="text-2xl md:text-3xl font-heading font-bold text-white tracking-tight mb-1.5">My Learners</h1>
                <p className="text-[13px] text-white/50 max-w-lg">
                  Manage your complete caseload. Filter by cohort, group, and enrollment status to track progress.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 md:gap-3">
          <MiniStatCard label="Total" value={String(summaryCounts.total)} icon="ri-group-line" color="primary" active={summaryFilter === 'all'} onClick={() => handleSummaryCardClick('all')} />
          <MiniStatCard label="Active" value={String(summaryCounts.active)} icon="ri-check-double-line" color="emerald" active={summaryFilter === 'active'} onClick={() => handleSummaryCardClick('active')} />
          <MiniStatCard label="Break" value={String(summaryCounts.break)} icon="ri-pause-circle-line" color="amber" active={summaryFilter === 'break'} onClick={() => handleSummaryCardClick('break')} />
          <MiniStatCard label="On Track" value={String(summaryCounts.onTrack)} icon="ri-thumb-up-line" color="emerald" active={summaryFilter === 'on-track'} onClick={() => handleSummaryCardClick('on-track')} />
          <MiniStatCard label="Need Attention" value={String(summaryCounts.needAttention)} icon="ri-error-warning-line" color="amber" active={summaryFilter === 'need-attention'} onClick={() => handleSummaryCardClick('need-attention')} />
          <MiniStatCard label="At Risk" value={String(summaryCounts.atRisk)} icon="ri-alarm-warning-line" color="red" active={summaryFilter === 'at-risk'} onClick={() => handleSummaryCardClick('at-risk')} />
        </div>

        {/* Filters Bar */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 md:p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3 flex-wrap">
            <div className="w-full lg:w-auto lg:min-w-[240px] lg:max-w-[280px]">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
                <input type="text" value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} placeholder="Search learners..." className="w-full pl-9 pr-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[12px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
              </div>
            </div>

            <div className="w-px h-6 bg-background-200/70 hidden lg:block"></div>

            <div className="flex items-center gap-2 flex-wrap">
              <FilterDropdown
                label="Cohort"
                value={cohortFilter}
                onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }}
                options={cohortOptions}
              />
              <FilterDropdown
                label="Group"
                value={groupFilter}
                onChange={(v) => { setGroupFilter(v); setCurrentPage(1); }}
                options={groupOptions}
              />
              <FilterDropdown
                label="Program Status"
                value={programStatusFilter}
                onChange={(v) => { setProgramStatusFilter(v); setCurrentPage(1); }}
                options={programStatusOptions}
              />
              <div className="w-px h-5 bg-background-200/70"></div>
              <FilterDropdown
                label="Coach RAG"
                value={coachRagFilter}
                onChange={(v) => { setCoachRagFilter(v); setCurrentPage(1); }}
                options={coachRagOptions}
              />
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          {coachRagSaveError && (
            <div className="border-b border-red-200/60 bg-red-50 px-4 py-2 text-[11px] font-medium text-red-700">
              {coachRagSaveError}
            </div>
          )}
          {loading ? (
            <div className="py-12 text-center">
              <i className="ri-loader-4-line text-primary-500 text-3xl mb-2 block animate-spin"></i>
              <p className="text-sm text-foreground-500">Loading live learner data...</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <i className="ri-error-warning-line text-red-500 text-3xl mb-2 block"></i>
              <p className="text-sm text-foreground-600">{error}</p>
              <p className="text-[11px] text-foreground-400 mt-1">{ownerEmail}</p>
            </div>
          ) : (
            <>
              <div
                ref={tableScrollRef}
                className={`overflow-x-auto ${isTableDragging ? 'cursor-grabbing select-none' : ''}`}
                onPointerDown={handleTablePointerDown}
                onPointerMove={handleTablePointerMove}
                onPointerUp={handleTablePointerUp}
                onPointerLeave={endTableDrag}
                onPointerCancel={endTableDrag}
                style={{ touchAction: 'pan-y' }}
              >
                <table className="w-full table-fixed text-left">
                  <thead>
                    <tr className="border-b border-foreground-200/60">
                      <ThSort label="Learner" sortKey="name" current={sortKey} dir={sortDir} onClick={() => handleSort('name')} className="sticky left-0 z-20 w-[220px] bg-background-50 pl-3 pr-2 py-2.5 text-[9px]" />
                      <th className="w-[170px] px-2 py-2.5 text-[9px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Cohort</th>
                      <th className="w-[185px] px-2 py-2.5 text-[9px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Group</th>
                      <th className="w-[88px] px-2 py-2.5 text-center text-[9px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Coach RAG</th>
                      <th className="w-[108px] px-2 py-2.5 text-center text-[9px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Program Status</th>
                      <ThSort label="OTJH" sortKey="otjh" current={sortKey} dir={sortDir} onClick={() => handleSort('otjh')} className="w-[102px] text-center text-[9px]" contentClassName="justify-center" />
                      <ThSort label="KSB" sortKey="ksb" current={sortKey} dir={sortDir} onClick={() => handleSort('ksb')} className="w-[80px] text-center text-[9px]" contentClassName="justify-center" />
                      <ThSort label="Components" sortKey="attendance" current={sortKey} dir={sortDir} onClick={() => handleSort('attendance')} className="w-[84px] text-center text-[9px]" contentClassName="justify-center" />
                      <ThSort label="OTJH Progress" sortKey="progress" current={sortKey} dir={sortDir} onClick={() => handleSort('progress')} className="w-[104px] text-center text-[9px]" contentClassName="justify-center" />
                      <th className="w-[88px] px-2 py-2.5 text-center text-[9px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Start Date</th>
                      <th className="w-[96px] px-2 py-2.5 text-center text-[9px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Gateway Review</th>
                      <th className="w-[48px] pr-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-background-200/30">
                    {paginated.map(learner => {
                      const isSel = selectedLearnerId === learner.id;
                      const variance = parseVariance(learner.progressVariance);
                      const varianceTextClass = variance < 0
                        ? 'text-red-600'
                        : variance > 0
                          ? 'text-emerald-600'
                          : 'text-foreground-700';
                      const programStatusStyle = getProgramStatusStyle(learner.rawProgramStatus);
                      const coachRagStyle = getCoachRagStyle(learner.coachRag);
                      const ksbStatusMeta = getKsbStatusMeta(learner.ksbStatus);
                      const otjhStatusMeta = getOtjhStatusMeta(learner.otjhStatus);

                      return (
                        <tr
                          key={learner.id}
                          onClick={() => handleRowSelection(learner.id, isSel)}
                          className={`group transition-smooth ${isTableDragging ? 'cursor-grabbing' : 'cursor-grab'} ${isSel ? 'bg-primary-50/30' : 'hover:bg-background-100/50'}`}
                        >
                          <td className={`sticky left-0 z-10 pl-3 pr-2 py-2 ${isSel ? 'bg-primary-50/30' : 'bg-background-50 group-hover:bg-background-100/50'}`}>
                            <div className="flex items-center gap-2">
                              <div
                                onClick={(e) => { e.stopPropagation(); navigate('/coach/learner-case-file', { state: { learnerId: learner.id, learnerName: learner.name } }); }}
                                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ring-1.5 cursor-pointer hover:scale-110 transition-transform ${learner.status === 'at-risk' ? 'bg-red-100 text-red-700 ring-red-200' : learner.status === 'high' ? 'bg-accent-100 text-accent-700 ring-accent-200' : learner.status === 'new-starter' ? 'bg-primary-100 text-primary-700 ring-primary-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}
                                title="View profile"
                              >
                                <span className="text-[10px] font-bold">{learner.initials}</span>
                              </div>
                              <div className="min-w-0">
                                <p
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (hasActiveTextSelection()) {
                                      return;
                                    }
                                    navigate('/coach/learner-case-file', { state: { learnerId: learner.id, learnerName: learner.name } });
                                  }}
                                  data-allow-selection="true"
                                  className="select-text text-[11px] font-semibold text-foreground-900 truncate cursor-pointer hover:text-primary-600 hover:underline transition-colors"
                                  title="View profile"
                                >
                                  {learner.name}
                                </p>
                                <p data-allow-selection="true" className="cursor-text select-text text-[9px] text-foreground-400 truncate">{learner.employer}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-[10px] text-foreground-600">
                            <span data-allow-selection="true" className="inline-flex max-w-[220px] cursor-text rounded-full bg-background-100 px-1.5 py-0.5 text-[9px] font-medium text-foreground-500">
                              <OverflowRevealText text={learner.cohortName} maxWidthClass="max-w-[205px]" />
                            </span>
                          </td>
                          <td className="px-2 py-2 text-[10px] text-foreground-500">
                            <OverflowRevealText text={learner.group} maxWidthClass="max-w-[175px]" />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <CoachRagSelector
                              value={learner.coachRag}
                              learnerName={learner.name}
                              isOpen={openCoachRagId === learner.id}
                              saving={savingCoachRagId === learner.id}
                              onOpenChange={(open) => setOpenCoachRagId(open ? learner.id : null)}
                              onChange={(nextValue) => {
                                setOpenCoachRagId(null);
                                void handleCoachRagChange(learner.id, nextValue);
                              }}
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span data-allow-selection="true" className={`cursor-text select-text text-[8px] font-semibold px-1.5 py-0.5 rounded-full border ${programStatusStyle.bg} ${programStatusStyle.text} whitespace-nowrap`}>
                              {displayValue(learner.rawProgramStatus)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              data-allow-selection="true"
                              onClick={(event) => handleMetricDetailClick(event, learner, 'otjh')}
                              className="group/metric flex min-w-[96px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 leading-none text-center transition-smooth hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-200"
                              title="View OTJH details"
                            >
                              {learner.overallProgressAvailable ? (
                                <>
                                  <span className="text-[10px] font-semibold tabular-nums whitespace-nowrap text-foreground-800 group-hover/metric:text-primary-700">
                                    {`${formatHoursValue(learner.otjhCompleted)}/${formatHoursValue(learner.otjhTarget)}h`}
                                  </span>
                                  <span className={`inline-flex items-center gap-1 text-[8px] font-medium whitespace-nowrap ${learner.otjhStatus ? otjhStatusMeta.text : 'text-foreground-500'}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${learner.otjhStatus ? otjhStatusMeta.dot : 'bg-foreground-300'}`}></span>
                                    {learner.otjhStatus ? displayValue(learner.otjhStatus) : `${learner.overallProgress}% complete`}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className={`text-[10px] font-semibold tabular-nums whitespace-nowrap ${varianceTextClass}`}>
                                    {learner.progressVariance}
                                  </span>
                                  <span className={`inline-flex items-center gap-1 text-[8px] font-medium whitespace-nowrap ${otjhStatusMeta.text}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${otjhStatusMeta.dot}`}></span>
                                    {displayValue(learner.otjhStatus)}
                                  </span>
                                </>
                              )}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              data-allow-selection="true"
                              onClick={(event) => handleMetricDetailClick(event, learner, 'ksb')}
                              className="group/metric flex min-w-[72px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 leading-none text-center transition-smooth hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-200"
                              title="View KSB details"
                            >
                              <span className="text-[10px] font-semibold tabular-nums text-foreground-800 whitespace-nowrap group-hover/metric:text-primary-700">
                                {formatRatio(learner.ksbCompleted, learner.ksbTarget)}
                              </span>
                              <span className={`inline-flex items-center gap-1 text-[8px] font-medium whitespace-nowrap ${ksbStatusMeta.text}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${ksbStatusMeta.dot}`}></span>
                                {displayValue(learner.ksbStatus)}
                              </span>
                            </button>
                          </td>
                          <td className="px-2 py-2 text-center">
                            {learner.attendanceRateAvailable ? (
                              <button
                                type="button"
                                title={getComponentsTooltip(learner)}
                                data-allow-selection="true"
                                onClick={(event) => handleMetricDetailClick(event, learner, 'components')}
                                className="group/metric flex min-w-[72px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 leading-none text-center transition-smooth hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-200"
                              >
                                <span className="text-[10px] font-semibold tabular-nums text-foreground-800 whitespace-nowrap group-hover/metric:text-primary-700">
                                  {`${learner.componentsCompleted ?? 0}/${learner.componentsPlanned ?? 0}`}
                                </span>
                                <span className={`text-[8px] font-medium whitespace-nowrap ${learner.attendanceRate >= 90 ? 'text-emerald-600' : learner.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                                  {learner.attendanceRate}%
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-allow-selection="true"
                                onClick={(event) => handleMetricDetailClick(event, learner, 'components')}
                                className="min-w-[72px] rounded-lg px-2 py-1 text-[10px] font-semibold text-foreground-400 transition-smooth hover:bg-primary-50 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-200"
                                title="View components details"
                              >
                                {EMPTY_VALUE}
                              </button>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {learner.overallProgressAvailable ? (
                              <div title={getProgressTooltip(learner)} className="flex items-center justify-center gap-1 cursor-help">
                                <div className="w-8 bg-background-200 rounded-full h-1.5">
                                  <div className={`h-1.5 rounded-full ${learner.status === 'at-risk' ? 'bg-red-500' : learner.status === 'high' ? 'bg-accent-500' : 'bg-primary-500'}`} style={{ width: `${learner.overallProgress}%` }}></div>
                                </div>
                                <span data-allow-selection="true" className="cursor-text select-text text-[10px] font-semibold text-foreground-700 w-6 text-right">{learner.overallProgress}%</span>
                              </div>
                            ) : (
                              <span data-allow-selection="true" className="cursor-text select-text text-[10px] font-semibold text-foreground-400">{EMPTY_VALUE}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center text-[10px] text-foreground-600 whitespace-nowrap">
                            <span data-allow-selection="true" className="cursor-text select-text">{learner.startDate}</span>
                          </td>
                          <td className="px-2 py-2 text-center text-[10px] text-foreground-600 whitespace-nowrap">
                            <span data-allow-selection="true" className="cursor-text select-text">{learner.gatewayReviewDate}</span>
                          </td>
                          <td className="pr-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedLearnerId(learner.id);
                              }}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-smooth cursor-pointer ${
                                isSel
                                  ? 'border-primary-200 bg-primary-50 text-primary-600'
                                  : 'border-foreground-200/60 bg-background-50 text-foreground-400 hover:border-primary-200 hover:text-primary-600'
                              }`}
                              title="View details"
                              aria-label={`View details for ${learner.name}`}
                            >
                              <i className={`${isSel ? 'ri-eye-fill' : 'ri-eye-line'} text-sm`}></i>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filtered.length === 0 && (
                <div className="py-12 text-center">
                  <i className="ri-search-line text-foreground-300 text-3xl mb-2 block"></i>
                  <p className="text-sm text-foreground-400">No learners match your filters</p>
                  <button onClick={() => { setSummaryFilter('all'); setProgramStatusFilter('all'); setCohortFilter('all'); setGroupFilter('all'); setCoachRagFilter('all'); setSearch(''); setCurrentPage(1); }} className="mt-2 text-[11px] font-medium text-primary-600 hover:text-primary-700 cursor-pointer">
                    Clear all filters
                  </button>
                </div>
              )}

              {filtered.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-foreground-200/60 bg-background-100/30">
                  <span className="text-[11px] text-foreground-400">
                    Showing <strong className="text-foreground-700">{Math.min((safePage - 1) * PAGE_SIZE + 1, filtered.length)}&ndash;{Math.min(safePage * PAGE_SIZE, filtered.length)}</strong> of <strong className="text-foreground-700">{filtered.length}</strong> learners
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-500 hover:bg-background-200/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-smooth"
                    >
                      <i className="ri-arrow-left-s-line text-sm"></i>
                    </button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-semibold cursor-pointer transition-smooth ${safePage === page ? 'bg-primary-500 text-white' : 'text-foreground-500 hover:bg-background-200/50'}`}
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-500 hover:bg-background-200/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-smooth"
                    >
                      <i className="ri-arrow-right-s-line text-sm"></i>
                    </button>
                  </div>

                  <span className="text-[11px] text-foreground-400">
                    Page {safePage} of {totalPages}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Slide Panel — Learner Detail */}
        <RightSlidePanel
          isOpen={selectedLearner !== null}
          onClose={() => setSelectedLearnerId(null)}
          title={selectedLearner?.name || 'Learner Detail'}
          width="w-[520px]"
        >
          {selectedLearner && (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${selectedLearner.status === 'at-risk' ? 'bg-red-100 text-red-700 ring-red-200' : selectedLearner.status === 'high' ? 'bg-accent-100 text-accent-700 ring-accent-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                  <span className="text-lg font-bold">{selectedLearner.initials}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getProgramStatusStyle(selectedLearner.rawProgramStatus).bg} ${getProgramStatusStyle(selectedLearner.rawProgramStatus).text}`}>
                      {displayValue(selectedLearner.rawProgramStatus)}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getCoachRagStyle(selectedLearner.coachRag).bg} ${getCoachRagStyle(selectedLearner.coachRag).text}`}>
                      {displayValue(selectedLearner.coachRag)}
                    </span>
                    {selectedLearner.recentFlag && (
                      <span className="text-[10px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{selectedLearner.recentFlag}</span>
                    )}
                  </div>
                  <p className="text-[12px] text-foreground-400">{selectedLearner.cohortName}</p>
                  <p className="text-[12px] text-foreground-400">{selectedLearner.employer}</p>
                  <p className="text-[11px] text-foreground-300 mt-0.5">{selectedLearner.group}</p>
                </div>
              </div>

              {/* Risk Flags */}
              {selectedLearner.riskFlags.length > 0 && (
                <div className="bg-red-50/50 rounded-xl border border-red-200/30 p-4">
                  <h4 className="text-[11px] font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                    <i className="ri-alert-line"></i> Risk Flags
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLearner.riskFlags.map(flag => (
                      <span key={flag} className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{flag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Modern Stats Grid with Donut Charts */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.overallProgress} size={64} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">Overall Progress</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.overallProgress}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.overallProgress >= 70 ? 'Excellent' : selectedLearner.overallProgress >= 40 ? 'On Track' : 'Needs Support'}</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.attendanceRate} size={64} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">Components</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.attendanceRate}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.attendanceRate >= 90 ? 'Strong completion' : selectedLearner.attendanceRate >= 80 ? 'Steady pace' : 'Needs attention'}</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} size={64} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">OTJH Hours</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p>
                    <p className="text-[9px] text-foreground-300">{Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)}% of target</p>
                  </div>
                </div>
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                  <DonutChart percentage={selectedLearner.ksbProgress} size={64} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                  <div>
                    <p className="text-[10px] text-foreground-400">KSB Progress</p>
                    <p className="text-lg font-bold text-foreground-900">{selectedLearner.ksbProgress}%</p>
                    <p className="text-[9px] text-foreground-300">{selectedLearner.ksbProgress >= 70 ? 'Excellent' : selectedLearner.ksbProgress >= 40 ? 'On Track' : 'Needs Support'}</p>
                  </div>
                </div>
              </div>

              {/* Dates */}
              <div className="space-y-2.5">
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Evidence Count</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.evidenceCount} items</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Coach</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.coachName || ownerName}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Coach Email</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.coachEmail || ownerEmail}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Program Status</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.rawProgramStatus || selectedLearner.enrollmentStatus}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">OTJH Status</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.otjhStatus}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Start Date</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.startDate}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Planned End Date</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.plannedEndDate}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Gateway Review</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.gatewayReviewDate}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                  <span className="text-foreground-400">Variance</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.progressVariance}</span>
                </div>
                <div className="flex justify-between py-2 text-[12px]">
                  <span className="text-foreground-400">Latest Evidence Marker</span>
                  <span className="text-foreground-900 font-medium">{selectedLearner.lastSubmittedEvidence}</span>
                </div>
              </div>

              {/* Contact Info */}
              <div className="bg-background-100/50 rounded-xl p-3.5 space-y-2">
                <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Contact Info</p>
                <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                  <i className="ri-mail-line text-foreground-300 text-xs"></i>
                  <span>{selectedLearner.email || 'No learner email available'}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                  <i className="ri-building-line text-foreground-300 text-xs"></i>
                  <span>{selectedLearner.employer}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                  <i className="ri-mail-send-line text-foreground-300 text-xs"></i>
                  <span>{selectedLearner.employerEmail || 'No employer email available'}</span>
                </div>
                {selectedLearner.employerPhone && (
                  <div className="flex items-center gap-2 text-[11px] text-foreground-600">
                    <i className="ri-phone-line text-foreground-300 text-xs"></i>
                    <span>{selectedLearner.employerPhone}</span>
                  </div>
                )}
              </div>

            </div>
          )}
        </RightSlidePanel>

        <RightSlidePanel
          isOpen={selectedMetricDetail !== null}
          onClose={() => setSelectedMetricDetail(null)}
          title={selectedMetricDetail ? `${getMetricCopy(selectedMetricDetail.metric).title} Details` : 'Metric Details'}
          width="w-[420px]"
        >
          {selectedMetricDetail && (
            <MetricDetailPanel
              learner={selectedMetricDetail.learner}
              metric={selectedMetricDetail.metric}
              onOpenFullDetails={handleOpenMetricCaseFile}
            />
          )}
        </RightSlidePanel>

        {/* Full Progress Report — Centered Modal */}
        {showProgressReport && selectedLearner && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-foreground-950/50" onClick={() => setShowProgressReport(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-[900px] max-h-[90vh] overflow-y-auto shadow-2xl border border-background-200 animate-in fade-in zoom-in-95 duration-200">

              {/* Modal Header */}
              <div className="sticky top-0 z-10 bg-background-50 rounded-t-2xl border-b border-foreground-200/60 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${selectedLearner.status === 'at-risk' ? 'bg-red-100 text-red-700' : selectedLearner.status === 'high' ? 'bg-accent-100 text-accent-700' : 'bg-primary-100 text-primary-700'}`}>
                    {selectedLearner.initials}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground-900">Learner Progress Report</h3>
                    <p className="text-[11px] text-foreground-400">{selectedLearner.name} &middot; {selectedLearner.cohortName} &middot; Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { window.print(); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-medium hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-download-line text-xs"></i> Download PDF
                  </button>
                  <button
                    onClick={() => setShowProgressReport(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
                  >
                    <i className="ri-close-line text-sm"></i>
                  </button>
                </div>
              </div>

              {/* Report Content */}
              <div className="px-6 py-5 space-y-6">

                {/* Top Summary Bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SummaryPill label="Overall Progress" value={`${selectedLearner.overallProgress}%`} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} />
                  <SummaryPill label="Components" value={`${selectedLearner.attendanceRate}%`} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} />
                  <SummaryPill label="KSB Progress" value={`${selectedLearner.ksbProgress}%`} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                  <SummaryPill label="OTJH Hours" value={`${selectedLearner.otjhCompleted}/${selectedLearner.otjhTarget}`} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                </div>

                {/* Executive Summary */}
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                  <h4 className="text-[13px] font-semibold text-foreground-900 mb-3 flex items-center gap-2">
                    <i className="ri-file-list-3-line text-primary-500"></i> Executive Summary
                  </h4>
                  <p className="text-[12px] text-foreground-600 leading-relaxed">
                    {selectedLearner.name} is currently enrolled on the <strong>{selectedLearner.cohortName}</strong> cohort
                    with {selectedLearner.employer} (group: {selectedLearner.group}).
                    {selectedLearner.status === 'at-risk' && (
                      <> They are currently flagged as <strong className="text-red-600">At Risk</strong> due to {selectedLearner.riskFlags.join(', ')}. Immediate coaching intervention is recommended within 48 hours.</>
                    )}
                    {selectedLearner.status === 'on-track' && (
                      <> They are currently <strong className="text-emerald-600">On Track</strong> with consistent progress across all key metrics. Continue with current coaching schedule.</>
                    )}
                    {selectedLearner.status === 'high' && (
                      <> They are a <strong className="text-accent-600">High Performer</strong> with excellent progress across all areas. Consider discussing gateway readiness and EPA timeline.</>
                    )}
                    {selectedLearner.status === 'new-starter' && (
                      <> They are a <strong className="text-primary-600">New Starter</strong> currently in onboarding. Focus on checklist completion and community integration.</>
                    )}
                  </p>
                </div>

                {/* Progress Overview with Donuts */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={selectedLearner.overallProgress} size={80} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} label="Overall" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.overallProgress >= 70 ? 'Excellent' : selectedLearner.overallProgress >= 40 ? 'On Track' : 'Needs Support'}</p>
                  </div>
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={selectedLearner.attendanceRate} size={80} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} label="Components" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.attendanceRate >= 90 ? 'Strong completion' : selectedLearner.attendanceRate >= 80 ? 'Steady pace' : 'Needs attention'}</p>
                  </div>
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} size={80} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} label="OTJH Hours" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.otjhCompleted} of {selectedLearner.otjhTarget} hours</p>
                  </div>
                  <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col items-center">
                    <DonutChart percentage={selectedLearner.ksbProgress} size={80} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} label="KSBs" />
                    <p className="text-[10px] text-foreground-400 mt-1">{selectedLearner.ksbProgress >= 70 ? 'On pace for gateway' : 'Needs acceleration'}</p>
                  </div>
                </div>

                {/* Key Metrics Table */}
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                  <h4 className="text-[13px] font-semibold text-foreground-900 mb-4 flex items-center gap-2">
                    <i className="ri-bar-chart-box-line text-primary-500"></i> Key Metrics
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <MetricRow label="Overall Progress" value={`${selectedLearner.overallProgress}%`} bar={selectedLearner.overallProgress} color={selectedLearner.status === 'at-risk' ? 'red' : selectedLearner.status === 'high' ? 'accent' : 'primary'} />
                    <MetricRow label="Component Completion" value={`${selectedLearner.attendanceRate}%`} bar={selectedLearner.attendanceRate} color={selectedLearner.attendanceRate >= 90 ? 'emerald' : selectedLearner.attendanceRate >= 80 ? 'amber' : 'red'} />
                    <MetricRow label="KSB Progress" value={`${selectedLearner.ksbProgress}%`} bar={selectedLearner.ksbProgress} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                    <MetricRow label="OTJH Hours Completion" value={`${Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)}%`} bar={Math.round((selectedLearner.otjhCompleted / selectedLearner.otjhTarget) * 100)} color={selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.7 ? 'emerald' : selectedLearner.otjhCompleted / selectedLearner.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                    <MetricRow label="Evidence Submitted" value={`${selectedLearner.evidenceCount} items`} bar={Math.min(100, (selectedLearner.evidenceCount / 25) * 100)} color={selectedLearner.evidenceCount >= 15 ? 'emerald' : selectedLearner.evidenceCount >= 8 ? 'amber' : 'red'} />
                    <MetricRow label="Program Status" value={displayValue(selectedLearner.rawProgramStatus)} bar={selectedLearner.enrollmentStatus === 'active' ? 100 : selectedLearner.enrollmentStatus === 'break' ? 50 : 20} color={selectedLearner.enrollmentStatus === 'active' ? 'emerald' : selectedLearner.enrollmentStatus === 'break' ? 'amber' : 'foreground'} />
                  </div>
                </div>

                {/* Issues & Concerns */}
                <div className="bg-red-50 rounded-xl border border-red-200/30 p-5">
                  <h4 className="text-[13px] font-semibold text-red-800 mb-3 flex items-center gap-2">
                    <i className="ri-error-warning-line text-red-500"></i> Issues & Concerns
                  </h4>
                  {selectedLearner.riskFlags.length > 0 ? (
                    <div className="space-y-3">
                      {selectedLearner.riskFlags.map((flag, i) => (
                        <div key={i} className="flex items-start gap-3 bg-white rounded-lg p-3 border border-red-100">
                          <span className="w-6 h-6 rounded-lg bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                            <i className="ri-alert-line text-red-500 text-xs"></i>
                          </span>
                          <div>
                            <p className="text-[12px] font-semibold text-red-700">{flag}</p>
                            <p className="text-[11px] text-red-500/70 mt-0.5">
                              {flag.includes('Coach RAG') && 'The coach RAG on the source table is not green, so this learner needs a focused review and a clear intervention plan.'}
                              {flag.includes('Hours') && 'Tracked hours are behind pace. Review workplace opportunities and agree a short recovery target with the employer.'}
                              {flag.includes('OTJH') && 'On-the-job hours are behind the expected pace. Coordinate with the employer to identify additional workplace opportunities.'}
                              {flag.includes('KSB') && 'Knowledge, Skills & Behaviours progress is behind the expected pace. Review evidence mapping and provide targeted coaching support.'}
                              {flag.includes('Components') && 'Component completion is behind target. Check which units are blocked and agree the next submission milestone.'}
                              {flag.includes('Variance') && 'Progress variance is below plan. Compare completed hours to target and set a realistic catch-up plan.'}
                              {flag.includes('Evidence') && 'Evidence submissions are overdue or insufficient. Set weekly evidence targets and provide clear guidance on requirements.'}
                              {flag.includes('engagement') && 'Learner engagement levels have dropped. Reach out to understand barriers and re-establish motivation.'}
                              {!flag.includes('Coach RAG') && !flag.includes('Hours') && !flag.includes('OTJH') && !flag.includes('KSB') && !flag.includes('Components') && !flag.includes('Variance') && !flag.includes('Evidence') && !flag.includes('engagement') && 'This area requires attention. Review with the learner and employer to create an improvement plan.'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 bg-white rounded-lg p-3 border border-red-100">
                      <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                        <i className="ri-check-line text-emerald-500 text-xs"></i>
                      </span>
                      <p className="text-[12px] text-emerald-700">No current risk flags. Learner is progressing well across all monitored areas.</p>
                    </div>
                  )}
                </div>

                {/* Strengths & Highlights */}
                <div className="bg-emerald-50 rounded-xl border border-emerald-200/30 p-5">
                  <h4 className="text-[13px] font-semibold text-emerald-800 mb-3 flex items-center gap-2">
                    <i className="ri-shining-line text-emerald-500"></i> Strengths & Highlights
                  </h4>
                  <div className="space-y-2">
                    {selectedLearner.status === 'high' && (
                      <>
                        <StrengthItem icon="ri-star-line" text="Consistently high performance across all key metrics" subtext="Overall progress is strong with healthy component completion and evidence quality" />
                        <StrengthItem icon="ri-rocket-line" text="Gateway-ready KSB coverage" subtext={`${selectedLearner.ksbProgress}% completion - on track for EPA`} />
                        <StrengthItem icon="ri-trophy-line" text="Strong employer engagement" subtext="Workplace supervision and OTJH hours are well supported" />
                        <StrengthItem icon="ri-medal-line" text="Self-directed learner" subtext="Proactively submits evidence and keeps steady momentum without repeated prompting" />
                      </>
                    )}
                    {selectedLearner.status === 'on-track' && (
                      <>
                        <StrengthItem icon="ri-check-double-line" text="Steady and consistent progress" subtext={`Maintaining ${selectedLearner.overallProgress}% overall with regular submissions`} />
                        <StrengthItem icon="ri-group-line" text="Healthy component completion" subtext={`${selectedLearner.attendanceRate}% of tracked components are complete or on pace`} />
                        <StrengthItem icon="ri-hand-heart-line" text="Responsive to coaching support" subtext="Engages well in 1:1 sessions and implements feedback" />
                      </>
                    )}
                    {selectedLearner.status === 'at-risk' && (
                      <>
                        <StrengthItem icon="ri-heart-pulse-line" text="Still actively engaged" subtext="Learner continues to attend sessions and communicate with coach" />
                        <StrengthItem icon="ri-award-line" text="Evidence quality is good when submitted" subtext="Submitted work meets standards — issue is volume, not quality" />
                        <StrengthItem icon="ri-user-heart-line" text="Employer is supportive" subtext="Employer has confirmed willingness to provide additional workplace support" />
                      </>
                    )}
                    {selectedLearner.status === 'new-starter' && (
                      <>
                        <StrengthItem icon="ri-emotion-happy-line" text="Positive onboarding attitude" subtext="Learner is enthusiastic and engaged with induction materials" />
                        <StrengthItem icon="ri-shield-check-line" text="Early completion signals look strong" subtext="Initial tracked components are progressing well for a new starter" />
                        <StrengthItem icon="ri-lightbulb-line" text="Quick learner" subtext="Demonstrates good understanding of early module content" />
                      </>
                    )}
                  </div>
                </div>

                {/* Recent Activity Timeline */}
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                  <h4 className="text-[13px] font-semibold text-foreground-900 mb-4 flex items-center gap-2">
                    <i className="ri-time-line text-primary-500"></i> Recent Activity Timeline
                  </h4>
                  <div className="space-y-3">
                    <TimelineItem icon="ri-calendar-check-line" color="emerald" date={selectedLearner.startDate} title="Learner Start" desc="Start date pulled from the learner record" />
                    <TimelineItem icon="ri-file-chart-line" color="primary" date={selectedLearner.gatewayReviewDate} title="Gateway Review" desc="Current gateway review date from the source table" />
                    <TimelineItem icon="ri-mail-line" color="secondary" date={selectedLearner.coachEmail || ownerEmail} title="Assigned Coach" desc={selectedLearner.coachName || ownerName} />
                    <TimelineItem icon="ri-folder-upload-line" color="accent" date={selectedLearner.progressVariance} title={`${selectedLearner.evidenceCount} Evidence Items`} desc={selectedLearner.status === 'at-risk' ? 'Variance is behind target - catch-up planning recommended' : 'Evidence volume looks healthy against current progress'} />
                  </div>
                </div>

                {/* Action Plan / Recommendations */}
                <div className="bg-primary-50 rounded-xl border border-primary-200/30 p-5">
                  <h4 className="text-[13px] font-semibold text-primary-800 mb-3 flex items-center gap-2">
                    <i className="ri-lightbulb-flash-line text-primary-500"></i> Coach Action Plan
                  </h4>
                  <div className="space-y-2">
                    {selectedLearner.status === 'at-risk' && (
                      <>
                        <ActionItem icon="ri-alarm-warning-line" color="red" text="Schedule urgent coaching intervention within 48 hours" />
                        <ActionItem icon="ri-phone-line" color="primary" text="Contact employer to discuss workplace support plan" />
                        <ActionItem icon="ri-file-list-line" color="amber" text="Review evidence backlog and set weekly submission targets" />
                        <ActionItem icon="ri-user-search-line" color="secondary" text="Conduct barrier assessment to identify root causes" />
                        <ActionItem icon="ri-calendar-event-line" color="emerald" text="Arrange follow-up check-in within 7 days" />
                      </>
                    )}
                    {selectedLearner.status === 'on-track' && (
                      <>
                        <ActionItem icon="ri-check-line" color="emerald" text="Continue with current coaching schedule" />
                        <ActionItem icon="ri-trophy-line" color="accent" text="Consider stretch assignments to maintain engagement" />
                        <ActionItem icon="ri-share-forward-line" color="primary" text="Connect with peer mentors for knowledge sharing" />
                        <ActionItem icon="ri-calendar-event-line" color="secondary" text="Schedule mid-term review to maintain momentum" />
                      </>
                    )}
                    {selectedLearner.status === 'high' && (
                      <>
                        <ActionItem icon="ri-star-line" color="accent" text="Discuss gateway readiness and EPA timeline" />
                        <ActionItem icon="ri-share-forward-line" color="primary" text="Connect with peer mentors for leadership development" />
                        <ActionItem icon="ri-award-line" color="emerald" text="Nominate for recognition or ambassador programme" />
                        <ActionItem icon="ri-file-chart-line" color="secondary" text="Begin EPA preparation and mock assessment planning" />
                      </>
                    )}
                    {selectedLearner.status === 'new-starter' && (
                      <>
                        <ActionItem icon="ri-hand-heart-line" color="primary" text="Focus on onboarding checklist completion" />
                        <ActionItem icon="ri-group-line" color="accent" text="Introduce to cohort community and assign peer buddy" />
                        <ActionItem icon="ri-shield-check-line" color="emerald" text="Set initial KSB and evidence expectations" />
                        <ActionItem icon="ri-calendar-event-line" color="secondary" text="Schedule first 1:1 coaching within 2 weeks" />
                      </>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-foreground-200/60">
                  <p className="text-[10px] text-foreground-400">
                    Report generated by {ownerName}, Progress Coach &middot; {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <button
                    onClick={() => { window.print(); }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 text-white text-[12px] font-medium hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-download-line text-xs"></i> Download PDF
                  </button>
                </div>

              </div>
            </div>
          </div>
        )}

      </div>
    </WorkspaceShell>
  );
}

/* Sub-components */

function HeaderMetric({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: 'primary' | 'emerald' | 'amber' | 'red' }) {
  const styles = {
    primary: 'bg-primary-50 text-primary-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <div className="flex min-h-[54px] min-w-[110px] items-center gap-2.5 rounded-xl border border-white/10 bg-white/10 px-3 py-2 backdrop-blur-sm">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles[tone]}`}><i className={icon}></i></span>
      <div>
        <p className="whitespace-nowrap text-[9px] font-semibold text-white/60">{label}</p>
        <p className="text-base font-bold text-white">{value}</p>
      </div>
    </div>
  );
}

function CaseloadStatusTab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] font-semibold transition ${
        active ? 'border-primary-600 bg-primary-600 text-white shadow-sm' : 'border-foreground-200 bg-white text-foreground-500 hover:border-primary-200 hover:text-primary-700'
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${active ? 'bg-white/20 text-white' : 'bg-background-100 text-foreground-400'}`}>{count}</span>
    </button>
  );
}

function ReferenceLearnerCard({
  learner,
  selected,
  onToggleSelect,
  onOpen,
}: {
  learner: Learner;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const statusStyle = getProgramStatusStyle(learner.rawProgramStatus);
  const rag = displayValue(learner.coachRag);
  const ragDot = getCoachRagDotClass(rag);
  const primaryRisk = learner.riskFlags[0] || 'No active flags';
  const hasPrimaryRisk = Boolean(learner.riskFlags[0]);

  return (
    <article className={`flex h-full overflow-hidden rounded-2xl border bg-white transition hover:border-primary-200 hover:shadow-[0_12px_28px_rgba(60,30,110,0.08)] ${
      selected ? 'border-primary-300 ring-2 ring-primary-100' : 'border-foreground-200/70'
    }`}>
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${learner.name}`}
            className="mt-3 h-3.5 w-3.5 rounded border-foreground-300 accent-primary-600"
          />
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-100 to-secondary-100 text-[11px] font-bold text-primary-800 ring-2 ring-white shadow-sm">
            {learner.initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[13px] font-bold text-foreground-950">{learner.name}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold ${statusStyle.bg} ${statusStyle.text}`}>{displayValue(learner.rawProgramStatus)}</span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-foreground-400">{learner.email || learner.employer}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="text-foreground-300 hover:text-foreground-700" aria-label="Expand learner card"><i className="ri-arrow-down-s-line"></i></button>
            <button type="button" className="text-foreground-300 hover:text-foreground-700" aria-label="More options"><i className="ri-more-2-fill"></i></button>
          </div>
        </div>

        <div className="mt-3 space-y-1.5 text-[10px]">
          {displayValue(learner.employer) !== EMPTY_VALUE && (
            <p className="truncate font-semibold text-foreground-700"><i className="ri-building-4-line mr-1.5 text-foreground-300"></i>{displayValue(learner.employer)}</p>
          )}
          <p className="truncate text-foreground-400">{displayValue(learner.cohortName)} <span className="mx-1.5">·</span> {displayValue(learner.group)}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CardMetric value={`${formatHoursValue(learner.otjhCompleted)}/${formatHoursValue(learner.otjhTarget)}`} label="OTJH" />
          <CardMetric
            value={formatPercentValue(learner.liveAttendanceRate)}
            label="Attendance"
            hint={learner.attendanceSessions ? `${learner.attendanceSessions} session${learner.attendanceSessions === 1 ? '' : 's'}` : null}
          />
          <CardMetric
            value={formatComponentsValue(learner)}
            label="Components"
            hint={formatComponentsHint(learner)}
          />
          <CardMetric value={formatRatio(learner.ksbCompleted, learner.ksbTarget)} label="KSB" />
        </div>
      </div>

      <footer className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-t border-foreground-100 bg-background-100/35 px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[9px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-foreground-600 ring-1 ring-foreground-200/70">
            <span className={`h-2 w-2 rounded-full ${ragDot}`}></span>
            <span className="font-semibold text-foreground-500">Coach RAG:</span>
            <span className="font-semibold text-foreground-700">{rag}</span>
          </span>
          <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2 py-1 ring-1 ${
            hasPrimaryRisk
              ? 'bg-red-50 text-red-700 ring-red-100'
              : 'bg-white text-foreground-500 ring-foreground-200/70'
          }`}>
            <span className="font-semibold">Primary Risk:</span>
            <span className="truncate">{primaryRisk}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden items-center gap-1 text-[9px] text-foreground-400 sm:flex">
            <i className="ri-calendar-line"></i>
            Gateway Review: <strong className="font-semibold text-foreground-600">{learner.gatewayReviewDate}</strong>
          </span>
          <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2.5 py-1.5 text-[10px] font-bold text-primary-700 transition hover:bg-primary-100">
            <i className="ri-profile-line"></i> Profile
          </button>
        </div>
      </footer>
      </div>
    </article>
  );
}

function CardMetric({ value, label, hint = null }: { value: string; label: string; hint?: string | null }) {
  return (
    <div className="rounded-xl bg-background-100/75 px-2 py-2.5 text-center">
      <p className="text-[14px] font-bold text-primary-700">{value}</p>
      <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-wider text-foreground-400">{label}</p>
      {hint && <p className="mt-1 text-[8px] text-foreground-400">{hint}</p>}
    </div>
  );
}

function ReferenceLearnerTable({
  learners,
  selectedLearnerIds,
  onToggleSelect,
  onOpen,
}: {
  learners: Learner[];
  selectedLearnerIds: Set<string>;
  onToggleSelect: (learnerId: string) => void;
  onOpen: (learner: Learner) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-left">
        <thead className="border-b border-foreground-100 bg-background-100/55 text-[9px] uppercase tracking-wider text-foreground-400">
          <tr><th className="w-12 px-4 py-3 text-center">Select</th><th className="px-4 py-3">Learner</th><th>Cohort / Group</th><th>Status</th><th>OTJH</th><th>Attendance</th><th>Components</th><th>KSB</th><th>Progress</th><th>Gateway</th><th></th></tr>
        </thead>
        <tbody className="divide-y divide-foreground-100">
          {learners.map((learner) => {
            const selected = selectedLearnerIds.has(learner.id);
            return (
            <tr key={learner.id} className={`text-[11px] text-foreground-600 hover:bg-primary-50/25 ${selected ? 'bg-primary-50/35' : ''}`}>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(learner.id)}
                  aria-label={`Select ${learner.name}`}
                  className="h-3.5 w-3.5 rounded border-foreground-300 accent-primary-600"
                />
              </td>
              <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-[9px] font-bold text-primary-700">{learner.initials}</span><div><p className="font-bold text-foreground-900">{learner.name}</p><p className="text-[9px] text-foreground-400">{learner.email || learner.employer}</p></div></div></td>
              <td><p>{learner.cohortName}</p><p className="text-[9px] text-foreground-400">{learner.group}</p></td>
              <td><span className={`rounded-full border px-2 py-1 text-[9px] ${getProgramStatusStyle(learner.rawProgramStatus).bg} ${getProgramStatusStyle(learner.rawProgramStatus).text}`}>{displayValue(learner.rawProgramStatus)}</span></td>
              <td className="font-semibold">{formatHoursValue(learner.otjhCompleted)}/{formatHoursValue(learner.otjhTarget)}h</td>
              <td>
                <p className="font-semibold">{formatPercentValue(learner.liveAttendanceRate)}</p>
                <p className="text-[9px] text-foreground-400">{learner.attendanceSessions ? `${learner.attendanceSessions} session${learner.attendanceSessions === 1 ? '' : 's'}` : 'Live metric'}</p>
              </td>
              <td>
                <p className="font-semibold">{formatComponentsValue(learner)}</p>
                <p className="text-[9px] text-foreground-400">{formatComponentsHint(learner) || 'Tracked components'}</p>
              </td>
              <td className="font-semibold">{formatRatio(learner.ksbCompleted, learner.ksbTarget)}</td>
              <td className="font-semibold">{learner.overallProgressAvailable ? `${learner.overallProgress}%` : '--'}</td>
              <td>{learner.gatewayReviewDate}</td>
              <td className="pr-4 text-right"><button type="button" onClick={() => onOpen(learner)} className="rounded-lg bg-primary-50 px-3 py-1.5 font-bold text-primary-700">Profile</button></td>
            </tr>
          )})}
        </tbody>
      </table>
    </div>
  );
}

function ReferencePagination({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-foreground-100 px-4 py-3 sm:flex-row">
      <p className="text-[10px] text-foreground-400">Showing <strong className="text-foreground-700">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</strong> of {total} learners</p>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 disabled:opacity-30"><i className="ri-arrow-left-s-line"></i></button>
        {pages.slice(Math.max(0, page - 3), Math.max(5, page + 2)).map((item) => <button type="button" key={item} onClick={() => onPage(item)} className={`h-8 min-w-8 rounded-lg px-2 text-[10px] font-bold ${item === page ? 'bg-primary-600 text-white' : 'text-foreground-500 hover:bg-background-100'}`}>{item}</button>)}
        <button type="button" disabled={page === totalPages} onClick={() => onPage(page + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 disabled:opacity-30"><i className="ri-arrow-right-s-line"></i></button>
      </div>
      <p className="text-[10px] text-foreground-400">Page {page} of {totalPages}</p>
    </div>
  );
}

function formatExportDate() {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
}

function fitPdfCellText(doc: jsPDF, value: string, maxWidth: number) {
  const safeValue = value || EMPTY_VALUE;
  if (doc.getTextWidth(safeValue) <= maxWidth) return safeValue;

  let text = safeValue;
  while (text.length > 0 && doc.getTextWidth(`${text}...`) > maxWidth) {
    text = text.slice(0, -1);
  }

  return text ? `${text}...` : safeValue;
}

function drawLearnerPdfHeader(doc: jsPDF, columns: { label: string; width: number }[], startX: number, y: number, rowHeight: number) {
  let x = startX;

  doc.setFillColor(244, 239, 255);
  doc.rect(startX, y, columns.reduce((total, column) => total + column.width, 0), rowHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(57, 37, 103);

  columns.forEach((column) => {
    doc.text(column.label, x + 1.5, y + 4.7);
    x += column.width;
  });

  doc.setDrawColor(222, 226, 232);
  doc.line(startX, y + rowHeight, startX + columns.reduce((total, column) => total + column.width, 0), y + rowHeight);
}

function downloadLearnersPdf(learners: Learner[], ownerName: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const marginY = 12;
  const rowHeight = 7;
  const columns = [
    { label: 'Name', width: 28 },
    { label: 'Status', width: 19 },
    { label: 'Coach RAG', width: 17 },
    { label: 'Progress', width: 16 },
    { label: 'OTJH', width: 18 },
    { label: 'Attendance', width: 17 },
    { label: 'Components', width: 20 },
    { label: 'KSB', width: 14 },
    { label: 'Employer', width: 30 },
    { label: 'Cohort', width: 42 },
    { label: 'Group', width: 18 },
  ];

  let y = marginY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(31, 41, 55);
  doc.text('Coach Learners Export', marginX, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Generated ${formatExportDate()} by ${ownerName}`, marginX, y);

  y += 6;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginX, y - 4.5, pageWidth - (marginX * 2), 8, 2, 2, 'F');
  doc.setFontSize(9);
  doc.setTextColor(55, 65, 81);
  doc.text(`Learners included: ${learners.length}`, marginX + 2.5, y + 0.5);

  y += 7.5;
  drawLearnerPdfHeader(doc, columns, marginX, y, rowHeight);
  y += rowHeight;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(31, 41, 55);

  learners.forEach((learner, index) => {
    if (y + rowHeight > pageHeight - marginY) {
      doc.addPage();
      y = marginY;
      drawLearnerPdfHeader(doc, columns, marginX, y, rowHeight);
      y += rowHeight;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(31, 41, 55);
    }

    if (index % 2 === 0) {
      doc.setFillColor(250, 250, 251);
      doc.rect(marginX, y, columns.reduce((total, column) => total + column.width, 0), rowHeight, 'F');
    }

    const row = [
      learner.name,
      displayValue(learner.rawProgramStatus),
      displayValue(learner.coachRag),
      learner.overallProgressAvailable ? `${learner.overallProgress}%` : EMPTY_VALUE,
      formatRatio(learner.otjhCompleted, learner.otjhTarget),
      formatPercentValue(learner.liveAttendanceRate),
      formatComponentsValue(learner),
      learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE,
      learner.employer,
      learner.cohortName,
      learner.group,
    ];

    let x = marginX;
    row.forEach((value, columnIndex) => {
      const column = columns[columnIndex];
      doc.text(fitPdfCellText(doc, value, column.width - 3), x + 1.5, y + 4.5);
      x += column.width;
    });

    doc.setDrawColor(235, 238, 242);
    doc.line(marginX, y + rowHeight, marginX + columns.reduce((total, column) => total + column.width, 0), y + rowHeight);
    y += rowHeight;
  });

  doc.save('coach-learners.pdf');
}

function getMetricCopy(metric: LearnerMetric) {
  switch (metric) {
    case 'otjh':
      return {
        title: 'OTJH',
        icon: 'ri-time-line',
        tone: 'primary',
        tabLabel: 'Open OTJH tab',
        helper: 'Shows recorded off-the-job hours against the learner target.',
      };
    case 'ksb':
      return {
        title: 'KSB',
        icon: 'ri-award-line',
        tone: 'accent',
        tabLabel: 'Open KSB tab',
        helper: 'Shows completed Knowledge, Skills and Behaviours against the mapped target.',
      };
    case 'components':
      return {
        title: 'Components',
        icon: 'ri-stack-line',
        tone: 'emerald',
        tabLabel: 'Open activity details',
        helper: 'Shows completed learning components against the planned components.',
      };
  }
}

function metricPercent(completed?: number, target?: number) {
  if (typeof completed !== 'number' || typeof target !== 'number' || target <= 0) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, (completed / target) * 100)));
}

function metricToneClass(percent: number | null) {
  if (percent === null) return 'bg-foreground-100 text-foreground-500 border-foreground-200';
  if (percent >= 90) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (percent >= 60) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function metricProgressBar(percent: number | null) {
  if (percent === null) return 'bg-foreground-300';
  if (percent >= 90) return 'bg-emerald-500';
  if (percent >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

function MetricDetailPanel({ learner, metric, onOpenFullDetails }: { learner: Learner; metric: LearnerMetric; onOpenFullDetails: () => void }) {
  const copy = getMetricCopy(metric);
  const otjhPercent = metricPercent(learner.otjhCompleted, learner.otjhTarget);
  const ksbPercent = metricPercent(learner.ksbCompleted, learner.ksbTarget);
  const componentPercent = learner.attendanceRateAvailable ? learner.attendanceRate : metricPercent(learner.componentsCompleted, learner.componentsPlanned);
  const percent = metric === 'otjh' ? otjhPercent : metric === 'ksb' ? ksbPercent : componentPercent;
  const primaryValue = metric === 'otjh'
    ? `${formatHoursValue(learner.otjhCompleted)}/${formatHoursValue(learner.otjhTarget)}h`
    : metric === 'ksb'
      ? formatRatio(learner.ksbCompleted, learner.ksbTarget)
      : typeof learner.componentsCompleted === 'number' && typeof learner.componentsPlanned === 'number'
        ? `${learner.componentsCompleted}/${learner.componentsPlanned}`
        : EMPTY_VALUE;
  const status = metric === 'otjh'
    ? displayValue(learner.otjhStatus)
    : metric === 'ksb'
      ? displayValue(learner.ksbStatus)
      : percent === null
        ? EMPTY_VALUE
        : percent >= 90
          ? 'Strong completion'
          : percent >= 60
            ? 'In progress'
            : 'Needs attention';
  const secondaryRows = metric === 'otjh'
    ? [
        ['Completed hours', formatHoursValue(learner.otjhCompleted)],
        ['Target hours', formatHoursValue(learner.otjhTarget)],
        ['Variance', learner.progressVariance || EMPTY_VALUE],
        ['Status', displayValue(learner.otjhStatus)],
      ]
    : metric === 'ksb'
      ? [
          ['Completed KSBs', typeof learner.ksbCompleted === 'number' ? String(learner.ksbCompleted) : EMPTY_VALUE],
          ['Target KSBs', typeof learner.ksbTarget === 'number' ? String(learner.ksbTarget) : EMPTY_VALUE],
          ['Progress', learner.ksbProgressAvailable ? `${learner.ksbProgress}%` : EMPTY_VALUE],
          ['Status', displayValue(learner.ksbStatus)],
        ]
      : [
          ['Completed components', typeof learner.componentsCompleted === 'number' ? String(learner.componentsCompleted) : EMPTY_VALUE],
          ['Planned components', typeof learner.componentsPlanned === 'number' ? String(learner.componentsPlanned) : EMPTY_VALUE],
          ['Completion rate', learner.attendanceRateAvailable ? `${learner.attendanceRate}%` : EMPTY_VALUE],
          ['Status', status],
        ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${copy.tone === 'primary' ? 'bg-primary-100 text-primary-700' : copy.tone === 'accent' ? 'bg-accent-50 text-accent-700' : 'bg-emerald-100 text-emerald-700'}`}>
            <i className={`${copy.icon} text-lg`}></i>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-400">{copy.title}</p>
            <h4 className="mt-1 text-base font-heading font-bold text-foreground-900">{learner.name}</h4>
            <p className="mt-1 text-[12px] text-foreground-500">{learner.cohortName} · {learner.group}</p>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl border p-4 ${metricToneClass(percent)}`}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">Current value</p>
            <p className="mt-1 text-2xl font-heading font-bold">{primaryValue}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-heading font-bold">{percent === null ? EMPTY_VALUE : `${percent}%`}</p>
            <p className="text-[11px] font-semibold">{status}</p>
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-white/70">
          <div className={`h-2 rounded-full ${metricProgressBar(percent)}`} style={{ width: `${percent ?? 0}%` }}></div>
        </div>
      </div>

      <div className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-400">Breakdown</p>
        <div className="mt-3 divide-y divide-foreground-100">
          {secondaryRows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-[12px]">
              <span className="text-foreground-500">{label}</span>
              <span className="font-semibold text-foreground-900">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-primary-100 bg-primary-50/40 p-4">
        <p className="text-[12px] font-medium leading-relaxed text-primary-800">{copy.helper}</p>
        {learner.riskFlags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {learner.riskFlags.slice(0, 4).map(flag => (
              <span key={flag} className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700">{flag}</span>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenFullDetails}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-[13px] font-semibold text-white shadow-lg shadow-primary-500/20 transition-smooth hover:bg-primary-700"
      >
        <i className="ri-external-link-line"></i>
        {copy.tabLabel}
      </button>
    </div>
  );
}

function MiniStatCard({ label, value, icon, color, active = false, onClick }: { label: string; value: string; icon: string; color: string; active?: boolean; onClick?: () => void }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    primary: { bg: 'bg-primary-100', text: 'text-primary-600' },
    accent: { bg: 'bg-accent-50', text: 'text-accent-700' },
    secondary: { bg: 'bg-secondary-100', text: 'text-secondary-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600' },
    foreground: { bg: 'bg-foreground-100', text: 'text-foreground-500' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left card-premium cursor-pointer transition-smooth ${
        active
          ? 'border-primary-300 bg-primary-50/40 shadow-sm'
          : 'border-foreground-200/60 bg-background-50 hover:border-primary-200/80'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-foreground-400 font-medium">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.bg} ${c.text}`}>
          <i className={`${icon} text-xs`}></i>
        </span>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900 mt-1">{value}</p>
    </button>
  );
}

function CoachRagSelector({
  value,
  learnerName,
  isOpen,
  saving,
  onOpenChange,
  onChange,
}: {
  value?: string;
  learnerName: string;
  isOpen: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState({ top: 0, left: 0, width: 96 });
  const selectedValue = getCoachRagOptionValue(value);
  const selectedLabel = formatCoachRagValue(value);
  const selectedStyle = getCoachRagStyle(selectedLabel);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(112, rect.width + 24);
      setMenuRect({
        top: rect.bottom + 6,
        left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2)),
        width,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      onOpenChange(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-allow-selection="true"
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Coach RAG for ${learnerName}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!isOpen);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={`inline-flex min-w-[76px] items-center justify-between gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold shadow-sm transition-smooth hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:cursor-wait disabled:opacity-70 ${selectedStyle.bg} ${selectedStyle.text}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${getCoachRagDotClass(selectedLabel)}`}></span>
          {selectedLabel}
        </span>
        <i className={`text-[11px] ${saving ? 'ri-loader-4-line animate-spin' : isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={`Select Coach RAG for ${learnerName}`}
          className="fixed z-[1000] rounded-xl border border-foreground-200/70 bg-background-50 p-1 shadow-2xl ring-1 ring-foreground-950/5 animate-in fade-in zoom-in-95 duration-150"
          style={{ top: menuRect.top, left: menuRect.left, minWidth: menuRect.width }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {COACH_RAG_OPTIONS.map(option => {
            const optionLabel = formatCoachRagValue(option.label);
            const optionStyle = getCoachRagStyle(optionLabel);
            const isSelected = option.value === selectedValue;

            return (
              <button
                key={option.value || 'empty'}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold transition-smooth ${
                  isSelected
                    ? `${optionStyle.bg} ${optionStyle.text}`
                    : 'text-foreground-700 hover:bg-background-100'
                }`}
                onClick={() => {
                  onChange(option.value);
                  triggerRef.current?.focus();
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${getCoachRagDotClass(optionLabel)}`}></span>
                  {option.label}
                </span>
                {isSelected && <i className="ri-check-line text-[13px]"></i>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

function FilterDropdown({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const allLabelMap: Record<string, string> = {
    Status: 'All Status',
    Cohort: 'All Cohorts',
    Group: 'All Groups',
    'Program Status': 'All Program Status',
    'Coach RAG': 'All Coach RAG',
    RAG: 'All RAG',
  };
  const allLabel = allLabelMap[label] || `All ${label}`;
  return (
    <CaseloadMenuSelect
      value={value}
      onChange={onChange}
      options={[{ value: 'all', label: allLabel }, ...options]}
      minWidth={label === 'Programme' || label === 'Learner Status' ? 'min-w-[150px]' : 'min-w-[132px]'}
    />
  );
}

function CaseloadMenuSelect({
  value,
  onChange,
  options,
  minWidth = 'min-w-[132px]',
  icon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  minWidth?: string;
  icon?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${minWidth}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-10 w-full items-center gap-2 rounded-xl border bg-white px-3.5 text-left text-[11px] font-semibold shadow-sm transition ${
          open
            ? 'border-primary-400 text-foreground-900 ring-2 ring-primary-100'
            : 'border-foreground-200 text-foreground-600 hover:border-primary-300'
        }`}
      >
        {icon && <i className={`${icon} text-[12px] text-foreground-400`}></i>}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <i className={`ri-arrow-down-s-line text-[13px] text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-[80] max-h-64 w-max min-w-full overflow-y-auto rounded-xl border border-foreground-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(28,12,58,0.16)]"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={active}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[11px] transition ${
                  active
                    ? 'bg-primary-50 font-bold text-primary-700'
                    : 'font-medium text-foreground-600 hover:bg-background-100 hover:text-foreground-900'
                }`}
              >
                <span className="flex-1">{option.label}</span>
                {active && <i className="ri-check-line text-[13px]"></i>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThSort({ label, sortKey, current, dir, onClick, className = '', contentClassName = '' }: { label: string; sortKey: string; current: string; dir: string; onClick: () => void; className?: string; contentClassName?: string }) {
  return (
    <th className={`px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground-600 transition-smooth ${className}`} onClick={onClick}>
      <span className={`flex items-center gap-1 ${contentClassName}`}>
        {label}
        <i className={`text-[8px] ${current === sortKey ? (dir === 'asc' ? 'ri-arrow-up-line text-primary-500' : 'ri-arrow-down-line text-primary-500') : 'ri-arrow-up-down-line text-foreground-300'}`}></i>
      </span>
    </th>
  );
}

function RiskRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-background-100/50">
      <span className={`w-2.5 h-2.5 rounded-full ${status === 'Green' ? 'bg-emerald-500' : status === 'Amber' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
      <div>
        <p className="text-[12px] font-medium text-foreground-900">{label}</p>
        <p className="text-[10px] text-foreground-400">{detail}</p>
      </div>
    </div>
  );
}

function ActivityRow({ icon, color, text, subtext }: { icon: string; color: string; text: string; subtext: string }) {
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-100 text-emerald-600', primary: 'bg-primary-100 text-primary-600', secondary: 'bg-secondary-100 text-secondary-600', accent: 'bg-accent-100 text-accent-600', red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600' };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background-100/50">
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${c}`}>
        <i className={`${icon} text-xs`}></i>
      </span>
      <div>
        <p className="text-[12px] font-medium text-foreground-900">{text}</p>
        <p className="text-[10px] text-foreground-400">{subtext}</p>
      </div>
    </div>
  );
}

function OverflowRevealText({ text, maxWidthClass = 'max-w-[240px]' }: { text: string; maxWidthClass?: string }) {
  return (
    <span
      data-allow-selection="true"
      title={text}
      className={`block cursor-text truncate whitespace-nowrap select-text ${maxWidthClass}`}
    >
      {text}
    </span>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    primary: { bg: 'bg-primary-50', text: 'text-primary-700', border: 'border-primary-200/50' },
    accent: { bg: 'bg-accent-50', text: 'text-accent-700', border: 'border-accent-200/50' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200/50' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200/50' },
    red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200/50' },
    secondary: { bg: 'bg-secondary-50', text: 'text-secondary-700', border: 'border-secondary-200/50' },
    foreground: { bg: 'bg-foreground-100', text: 'text-foreground-500', border: 'border-foreground-200/50' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className={`${c.bg} ${c.border} border rounded-xl p-3 text-center`}>
      <p className={`text-lg font-bold ${c.text}`}>{value}</p>
      <p className="text-[9px] text-foreground-400 mt-0.5">{label}</p>
    </div>
  );
}

function MetricRow({ label, value, bar, color }: { label: string; value: string; bar: number; color: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary-500',
    accent: 'bg-accent-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    secondary: 'bg-secondary-500',
    foreground: 'bg-foreground-500',
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-background-100/50 rounded-lg p-3">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[11px] text-foreground-500">{label}</span>
        <span className="text-[11px] font-semibold text-foreground-700">{value}</span>
      </div>
      <div className="w-full bg-background-200 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-700 ${c}`} style={{ width: `${Math.min(100, bar)}%` }}></div>
      </div>
    </div>
  );
}

function StrengthItem({ icon, text, subtext }: { icon: string; text: string; subtext: string }) {
  return (
    <div className="flex items-start gap-3 bg-white rounded-lg p-3 border border-emerald-100">
      <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
        <i className={`${icon} text-emerald-500 text-xs`}></i>
      </span>
      <div>
        <p className="text-[12px] font-semibold text-emerald-800">{text}</p>
        <p className="text-[11px] text-emerald-600/70 mt-0.5">{subtext}</p>
      </div>
    </div>
  );
}

function TimelineItem({ icon, color, date, title, desc }: { icon: string; color: string; date: string; title: string; desc: string }) {
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-100 text-emerald-600', primary: 'bg-primary-100 text-primary-600', secondary: 'bg-secondary-100 text-secondary-600', accent: 'bg-accent-100 text-accent-600', red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600' };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="flex items-center gap-3">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${c}`}>
        <i className={`${icon} text-xs`}></i>
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium text-foreground-900">{title}</p>
          <span className="text-[10px] text-foreground-400 shrink-0 ml-2">{date}</span>
        </div>
        <p className="text-[10px] text-foreground-400">{desc}</p>
      </div>
    </div>
  );
}

function ActionItem({ icon, color, text }: { icon: string; color: string; text: string }) {
  const colorMap: Record<string, string> = { emerald: 'bg-emerald-100 text-emerald-600', primary: 'bg-primary-100 text-primary-600', secondary: 'bg-secondary-100 text-secondary-600', accent: 'bg-accent-100 text-accent-600', red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600' };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="flex items-start gap-3 bg-white rounded-lg p-3 border border-primary-100">
      <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${c}`}>
        <i className={`${icon} text-xs`}></i>
      </span>
      <p className="text-[12px] text-foreground-700 pt-0.5">{text}</p>
    </div>
  );
}
