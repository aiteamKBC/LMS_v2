import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import SparklineChart from '@/components/feature/SparklineChart';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useCoachIdentity } from '@/hooks/useCoachIdentity';
import { coachFetch } from '@/lib/coachFetch';
import { roleNavMap } from '@/mocks/navigation';
import { cn } from '@/lib/cn';
import { ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { statusTone, toneStyle, type StatusTone } from '@/lib/statusTone';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MetricCard } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { PageTabs, type PageTabItem } from '@/components/ui/PageTabs';
import { FilterToolbar, SearchInput, FilterSelect } from '@/components/ui/FilterToolbar';
import { Pagination } from '@/components/ui/Pagination';
import { Panel } from '@/components/ui/Panel';
import { ActionRow } from '@/components/ui/ActionRow';
import { LearnerAvatar, LearnerIdentity, ReasonLine } from '@/pages/coach/shared/LearnerIdentity';
import TrendChart from './components/TrendChart';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/attendance';
const ATTENDANCE_DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';
const MISSING_VALUE = '--';
type RiskTone = 'red' | 'amber' | 'green' | null;
type TrendView = 'week' | 'month' | 'year';
type AttendanceKpi = 'average' | 'on-track' | 'at-risk' | 'needs-attention' | 'catchups';
type AttendanceDetailFilter = 'all' | 'present' | 'absent';
type AttendanceRiskFilter = 'all' | 'green' | 'amber' | 'red' | 'break' | 'unknown';

