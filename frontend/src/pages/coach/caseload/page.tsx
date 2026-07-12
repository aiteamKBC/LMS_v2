import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { roleNavMap } from '@/mocks/navigation';

type PerformanceStatus = 'at-risk' | 'on-track' | 'high' | 'new-starter';
type EnrollmentStatus = 'all' | 'active' | 'break' | 'withdrawn' | 'ready-to-enrol' | 'unknown';
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
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
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
  attendanceRate: number;
  otjhCompleted: number;
  otjhTarget: number;
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

const coachNav = roleNavMap.coach;
const THREAD_MAP: Record<string, string> = {};
const EMPLOYER_THREAD_MAP: Record<string, string> = {};
const PAGE_SIZE = 10;
const DEFAULT_COACH_NAME = 'Med Maher';
const DEFAULT_COACH_EMAIL = 'Med.Maher@kentbusinesscollege.com';
const EMPTY_VALUE = '--';
<<<<<<< HEAD
const API_ENDPOINT = '/coach_api/coach/caseload';
=======
const API_ENDPOINT = '/api/coach/caseload';
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)

function displayValue(value?: string | null): string {
  if (!value) return EMPTY_VALUE;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'â€”' || trimmed === '—') return EMPTY_VALUE;
  return trimmed;
}

function normalizeLearner(learner: CaseloadApiLearner): Learner {
  const startDate = displayValue(learner.startDate || learner.lastAttendanceDate);
  const gatewayReviewDate = displayValue(
    learner.gatewayReviewDate || learner.lastProgressReview || learner.lastReview || learner.nextReview,
  );
  const plannedEndDate = displayValue(
    learner.plannedEndDate || learner.nextCoaching || learner.lastCoachingSession,
  );

  return {
    ...learner,
    nextCoaching: displayValue(learner.nextCoaching),
    nextReview: displayValue(learner.nextReview),
    lastContact: displayValue(learner.lastContact),
    lastAttendanceDate: startDate,
    lastProgressReview: gatewayReviewDate,
    lastReview: gatewayReviewDate,
    lastCoachingSession: plannedEndDate,
    lastSubmittedEvidence: displayValue(learner.lastSubmittedEvidence),
    progressVariance: displayValue(learner.progressVariance || '0%'),
    startDate,
    gatewayReviewDate,
    plannedEndDate,
    coachName: displayValue(learner.coachName || DEFAULT_COACH_NAME),
    coachEmail: displayValue(learner.coachEmail || DEFAULT_COACH_EMAIL),
    rawProgramStatus: displayValue(learner.rawProgramStatus),
    coachRag: displayValue(learner.coachRag),
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
  if (normalized === 'break' || normalized === 'onbreak') {
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
  if (normalized === 'break' || normalized === 'onbreak') return 'break';
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
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>('all');
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'name' | 'progress' | 'attendance' | 'ksb' | 'otjh'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [showProgressReport, setShowProgressReport] = useState(false);
  const [showEmployerDropdown, setShowEmployerDropdown] = useState(false);
  const [isTableDragging, setIsTableDragging] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
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
        const response = await fetch(API_ENDPOINT, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data: CaseloadApiResponse = await response.json();
        setOwnerName(data.owner?.name || DEFAULT_COACH_NAME);
        setOwnerEmail(data.owner?.email || DEFAULT_COACH_EMAIL);
        setLearners((data.learners || []).map(normalizeLearner));
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

  const applySummaryFilter = (list: Learner[]) => {
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
  };

  const filtered = useMemo(() => {
    let list = [...learners];
    list = applySummaryFilter(list);
    if (programStatusFilter !== 'all') list = list.filter(l => displayValue(l.rawProgramStatus) === programStatusFilter);
    if (coachRagFilter !== 'all') list = list.filter(l => displayValue(l.coachRag) === coachRagFilter);
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
        case 'attendance': va = a.attendanceRate; vb = b.attendanceRate; break;
        case 'ksb': va = a.ksbProgress; vb = b.ksbProgress; break;
        case 'otjh': va = getOtjhSortValue(a.otjhStatus, a.progressVariance); vb = getOtjhSortValue(b.otjhStatus, b.progressVariance); break;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return list;
  }, [learners, summaryFilter, programStatusFilter, coachRagFilter, cohortFilter, groupFilter, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const selectedLearner = learners.find(learner => learner.id === selectedLearnerId) || null;

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); } else { setSortKey(key); setSortDir('asc'); }
  };

  const handleSummaryCardClick = (filter: SummaryFilter) => {
    setSummaryFilter(current => current === filter ? 'all' : filter);
    setCurrentPage(1);
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

  const handleSendMessage = () => {
    if (!selectedLearner) return;
    const threadId = THREAD_MAP[selectedLearner.name];
    if (threadId) {
      navigate(`/coach/messages?thread=${threadId}`);
    } else {
      navigate('/coach/messages');
    }
  };

  const handleViewProgressReport = () => {
    setShowProgressReport(true);
  };

  const handleContactEmployerMessage = () => {
    if (!selectedLearner) return;
    const threadId = EMPLOYER_THREAD_MAP[selectedLearner.employer];
    if (threadId) {
      navigate(`/coach/messages?thread=${threadId}`);
    } else {
      navigate('/coach/messages');
    }
    setShowEmployerDropdown(false);
  };

  const handleEmailEmployer = () => {
    if (!selectedLearner?.employerEmail) return;
    window.open(`mailto:${selectedLearner.employerEmail}`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleZoomCall = () => {
    if (!selectedLearner?.employerEmail) return;
    window.open(`https://zoom.us/start/videomeeting?email=${encodeURIComponent(selectedLearner.employerEmail)}`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleOutlookCall = () => {
    if (!selectedLearner?.employerEmail) return;
    window.open(`https://outlook.office.com/calendar/deeplink/compose?to=${encodeURIComponent(selectedLearner.employerEmail)}`, '_blank');
    setShowEmployerDropdown(false);
  };

  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    'on-track': { bg: 'bg-emerald-50 border-emerald-200/50', text: 'text-emerald-700', label: 'On Track' },
    'at-risk': { bg: 'bg-red-50 border-red-200/50', text: 'text-red-700', label: 'At Risk' },
    'high': { bg: 'bg-accent-50 border-accent-200/50', text: 'text-accent-700', label: 'High Performer' },
    'new-starter': { bg: 'bg-primary-50 border-primary-200/50', text: 'text-primary-700', label: 'New Starter' },
  };

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
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 md:gap-3">
          <MiniStatCard label="Total" value={String(summaryCounts.total)} icon="ri-group-line" color="primary" active={summaryFilter === 'all'} onClick={() => handleSummaryCardClick('all')} />
          <MiniStatCard label="Active" value={String(summaryCounts.active)} icon="ri-check-double-line" color="emerald" active={summaryFilter === 'active'} onClick={() => handleSummaryCardClick('active')} />
          <MiniStatCard label="Withdrawn" value={String(summaryCounts.withdrawn)} icon="ri-user-unfollow-line" color="foreground" active={summaryFilter === 'withdrawn'} onClick={() => handleSummaryCardClick('withdrawn')} />
          <MiniStatCard label="Break" value={String(summaryCounts.break)} icon="ri-pause-circle-line" color="amber" active={summaryFilter === 'break'} onClick={() => handleSummaryCardClick('break')} />
          <MiniStatCard label="Ready to Enrol" value={String(summaryCounts.readyToEnrol)} icon="ri-user-add-line" color="primary" active={summaryFilter === 'ready-to-enrol'} onClick={() => handleSummaryCardClick('ready-to-enrol')} />
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
                      <ThSort label="Progress" sortKey="progress" current={sortKey} dir={sortDir} onClick={() => handleSort('progress')} className="w-[84px] text-center text-[9px]" contentClassName="justify-center" />
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
                            <span data-allow-selection="true" className={`cursor-text select-text text-[8px] font-semibold px-1.5 py-0.5 rounded-full border ${coachRagStyle.bg} ${coachRagStyle.text} whitespace-nowrap`}>
                              {displayValue(learner.coachRag)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span data-allow-selection="true" className={`cursor-text select-text text-[8px] font-semibold px-1.5 py-0.5 rounded-full border ${programStatusStyle.bg} ${programStatusStyle.text} whitespace-nowrap`}>
                              {displayValue(learner.rawProgramStatus)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div data-allow-selection="true" className="flex min-w-[96px] flex-col items-center gap-0.5 leading-none text-center">
                              <span className={`cursor-text select-text text-[10px] font-semibold tabular-nums whitespace-nowrap ${varianceTextClass}`}>
                                {learner.progressVariance}
                              </span>
                              <span className={`inline-flex items-center gap-1 cursor-text select-text text-[8px] font-medium whitespace-nowrap ${otjhStatusMeta.text}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${otjhStatusMeta.dot}`}></span>
                                {displayValue(learner.otjhStatus)}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div data-allow-selection="true" className="flex min-w-[72px] flex-col items-center gap-0.5 leading-none text-center">
                              <span className="cursor-text select-text text-[10px] font-semibold tabular-nums text-foreground-800 whitespace-nowrap">
                                {formatRatio(learner.ksbCompleted, learner.ksbTarget)}
                              </span>
                              <span className={`inline-flex items-center gap-1 cursor-text select-text text-[8px] font-medium whitespace-nowrap ${ksbStatusMeta.text}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${ksbStatusMeta.dot}`}></span>
                                {displayValue(learner.ksbStatus)}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span data-allow-selection="true" className={`cursor-text select-text text-[10px] font-semibold ${learner.attendanceRate >= 90 ? 'text-emerald-600' : learner.attendanceRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{learner.attendanceRate}%</span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <div className="w-8 bg-background-200 rounded-full h-1.5">
                                <div className={`h-1.5 rounded-full ${learner.status === 'at-risk' ? 'bg-red-500' : learner.status === 'high' ? 'bg-accent-500' : 'bg-primary-500'}`} style={{ width: `${learner.overallProgress}%` }}></div>
                              </div>
                              <span data-allow-selection="true" className="cursor-text select-text text-[10px] font-semibold text-foreground-700 w-6 text-right">{learner.overallProgress}%</span>
                            </div>
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
          onClose={() => { setSelectedLearnerId(null); setShowEmployerDropdown(false); }}
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

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <button className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-chat-smile-2-line mr-1.5"></i> Start Coaching Session
                </button>
                <button onClick={handleViewProgressReport} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap text-center">
                  <i className="ri-file-chart-line mr-1.5"></i> View Full Progress Report
                </button>
                <button onClick={handleSendMessage} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap text-center">
                  <i className="ri-mail-line mr-1.5"></i> Send Message
                </button>
                <div className="relative">
                  <button onClick={() => setShowEmployerDropdown(!showEmployerDropdown)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap text-center flex items-center justify-center gap-1">
                    <i className="ri-building-2-line mr-1.5"></i> Contact Employer
                    <i className={`ri-arrow-down-s-line text-xs transition-transform ${showEmployerDropdown ? 'rotate-180' : ''}`}></i>
                  </button>
                  {showEmployerDropdown && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 bg-background-50 rounded-xl border border-background-200 shadow-xl overflow-hidden z-50">
                      <button onClick={handleContactEmployerMessage} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer">
                        <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600"><i className="ri-message-3-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Send Message</p>
                          <p className="text-[10px] text-foreground-400">Open in-app chat</p>
                        </div>
                      </button>
                      <button onClick={handleEmailEmployer} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                        <span className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center text-accent-600"><i className="ri-mail-send-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Email</p>
                          <p className="text-[10px] text-foreground-400">{selectedLearner.employerEmail || 'No employer email available'}</p>
                        </div>
                      </button>
                      <button onClick={handleZoomCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                        <span className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600"><i className="ri-video-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Call via Zoom</p>
                          <p className="text-[10px] text-foreground-400">Start video meeting</p>
                        </div>
                      </button>
                      <button onClick={handleOutlookCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                        <span className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600"><i className="ri-calendar-event-line text-xs"></i></span>
                        <div>
                          <p className="font-medium">Schedule via Outlook</p>
                          <p className="text-[10px] text-foreground-400">Book calendar meeting</p>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
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
                    <TimelineItem icon="ri-calendar-check-line" color="emerald" date={selectedLearner.startDate} title="Learner Start" desc="Start date pulled from the Aptem extraction table" />
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
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-2.5 pr-7 py-1.5 bg-background-100 border border-foreground-200 rounded-lg text-[11px] font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300"
      >
        <option value="all">{allLabel}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <i className="ri-arrow-down-s-line absolute right-1.5 top-1/2 -translate-y-1/2 text-foreground-400 text-[10px] pointer-events-none"></i>
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
    <div data-allow-selection="true" className={`group/overflow relative w-fit cursor-text ${maxWidthClass}`}>
      <span className="block cursor-text truncate whitespace-nowrap select-text">{text}</span>
      <div data-allow-selection="true" className="absolute left-0 top-full z-30 mt-1 hidden min-w-full max-w-[420px] cursor-text rounded-lg border border-foreground-200/80 bg-background-50 px-3 py-2 text-[11px] leading-relaxed text-foreground-700 shadow-xl group-hover/overflow:block select-text">
        {text}
      </div>
    </div>
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