interface AttendanceLearner {
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
  authorisedAbsent?: number | null;
  unauthorisedAbsent?: number | null;
  absenceReasons?: Record<string, number>;
  risk: RiskTone;
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

interface TrendPoint {
  label: string;
  value: number;
  week?: number;
  month?: string;
  sessionDate?: string;
  attended?: number;
  absent?: number;
  onBreak?: number;
}

interface AttendanceSummary {
  totalLearners: number;
  activeLearners?: number;
  onBreakLearners?: number;
  learnersWithAttendance: number;
  cohortCount: number;
  averageAttendance: number | null;
  totalSessions: number;
  totalPresent: number;
  totalAbsent: number;
  onTrack: number;
  needsAttention: number;
  atRisk: number;
  unknown: number;
  catchupsPending: number | null;
  scheduledCatchups: number | null;
  overdueCatchups: number | null;
  absenceReasons?: Record<string, number>;
}

interface AttendanceApiResponse {
  owner?: {
    name?: string;
    email?: string;
  };
  summary?: AttendanceSummary;
  learners?: AttendanceLearner[];
  trends?: Record<TrendView, TrendPoint[]>;
}

interface AttendanceSessionDetail {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  sessionId: string;
  sessionTitle: string;
  sessionType: string;
  sessionDate: string | null;
  sessionDateLabel: string;
  startTime: string;
  endTime: string;
  status: string;
  reason: string;
}

interface AttendanceDetailsResponse {
  summary?: {
    total: number;
    present: number;
    absent: number;
    unknown: number;
  };
  sessions?: AttendanceSessionDetail[];
}

const EMPTY_SUMMARY: AttendanceSummary = {
  totalLearners: 0,
  activeLearners: 0,
  onBreakLearners: 0,
  learnersWithAttendance: 0,
  cohortCount: 0,
  averageAttendance: null,
  totalSessions: 0,
  totalPresent: 0,
  totalAbsent: 0,
  onTrack: 0,
  needsAttention: 0,
  atRisk: 0,
  unknown: 0,
  catchupsPending: null,
  scheduledCatchups: null,
  overdueCatchups: null,
};

function displayText(value?: string | null): string {
  const trimmed = (value || '').trim();
  return trimmed || MISSING_VALUE;
}

function formatCount(value?: number | null): string {
  return value === null || value === undefined ? MISSING_VALUE : String(value);
}

function formatPercent(value?: number | null): string {
  return value === null || value === undefined ? MISSING_VALUE : `${value}%`;
}

function formatSessionTime(startTime?: string | null, endTime?: string | null): string {
  const start = displayText(startTime);
  const end = displayText(endTime);
  if (start === MISSING_VALUE && end === MISSING_VALUE) return MISSING_VALUE;
  if (end === MISSING_VALUE) return start;
  if (start === MISSING_VALUE) return end;
  return `${start} - ${end}`;
}

function attendanceStatusLabel(status?: string | null): string {
  if (status === 'present') return 'Present';
  if (status === 'absent') return 'Absent';
  return displayText(status);
}

function sessionStatusTone(status?: string | null): StatusTone {
  if (status === 'present') return 'positive';
  if (status === 'absent') return 'critical';
  return 'neutral';
}

function percentOf(count: number, total: number): string {
  if (!total) return MISSING_VALUE;
  return `${Math.round((count / total) * 100)}%`;
}

function getRiskLabel(risk: RiskTone): string {
  if (risk === 'green') return 'On Track';
  if (risk === 'amber') return 'Needs Attention';
  if (risk === 'red') return 'At Risk';
  return MISSING_VALUE;
}

function getDisplayRiskLabel(learner: AttendanceLearner): string {
  if (learner.isOnBreak) return 'On Break';
  return getRiskLabel(learner.risk);
}

/**
 * A learner's risk tone. "On break" has no entry of its own in the risk model —
 * it is mapped to `caution`, the same treatment the caseload page gives a
 * break, so the colour a coach reads for "paused, not a problem" is consistent
 * across both screens rather than inventing a fifth slate-grey state here.
 */
function learnerTone(learner: AttendanceLearner): StatusTone {
  if (learner.isOnBreak) return 'caution';
  return statusTone(learner.risk);
}

/** The backend's own attendance thresholds (90% / 80%), mirrored so the tone matches the reason text. */
function rateTone(value?: number | null): StatusTone {
  if (value === null || value === undefined) return 'neutral';
  if (value >= ATTENDANCE_EXPECTED_RATE) return 'positive';
  if (value >= ATTENDANCE_MINIMUM_RATE) return 'caution';
  return 'critical';
}

function exportAttendanceCsv(rows: AttendanceLearner[]) {
  const headers = ['Learner', 'Email', 'Programme', 'Cohort', 'Group', 'Attendance', 'Present', 'Absent', 'Catch-up', 'Risk', 'Last Session'];
  const values = rows.map((row) => [
    row.learner,
    row.email || '',
    row.programme,
    row.cohort,
    row.group,
    row.attendance ?? '',
    row.present ?? '',
    row.absent ?? '',
    row.catchup ?? '',
    getDisplayRiskLabel(row),
    row.lastSession,
  ]);
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [headers, ...values].map((row) => row.map(escape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'learner-attendance.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function optionsFrom(values: string[]): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: value }));
}

export default function CoachAttendance() {
  const navigate = useNavigate();
  const coach = useCoachIdentity();

  const [learners, setLearners] = useState<AttendanceLearner[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary>(EMPTY_SUMMARY);
  const [trends, setTrends] = useState<Record<TrendView, TrendPoint[]>>({ week: [], month: [], year: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cohortFilter, setCohortFilter] = useState('all');
  const [programmeFilter, setProgrammeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [employerFilter, setEmployerFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [trendView, setTrendView] = useState<TrendView>('month');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [selectedKpi, setSelectedKpi] = useState<AttendanceKpi | null>(null);
  const [riskFilter, setRiskFilter] = useState<AttendanceRiskFilter>('all');
  const [selectedAttendanceLearner, setSelectedAttendanceLearner] = useState<AttendanceLearner | null>(null);
  const [attendanceDetailFilter, setAttendanceDetailFilter] = useState<AttendanceDetailFilter>('all');
  const [attendanceDetails, setAttendanceDetails] = useState<AttendanceSessionDetail[]>([]);
  const [attendanceDetailsLoading, setAttendanceDetailsLoading] = useState(false);
  const [attendanceDetailsError, setAttendanceDetailsError] = useState<string | null>(null);

  useEffect(() => {
    if (!coach.isInitialized) return;
    let cancelled = false;

    async function loadAttendance() {
      setLoading(true);
      setError(null);
      if (!coach.email) {
        setError('Coach access is required to load attendance data.');
        setLearners([]);
        setSummary(EMPTY_SUMMARY);
        setLoading(false);
        return;
      }
      try {
        const response = await coachFetch(API_ENDPOINT);
        if (!response.ok) throw new Error(`Request failed with ${response.status}`);
        const data: AttendanceApiResponse = await response.json();
        if (cancelled) return;
        setLearners(data.learners || []);
        setSummary(data.summary || EMPTY_SUMMARY);
        setTrends({
          week: data.trends?.week || [],
          month: data.trends?.month || [],
          year: data.trends?.year || [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load attendance data');
          setLearners([]);
          setSummary(EMPTY_SUMMARY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAttendance();
    return () => {
      cancelled = true;
    };
  }, [coach.email, coach.isInitialized]);

  const cohorts = useMemo(() => [...new Set(learners.map(l => l.cohort).filter(Boolean))].sort(), [learners]);
  const programmes = useMemo(() => [...new Set(learners.map(l => l.programme).filter(Boolean))].sort(), [learners]);
  const employers = useMemo(() => [...new Set(learners.map(l => l.employer).filter(Boolean))].sort(), [learners]);

  const filteredData = useMemo(() => {
    let data = learners;
    if (cohortFilter !== 'all') data = data.filter(l => l.cohort === cohortFilter);
    if (programmeFilter !== 'all') data = data.filter(l => l.programme === programmeFilter);
    if (groupFilter !== 'all') data = data.filter(l => l.group === groupFilter);
    if (employerFilter !== 'all') data = data.filter(l => l.employer === employerFilter);
    if (riskFilter === 'break') data = data.filter(l => l.isOnBreak);
    else if (riskFilter === 'unknown') data = data.filter(l => !l.isOnBreak && l.risk === null);
    else if (riskFilter !== 'all') data = data.filter(l => !l.isOnBreak && l.risk === riskFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(l => [l.learner, l.initials, l.email || '', l.employer, l.programme, l.cohort, l.group].some(value => value.toLowerCase().includes(q)));
    }
    if (dateFrom || dateTo) {
      data = data.filter(l => {
        if (!l.lastSessionDate) return false;
        if (dateFrom && l.lastSessionDate < dateFrom) return false;
        if (dateTo && l.lastSessionDate > dateTo) return false;
        return true;
      });
    }
    return data;
  }, [learners, cohortFilter, programmeFilter, groupFilter, employerFilter, riskFilter, searchQuery, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const trendData = useMemo(() => {
    const base = trends[trendView] || [];
    return base.slice(-Math.min(12, base.length));
  }, [trends, trendView]);

  const attendanceTrendValues = useMemo(() => {
    const values = trendData.map(point => Math.max(0, 100 - point.value));
    return values.length ? values : [summary.averageAttendance || 0];
  }, [trendData, summary.averageAttendance]);
  const attendanceTrendData = useMemo(
    () => trendData.map((point) => ({ ...point, value: Math.max(0, 100 - point.value) })),
    [trendData],
  );
  const attendanceDistribution = useMemo(() => {
    return [
      { label: 'On Track (90%+)', value: summary.onTrack, color: '#10b981' },
      { label: 'At Risk (<80%)', value: summary.atRisk, color: '#ef4444' },
      { label: 'Needs Attention (80–89%)', value: summary.needsAttention, color: '#f59e0b' },
    ];
  }, [summary.onTrack, summary.atRisk, summary.needsAttention]);
  const attendanceDistributionTotal = attendanceDistribution.reduce((total, item) => total + item.value, 0);
  const attendanceDistributionGradient = useMemo(() => {
    if (!attendanceDistributionTotal) return 'conic-gradient(#e5e7eb 0 100%)';
    let cursor = 0;
    const stops = attendanceDistribution.map((item) => {
      const start = cursor;
      cursor += (item.value / attendanceDistributionTotal) * 100;
      return `${item.color} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [attendanceDistribution, attendanceDistributionTotal]);
  const trendUp = attendanceTrendValues.length >= 2 && attendanceTrendValues[attendanceTrendValues.length - 1] >= attendanceTrendValues[0];
  const knownLearnerCount = summary.learnersWithAttendance;
  const atRiskLearners = filteredData.filter((learner) => learner.risk === 'red' && !learner.isOnBreak).slice(0, 5);
  const kpiLearners = selectedKpi === 'average'
    ? learners.filter(learner => learner.hasAttendance)
    : selectedKpi === 'on-track'
      ? learners.filter(learner => learner.risk === 'green' && learner.includedInAttendanceMetrics)
      : selectedKpi === 'at-risk'
        ? learners.filter(learner => learner.risk === 'red' && learner.includedInAttendanceMetrics)
        : selectedKpi === 'needs-attention'
          ? learners.filter(learner => learner.risk === 'amber' && learner.includedInAttendanceMetrics)
          : selectedKpi === 'catchups'
            ? learners.filter(learner => (learner.catchup || 0) > 0)
            : [];
  const kpiTitle: Record<AttendanceKpi, string> = {
    average: 'Learner attendance',
    'on-track': 'On-track learners',
    'at-risk': 'Learners at risk',
    'needs-attention': 'Learners needing attention',
    catchups: 'Learners with catch-ups',
  };
  const filteredAttendanceDetails = useMemo(() => {
    if (attendanceDetailFilter === 'all') {
      return attendanceDetails;
    }
    return attendanceDetails.filter((item) => item.status === attendanceDetailFilter);
  }, [attendanceDetails, attendanceDetailFilter]);

  const attendanceDetailCounts = useMemo(() => ({
    all: attendanceDetails.length,
    present: attendanceDetails.filter((item) => item.status === 'present').length,
    absent: attendanceDetails.filter((item) => item.status === 'absent').length,
  }), [attendanceDetails]);
  const hasActiveFilters = Boolean(
    cohortFilter !== 'all'
    || programmeFilter !== 'all'
    || groupFilter !== 'all'
    || employerFilter !== 'all'
    || riskFilter !== 'all'
    || dateFrom
    || dateTo
    || searchQuery.trim()
  );

  const openAttendanceDetails = async (learner: AttendanceLearner, filter: AttendanceDetailFilter) => {
    setSelectedAttendanceLearner(learner);
    setAttendanceDetailFilter(filter);
    setAttendanceDetails([]);
    setAttendanceDetailsError(null);
    setAttendanceDetailsLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('learner_id', learner.id);
      if (learner.email) {
        params.set('learner_email', learner.email);
      }
      const response = await coachFetch(`${ATTENDANCE_DETAILS_ENDPOINT}?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Request failed with ${response.status}`);
      }
      const payload: AttendanceDetailsResponse = await response.json();
      setAttendanceDetails(payload.sessions || []);
    } catch (err) {
      setAttendanceDetailsError(err instanceof Error ? err.message : 'Unable to load attendance details.');
    } finally {
      setAttendanceDetailsLoading(false);
    }
  };

  const closeAttendanceDetails = () => {
    setSelectedAttendanceLearner(null);
    setAttendanceDetails([]);
    setAttendanceDetailsError(null);
    setAttendanceDetailsLoading(false);
    setAttendanceDetailFilter('all');
  };

  const resetFilters = () => {
    setCohortFilter('all');
    setProgrammeFilter('all');
    setGroupFilter('all');
    setEmployerFilter('all');
    setRiskFilter('all');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  const riskTabs: PageTabItem[] = [
    { value: 'all', label: 'All Learners', count: summary.totalLearners },
    { value: 'green', label: 'On Track', count: summary.onTrack, tone: 'positive' },
    { value: 'amber', label: 'Needs Attention', count: summary.needsAttention, tone: 'caution' },
    { value: 'red', label: 'At Risk', count: summary.atRisk, tone: 'critical' },
    { value: 'break', label: 'On Break', count: summary.onBreakLearners || 0, tone: 'caution', hideWhenEmpty: true },
    { value: 'unknown', label: 'No Data', count: summary.unknown, tone: 'neutral', hideWhenEmpty: true },
  ];

  const columns: DataColumn<AttendanceLearner>[] = [
    {
      key: 'learner',
      label: 'Learner',
      widthClass: 'w-[280px] min-w-[240px]',
      render: (row) => (
        <LearnerIdentity
          name={row.learner}
          programme={`${displayText(row.cohort)} · ${displayText(row.programme)}`}
          meta={displayText(row.email)}
          tone={learnerTone(row)}
          status={(
            <StatusBadge
              tone={row.isOnBreak ? 'caution' : 'positive'}
              label={row.isOnBreak ? 'On Break' : displayText(row.programStatus)}
              size="sm"
              dot={false}
            />
          )}
          onClick={() => navigate(`/coach/attendance/${row.id}`)}
        />
      ),
    },
    {
      key: 'attendance',
      label: 'Attendance',
      widthClass: 'w-[190px] min-w-[170px]',
      render: (row) => {
        if (row.attendance === null) return <span className="text-foreground-400">{MISSING_VALUE}</span>;
        const tone = learnerTone(row);
        return (
          <div className="max-w-[170px]">
            <div className="flex items-center gap-2">
              <span className={cn('text-[15px] font-bold', toneStyle(tone).text)}>{row.attendance}%</span>
              <StatusBadge tone={tone} label={getDisplayRiskLabel(row)} size="sm" />
            </div>
            <ProgressBar percent={row.attendance} tone={toneStyle(tone).dot} className="mt-2" />
          </div>
        );
      },
    },
    {
      key: 'sessions',
      label: 'Present / Absent',
      widthClass: 'w-[200px] min-w-[180px]',
      render: (row) => {
        if (row.present === null || row.absent === null) return <span className="text-foreground-400">{MISSING_VALUE}</span>;
        return (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => openAttendanceDetails(row, 'present')}
              className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold ring-1', toneStyle('positive').bg, toneStyle('positive').text, toneStyle('positive').border)}
            >
              <AppIcon className="ri-check-line"></AppIcon> Present <strong>{row.present}</strong>
            </button>
            <button
              type="button"
              onClick={() => openAttendanceDetails(row, 'absent')}
              className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold ring-1', toneStyle('critical').bg, toneStyle('critical').text, toneStyle('critical').border)}
            >
              <AppIcon className="ri-close-line"></AppIcon> Absent <strong>{row.absent}</strong>
            </button>
            <button type="button" onClick={() => openAttendanceDetails(row, 'all')} className="w-full text-left text-[12px] font-medium text-foreground-400 hover:text-primary-600">
              Total sessions: {row.sessions ?? (row.present + row.absent)}
            </button>
          </div>
        );
      },
    },
    {
      key: 'catchup',
      label: 'Catch-up',
      widthClass: 'w-[170px] min-w-[150px]',
      render: (row) => (
        <div className="space-y-1.5">
          <StatusBadge tone="caution" label={`${formatCount(row.catchup)} recorded`} size="sm" showIcon />
          <p className="truncate text-[12px] text-foreground-400">Next: {displayText(row.nextSession)}</p>
        </div>
      ),
    },
    {
      key: 'consecutive',
      label: 'Consecutive Absences',
      widthClass: 'w-[180px] min-w-[160px]',
      render: (row) => {
        const missed = row.consecutiveMissed || 0;
        const tone: StatusTone = missed >= 2 ? 'critical' : 'neutral';
        return (
          <div>
            <StatusBadge tone={tone} label={`${formatCount(row.consecutiveMissed)} current`} size="sm" showIcon />
            {missed >= 2 ? (
              <p className="mt-1.5 text-[12px] font-medium text-red-600">{missed} consecutive missed sessions</p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'lastSession',
      label: 'Last Session',
      widthClass: 'w-[200px] min-w-[180px]',
      render: (row) => (
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-md bg-background-100 px-2.5 py-1.5 text-[12px] font-semibold text-foreground-700">
            <AppIcon className="ri-calendar-check-line text-primary-500"></AppIcon>{displayText(row.lastSession)}
          </p>
          <button type="button" onClick={() => navigate(`/coach/attendance/${row.id}`)} className="compact-action mt-2 text-[12px] font-bold text-primary-600 transition hover:text-primary-800">
            View profile <AppIcon className="ri-arrow-right-line"></AppIcon>
          </button>
        </div>
      ),
    },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Attendance Dashboard" pageSubtitle="Attendance overview from KBC attendance records" userName={coach.name} userRole="Progress Coach">
      <PageContainer>
        <PageHeader
          title="Learner Attendance"
          description="Monitor attendance, identify absence patterns, and support learners who require intervention."
          icon="ri-calendar-check-line"
          actions={(
            <button
              type="button"
              onClick={() => exportAttendanceCsv(filteredData)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-foreground-200 bg-background-50 px-3.5 text-[12px] font-semibold text-foreground-700 shadow-sm transition hover:border-foreground-300"
            >
              <AppIcon className="ri-download-2-line"></AppIcon>
              Export attendance report
            </button>
          )}
        />

        {/* ===== 1. Attendance health summary ===== */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Average attendance"
            value={formatPercent(summary.averageAttendance)}
            tone={rateTone(summary.averageAttendance)}
            icon="ri-bar-chart-line"
            active={selectedKpi === 'average'}
            onClick={() => setSelectedKpi('average')}
            note={(
              <span className="flex items-center gap-2">
                <span className="h-7 w-16 shrink-0 overflow-hidden rounded-md bg-background-100">
                  <SparklineChart
                    data={attendanceTrendValues.slice(-6)}
                    color={(summary.averageAttendance || 0) >= 90 ? 'emerald' : (summary.averageAttendance || 0) >= 80 ? 'amber' : 'red'}
                    width={64}
                    height={28}
                    showDots={false}
                    showFill={false}
                  />
                </span>
                <span>{trendData.length ? (trendUp ? 'Improving' : 'Declining') : MISSING_VALUE}</span>
              </span>
            )}
          />
          <MetricCard
            label="On track (90%+)"
            value={formatCount(summary.onTrack)}
            tone="positive"
            icon="ri-check-double-line"
            active={selectedKpi === 'on-track'}
            onClick={() => setSelectedKpi('on-track')}
            note={`${percentOf(summary.onTrack, knownLearnerCount)} of tracked learners`}
          />
          <MetricCard
            label="At risk (<80%)"
            value={formatCount(summary.atRisk)}
            tone="critical"
            icon="ri-error-warning-line"
            active={selectedKpi === 'at-risk'}
            onClick={() => setSelectedKpi('at-risk')}
            note={`${percentOf(summary.atRisk, knownLearnerCount)} of tracked learners`}
          />
          <MetricCard
            label="Needs attention (80–89%)"
            value={formatCount(summary.needsAttention)}
            tone="caution"
            icon="ri-alert-line"
            active={selectedKpi === 'needs-attention'}
            onClick={() => setSelectedKpi('needs-attention')}
            note={`${percentOf(summary.needsAttention, knownLearnerCount)} of tracked learners`}
          />
          <MetricCard
            label="Catch-ups pending"
            value={formatCount(summary.catchupsPending)}
            tone="caution"
            icon="ri-timer-line"
            active={selectedKpi === 'catchups'}
            onClick={() => setSelectedKpi('catchups')}
            note={summary.overdueCatchups === null ? MISSING_VALUE : `${summary.overdueCatchups} overdue`}
          />
        </div>

        {/* ===== 2. Filters ===== */}
        <PageTabs
          items={riskTabs}
          value={riskFilter}
          onChange={(next) => { setRiskFilter(next as AttendanceRiskFilter); setCurrentPage(1); }}
          label="Filter learners by attendance risk"
        />

        <FilterToolbar
          search={(
            <SearchInput
              value={searchQuery}
              onChange={(value) => { setSearchQuery(value); setCurrentPage(1); }}
              placeholder="Search by learner, email, programme or employer…"
            />
          )}
          filters={(
            <>
              <FilterSelect
                value={cohortFilter}
                onChange={(value) => { setCohortFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All cohorts' }, ...optionsFrom(cohorts)]}
                widthClass="w-[150px]"
                tone={cohortFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={programmeFilter}
                onChange={(value) => { setProgrammeFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All programmes' }, ...optionsFrom(programmes)]}
                widthClass="w-[160px]"
                tone={programmeFilter !== 'all' ? 'active' : 'default'}
              />
              <FilterSelect
                value={employerFilter}
                onChange={(value) => { setEmployerFilter(value); setCurrentPage(1); }}
                options={[{ value: 'all', label: 'All employers' }, ...optionsFrom(employers)]}
                widthClass="w-[150px]"
                tone={employerFilter !== 'all' ? 'active' : 'default'}
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => { setDateFrom(event.target.value); setCurrentPage(1); }}
                  className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-2.5 text-[12px] text-foreground-700 transition focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200/50"
                />
                <span className="text-[12px] text-foreground-400">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => { setDateTo(event.target.value); setCurrentPage(1); }}
                  className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-2.5 text-[12px] text-foreground-700 transition focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200/50"
                />
              </div>
            </>
          )}
          trailing={hasActiveFilters ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-foreground-500 transition hover:bg-background-100 hover:text-foreground-800"
            >
              <AppIcon className="ri-close-circle-line text-[13px]"></AppIcon>
              Clear filters
            </button>
          ) : undefined}
        />

        {/* ===== 3. Trend / distribution charts ===== */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <SectionHeader
              title="Average attendance trend"
              icon="ri-line-chart-line"
              actions={(
                <select
                  value={trendView}
                  onChange={(event) => setTrendView(event.target.value as TrendView)}
                  className="h-9 rounded-lg border border-foreground-200 bg-background-50 px-3 text-[12px] font-semibold text-foreground-600 focus:border-primary-300 focus:outline-none"
                >
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              )}
            />
            <div className="mt-4">
              {attendanceTrendData.length ? (
                <TrendChart data={attendanceTrendData} height={245} color="primary" yAxisMax={100} yAxisMin={0} />
              ) : (
                <EmptyState variant="empty" size="sm" title="No attendance trend records yet." />
              )}
            </div>
          </Panel>

          <Panel>
            <SectionHeader title="Attendance distribution" icon="ri-pie-chart-line" />
            <div className="mt-4 flex h-[245px] items-center justify-center gap-8 px-2 lg:gap-10 xl:gap-12">
              <div className="relative h-44 w-44 shrink-0 rounded-full" style={{ background: attendanceDistributionGradient }}>
                <div className="absolute inset-[31px] flex items-center justify-center rounded-full bg-background-50">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground-900">{attendanceDistributionTotal}</p>
                    <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-wide text-foreground-400">Learners</p>
                  </div>
                </div>
              </div>
              <div className="w-full max-w-[280px] space-y-2.5">
                {attendanceDistribution.map((bucket) => {
                  const percentage = attendanceDistributionTotal
                    ? Math.round((bucket.value / attendanceDistributionTotal) * 100)
                    : 0;
                  return (
                    <div key={bucket.label} className="flex items-center gap-3 rounded-lg bg-background-100 px-3.5 py-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: bucket.color }}></span>
                      <span className="min-w-0 flex-1 text-[12px] font-medium text-foreground-700">{bucket.label}</span>
                      <span className="text-[13px] font-bold text-foreground-900">{bucket.value}</span>
                      <span className="w-9 text-right text-[12px] text-foreground-400">({percentage}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        </div>

        {/* ===== 4. Learners requiring intervention ===== */}
        {!hasActiveFilters && (
          <section className="space-y-3">
            <SectionHeader
              title="At-risk learners"
              count={atRiskLearners.length}
              icon="ri-alarm-warning-line"
              description="Learners below the attendance minimum, excluding those on a break."
              actions={(
                <button type="button" onClick={() => { setRiskFilter('red'); setCurrentPage(1); }} className="text-[12px] font-semibold text-primary-700 hover:text-primary-800">
                  View all
                </button>
              )}
            />
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {atRiskLearners.length ? atRiskLearners.map((learner) => (
                <ActionRow
                  key={learner.id}
                  tone="critical"
                  leading={<LearnerAvatar name={learner.learner} tone="critical" />}
                  title={learner.learner}
                  meta={(
                    <ReasonLine
                      icon="ri-percent-line"
                      label={`${formatPercent(learner.attendance)} attendance`}
                      detail={learner.consecutiveMissed ? `${learner.consecutiveMissed} consecutive absence${learner.consecutiveMissed === 1 ? '' : 's'}` : null}
                      tone="critical"
                    />
                  )}
                  status={<StatusBadge tone="critical" label="At Risk" size="sm" />}
                />
              )) : (
                <EmptyState variant="no-matches" size="sm" title="No at-risk learners" description="No at-risk learners match the current filters." />
              )}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionHeader title="Learner attendance" count={filteredData.length} icon="ri-table-line" />

          <Panel padding="none">
            <DataTable
              columns={columns}
              rows={paginatedData}
              rowKey={(row) => row.id}
              stickyFirstColumn
              minWidthClass="min-w-[1180px]"
              loading={loading ? <RowsSkeleton rows={6} className="p-4" /> : undefined}
              empty={error ? (
                <EmptyState variant="error" title="Unable to load live attendance data." description={error} />
              ) : (
                <EmptyState variant="no-matches" title="No learners match the current filters." />
              )}
              className="rounded-none border-0 shadow-none"
            />

            {!loading && !error && filteredData.length > 0 ? (
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                total={filteredData.length}
                pageSize={itemsPerPage}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
                noun="learners"
              />
            ) : null}
          </Panel>
        </section>
      </PageContainer>

      {selectedAttendanceLearner && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={closeAttendanceDetails}>
          <div className="absolute inset-0 bg-foreground-950/45 backdrop-blur-sm"></div>
          <div className="relative flex max-h-[84vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50 shadow-sm" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-foreground-100 px-5 py-4">
              <div className="min-w-0">
                <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[12px] font-semibold text-primary-700">
                  <AppIcon className="ri-calendar-check-line text-xs"></AppIcon>
                  Attendance details
                </span>
                <h3 className="truncate text-base font-heading font-bold text-foreground-900">{selectedAttendanceLearner.learner}</h3>
                <p className="mt-0.5 truncate text-[12px] text-foreground-400">
                  {displayText(selectedAttendanceLearner.cohort)} · {displayText(selectedAttendanceLearner.group)}
                </p>
              </div>
              <button type="button" onClick={closeAttendanceDetails} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-foreground-400 hover:bg-background-100 hover:text-foreground-700 cursor-pointer" aria-label="Close attendance details">
                <AppIcon className="ri-close-line text-lg"></AppIcon>
              </button>
            </div>

            <div className="border-b border-foreground-100 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'present', 'absent'] as AttendanceDetailFilter[]).map((filter) => {
                  const count = attendanceDetailCounts[filter];
                  const label = filter === 'all' ? 'All' : filter === 'present' ? 'Present' : 'Absent';
                  const active = attendanceDetailFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setAttendanceDetailFilter(filter)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-[12px] font-semibold transition-smooth cursor-pointer',
                        active
                          ? filter === 'absent'
                            ? 'bg-red-500 text-white shadow-sm'
                            : filter === 'present'
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'bg-primary-500 text-white shadow-sm'
                          : 'bg-background-100 text-foreground-500 hover:bg-background-200',
                      )}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-y-auto p-4">
              {attendanceDetailsLoading ? (
                <div className="min-h-[220px] p-2">
                  <RowsSkeleton rows={5} avatar={false} />
                </div>
              ) : attendanceDetailsError ? (
                <EmptyState variant="error" title="Unable to load attendance details." description={attendanceDetailsError} />
              ) : filteredAttendanceDetails.length ? (
                <div className="space-y-2">
                  {filteredAttendanceDetails.map((session, index) => (
                    <div key={`${session.sessionId}-${session.sessionDate || index}-${index}`} className="rounded-xl border border-foreground-100 bg-background-100/50 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={sessionStatusTone(session.status)} label={attendanceStatusLabel(session.status)} size="sm" />
                            <span className="text-[12px] text-foreground-400">{displayText(session.sessionType)}</span>
                          </div>
                          <p className="mt-2 truncate text-[13px] font-semibold text-foreground-900">{displayText(session.sessionTitle)}</p>
                          <p className="mt-1 text-[12px] text-foreground-400">Session ID: {displayText(session.sessionId)}</p>
                          {session.reason && session.reason !== MISSING_VALUE && (
                            <p className="mt-2 rounded-lg bg-background-50 px-3 py-2 text-[12px] text-foreground-600">Reason: {session.reason}</p>
                          )}
                        </div>
                        <div className="shrink-0 rounded-xl bg-background-50 px-3 py-2 text-left sm:text-right">
                          <p className="text-[12px] font-bold text-foreground-900">{displayText(session.sessionDateLabel)}</p>
                          <p className="mt-0.5 text-[12px] text-foreground-400">{formatSessionTime(session.startTime, session.endTime)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  variant="no-matches"
                  icon="ri-calendar-close-line"
                  title="No sessions found"
                  description={`No ${attendanceDetailFilter === 'all' ? 'attendance' : attendanceDetailFilter} session details were returned for this learner.`}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {selectedKpi && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setSelectedKpi(null)}>
          <div className="absolute inset-0 bg-foreground-950/45 backdrop-blur-sm"></div>
          <div className="relative flex max-h-[80vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50 shadow-sm" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-foreground-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-foreground-900">{kpiTitle[selectedKpi]}</h3>
                <p className="mt-0.5 text-[12px] text-foreground-400">{kpiLearners.length} learner{kpiLearners.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" onClick={() => setSelectedKpi(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700 cursor-pointer" aria-label="Close popup">
                <AppIcon className="ri-close-line text-lg"></AppIcon>
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {kpiLearners.length ? (
                <div className="space-y-2">
                  {kpiLearners.map(learner => (
                    <div key={`${learner.id}-${learner.email || learner.learner}`} className="flex items-center justify-between gap-4 rounded-xl border border-foreground-100 bg-background-100/50 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <LearnerAvatar name={learner.learner} tone={learnerTone(learner)} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-foreground-900">{learner.learner}</p>
                          <p className="truncate text-[12px] text-foreground-400">{learner.cohort} · {learner.group}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cn('text-[12px] font-bold', toneStyle(learnerTone(learner)).text)}>{formatPercent(learner.attendance)}</p>
                        <p className="text-[12px] text-foreground-400">{selectedKpi === 'catchups' ? `${formatCount(learner.catchup)} catch-up` : `${formatCount(learner.present)}/${formatCount(learner.absent)} present/absent`}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState variant="no-matches" size="sm" title="No learners in this category." />
              )}
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
