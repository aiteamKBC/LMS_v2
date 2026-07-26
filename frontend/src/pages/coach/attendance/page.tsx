import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import SparklineChart from '@/components/feature/SparklineChart';
import { roleNavMap } from '@/mocks/navigation';
import TrendChart from './components/TrendChart';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/attendance';
const ATTENDANCE_DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';
const MISSING_VALUE = '--';
const ATTENDANCE_DISTRIBUTION_COLORS = ['#10b981', '#ef4444', '#f59e0b'];

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
  catchupCompleted?: number | null;
  catchupPending?: number | null;
  authorisedAbsent?: number | null;
  unauthorisedAbsent?: number | null;
  authorisationUnknown?: number | null;
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
  filterCounts?: Record<AttendanceRiskFilter, number>;
  filterOptions?: {
    cohorts?: string[];
    programmes?: string[];
    employers?: string[];
    groups?: string[];
  };
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

function attendanceStatusClasses(status?: string | null): string {
  if (status === 'present') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'absent') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-foreground-100 text-foreground-600 border-foreground-200';
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

function getRiskClasses(risk: RiskTone): string {
  if (risk === 'green') return 'bg-emerald-100 text-emerald-700 border-emerald-200/60';
  if (risk === 'amber') return 'bg-amber-100 text-amber-700 border-amber-200/60';
  if (risk === 'red') return 'bg-red-100 text-red-700 border-red-200/60';
  return 'bg-foreground-100 text-foreground-500 border-foreground-200/60';
}

function getDisplayRiskClasses(learner: AttendanceLearner): string {
  if (learner.isOnBreak) return 'bg-slate-100 text-slate-700 border-slate-200/70';
  return getRiskClasses(learner.risk);
}

function getAvatarClasses(risk: RiskTone): string {
  if (risk === 'green') return 'bg-emerald-100 text-emerald-700 ring-emerald-200';
  if (risk === 'amber') return 'bg-amber-100 text-amber-700 ring-amber-200';
  if (risk === 'red') return 'bg-red-100 text-red-700 ring-red-200';
  return 'bg-foreground-100 text-foreground-500 ring-foreground-200';
}

function getAttendanceTone(value?: number | null): string {
  if (value === null || value === undefined) return 'text-foreground-400';
  if (value >= 90) return 'text-emerald-600';
  if (value >= 80) return 'text-amber-600';
  return 'text-red-600';
}

function getAttendanceBar(value?: number | null): string {
  if (value === null || value === undefined) return 'bg-foreground-300';
  if (value >= 90) return 'bg-emerald-500';
  if (value >= 80) return 'bg-amber-500';
  return 'bg-red-500';
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

function FilterDropdown({ value, onChange, options, allLabel }: { value: string; onChange: (v: string) => void; options: string[]; allLabel: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className="appearance-none pl-3 pr-8 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 min-w-[160px]">
        <option value="all">{allLabel}</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-xs pointer-events-none"></i>
    </div>
  );
}

function StatCard({ icon, label, value, hint, tone = 'primary', onClick }: { icon: string; label: string; value: string; hint?: string; tone?: 'primary' | 'emerald' | 'red' | 'amber'; onClick?: () => void }) {
  const toneMap: Record<'primary' | 'emerald' | 'red' | 'amber', string> = {
    primary: 'bg-primary-100 text-primary-600 border-primary-200/40',
    emerald: 'bg-emerald-100 text-emerald-600 border-emerald-200/40',
    red: 'bg-red-100 text-red-600 border-red-200/40',
    amber: 'bg-amber-100 text-amber-600 border-amber-200/40',
  };
  const borderMap: Record<'primary' | 'emerald' | 'red' | 'amber', string> = {
    primary: 'border-primary-200/40',
    emerald: 'border-emerald-200/40',
    red: 'border-red-200/40',
    amber: 'border-amber-200/40',
  };

  return (
    <button type="button" onClick={onClick} className={`flex min-h-[92px] flex-col gap-1.5 rounded-xl border bg-white p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-300/40 cursor-pointer ${borderMap[tone]}`}>
      <div className="flex items-center justify-between">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneMap[tone]}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        {hint && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${toneMap[tone]}`}>{hint}</span>}
      </div>
      <div>
        <p className={`text-xl font-heading font-bold ${tone === 'primary' ? 'text-foreground-900' : tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-amber-600'}`}>{value}</p>
        <p className="text-[10px] text-foreground-400">{label}</p>
      </div>
    </button>
  );
}

export default function CoachAttendance() {
  const navigate = useNavigate();

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
  const [trendView, setTrendView] = useState<TrendView>('week');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedKpi, setSelectedKpi] = useState<AttendanceKpi | null>(null);
  const [riskFilter, setRiskFilter] = useState<AttendanceRiskFilter>('all');
  const [selectedAttendanceLearner, setSelectedAttendanceLearner] = useState<AttendanceLearner | null>(null);
  const [attendanceDetailFilter, setAttendanceDetailFilter] = useState<AttendanceDetailFilter>('all');
  const [attendanceDetails, setAttendanceDetails] = useState<AttendanceSessionDetail[]>([]);
  const [attendanceDetailsLoading, setAttendanceDetailsLoading] = useState(false);
  const [attendanceDetailsError, setAttendanceDetailsError] = useState<string | null>(null);
  const [filterCounts, setFilterCounts] = useState<Record<AttendanceRiskFilter, number>>({
    all: 0,
    green: 0,
    amber: 0,
    red: 0,
    break: 0,
    unknown: 0,
  });
  const [filterOptions, setFilterOptions] = useState({
    cohorts: [] as string[],
    programmes: [] as string[],
    employers: [] as string[],
    groups: [] as string[],
  });

  useEffect(() => {
    let cancelled = false;

    async function loadAttendance() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (cohortFilter !== 'all') params.set('cohort', cohortFilter);
        if (programmeFilter !== 'all') params.set('programme', programmeFilter);
        if (groupFilter !== 'all') params.set('group', groupFilter);
        if (employerFilter !== 'all') params.set('employer', employerFilter);
        if (riskFilter !== 'all') params.set('risk', riskFilter);
        if (searchQuery.trim()) params.set('search', searchQuery.trim());
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        const response = await fetch(`${API_ENDPOINT}${params.size ? `?${params.toString()}` : ''}`);
        const data = await response.json().catch(() => ({})) as AttendanceApiResponse & { detail?: string };
        if (!response.ok) throw new Error(data.detail || `Request failed with ${response.status}`);
        if (cancelled) return;
        setLearners(data.learners || []);
        setSummary(data.summary || EMPTY_SUMMARY);
        setTrends({
          week: data.trends?.week || [],
          month: data.trends?.month || [],
          year: data.trends?.year || [],
        });
        setFilterCounts({
          all: data.filterCounts?.all || 0,
          green: data.filterCounts?.green || 0,
          amber: data.filterCounts?.amber || 0,
          red: data.filterCounts?.red || 0,
          break: data.filterCounts?.break || 0,
          unknown: data.filterCounts?.unknown || 0,
        });
        setFilterOptions({
          cohorts: data.filterOptions?.cohorts || [],
          programmes: data.filterOptions?.programmes || [],
          employers: data.filterOptions?.employers || [],
          groups: data.filterOptions?.groups || [],
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

    const timer = window.setTimeout(loadAttendance, searchQuery.trim() ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cohortFilter, programmeFilter, groupFilter, employerFilter, riskFilter, searchQuery, dateFrom, dateTo]);

  const filteredData = useMemo(() => {
    return learners;
  }, [learners]);

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
      { label: 'Needs Attention (80–89%)', value: summary.needsAttention, color: 'bg-amber-500' },
    ];
  }, [summary.onTrack, summary.atRisk, summary.needsAttention]);
  const attendanceDistributionTotal = useMemo(
    () => attendanceDistribution.reduce((total, item) => total + item.value, 0),
    [attendanceDistribution],
  );
  const attendanceDistributionGradient = useMemo(() => {
    if (!attendanceDistributionTotal) return 'conic-gradient(#e5e7eb 0 100%)';
    let cursor = 0;
    const stops = attendanceDistribution.map((item, index) => {
      const start = cursor;
      cursor += (item.value / attendanceDistributionTotal) * 100;
      return `${ATTENDANCE_DISTRIBUTION_COLORS[index]} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [attendanceDistribution, attendanceDistributionTotal]);
  const trendDirection = attendanceTrendValues.length < 2
    ? null
    : attendanceTrendValues[attendanceTrendValues.length - 1] > attendanceTrendValues[0]
      ? 'improving'
      : attendanceTrendValues[attendanceTrendValues.length - 1] < attendanceTrendValues[0]
        ? 'declining'
        : 'stable';
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
            ? learners.filter(learner => (learner.catchupPending || 0) > 0)
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
      const response = await fetch(`${ATTENDANCE_DETAILS_ENDPOINT}?${params.toString()}`);
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

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Attendance Dashboard" pageSubtitle="Attendance overview from KBC attendance records" userName="Med Maher" userRole="Progress Coach">
      <div className="min-h-screen space-y-4 bg-[#f7f6fb] p-3 md:p-5">
        <section
          className="rounded-2xl border border-white/10 px-6 py-6 text-white shadow-[0_14px_32px_rgba(20,4,46,0.16)]"
          style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] text-white/55">
                <span>Coach Workspace</span>
                <i className="ri-arrow-right-s-line"></i>
                <span className="font-semibold text-white">Attendance</span>
              </div>
              <h1 className="text-2xl font-heading font-bold tracking-[-0.02em] text-white">Learner Attendance</h1>
              <p className="mt-1 max-w-xl text-[12px] leading-5 text-white/70">
                Monitor attendance, identify absence patterns, and support learners who require intervention.
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportAttendanceCsv(filteredData)}
              className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-white/15 bg-white px-4 text-[11px] font-semibold text-primary-800 shadow-sm transition hover:bg-primary-50 lg:self-center"
            >
              <i className="ri-download-2-line"></i>
              Export Attendance Report
            </button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <button type="button" onClick={() => setSelectedKpi('average')} className="flex min-h-[92px] flex-col gap-1.5 rounded-xl border border-foreground-200/60 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-primary-300/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-300/40 cursor-pointer">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100">
                <i className="ri-bar-chart-line text-primary-600 text-sm"></i>
              </span>
              <div className="w-20 h-8">
                <SparklineChart data={attendanceTrendValues.slice(-6)} color={(summary.averageAttendance || 0) >= 90 ? 'emerald' : (summary.averageAttendance || 0) >= 80 ? 'amber' : 'red'} width={80} height={32} showDots={false} showFill={false} />
              </div>
            </div>
            <div>
              <p className="text-xl font-heading font-bold text-foreground-900">{formatPercent(summary.averageAttendance)}</p>
              <p className="text-[10px] text-foreground-400">Average Attendance</p>
              <div className="flex items-center gap-1 mt-1">
                <i className={`${
                  trendDirection === 'improving'
                    ? 'ri-arrow-up-line text-emerald-500'
                    : trendDirection === 'declining'
                      ? 'ri-arrow-down-line text-red-500'
                      : 'ri-subtract-line text-foreground-400'
                } text-[10px]`}></i>
                <span className={`text-[10px] font-medium ${
                  trendDirection === 'improving'
                    ? 'text-emerald-600'
                    : trendDirection === 'declining'
                      ? 'text-red-500'
                      : 'text-foreground-400'
                }`}>
                  {trendDirection === 'improving' ? 'Improving' : trendDirection === 'declining' ? 'Declining' : trendDirection === 'stable' ? 'Stable' : MISSING_VALUE}
                </span>
              </div>
            </div>
          </button>
          <StatCard icon="ri-check-double-line" label="On Track (90%+)" value={formatCount(summary.onTrack)} hint={percentOf(summary.onTrack, knownLearnerCount)} tone="emerald" onClick={() => setSelectedKpi('on-track')} />
          <StatCard icon="ri-error-warning-line" label="At Risk (<80%)" value={formatCount(summary.atRisk)} hint={percentOf(summary.atRisk, knownLearnerCount)} tone="red" onClick={() => setSelectedKpi('at-risk')} />
          <StatCard icon="ri-alert-line" label="Needs Attention (80-89%)" value={formatCount(summary.needsAttention)} hint={percentOf(summary.needsAttention, knownLearnerCount)} tone="amber" onClick={() => setSelectedKpi('needs-attention')} />
          <StatCard icon="ri-timer-line" label="Catch-ups Pending" value={formatCount(summary.catchupsPending)} hint={summary.overdueCatchups === null ? MISSING_VALUE : `${summary.overdueCatchups} overdue`} tone="amber" onClick={() => setSelectedKpi('catchups')} />
        </div>

        <section className="space-y-3 rounded-2xl border border-foreground-200/60 bg-white p-3 shadow-sm">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {([
              ['all', 'All Learners', filterCounts.all, 'ri-group-line'],
              ['green', 'On Track', filterCounts.green, 'ri-check-line'],
              ['amber', 'Needs Attention', filterCounts.amber, 'ri-alert-line'],
              ['red', 'At Risk', filterCounts.red, 'ri-error-warning-line'],
              ['break', 'On Break', filterCounts.break, 'ri-moon-line'],
              ['unknown', 'No Data', filterCounts.unknown, 'ri-question-line'],
            ] as [AttendanceRiskFilter, string, number, string][]).map(([value, label, count, icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setRiskFilter(value); setCurrentPage(1); }}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-semibold transition ${
                  riskFilter === value
                    ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                    : 'border-foreground-200 bg-white text-foreground-600 hover:border-primary-200 hover:text-primary-700'
                }`}
              >
                <i className={icon}></i>
                {label}
                <span className={`rounded-full px-1.5 py-0.5 text-[8px] ${riskFilter === value ? 'bg-white/20' : 'bg-background-100 text-foreground-400'}`}>{count}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
              <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} placeholder="Search by learner, email, programme or employer..." className="h-10 w-full rounded-xl border border-foreground-200 bg-background-50 pl-9 pr-3 text-[11px] text-foreground-700 placeholder:text-foreground-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterDropdown allLabel="All Cohorts" value={cohortFilter} onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }} options={filterOptions.cohorts} />
              <FilterDropdown allLabel="All Programmes" value={programmeFilter} onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }} options={filterOptions.programmes} />
              <FilterDropdown allLabel="All Groups" value={groupFilter} onChange={(v) => { setGroupFilter(v); setCurrentPage(1); }} options={filterOptions.groups} />
              <FilterDropdown allLabel="All Employers" value={employerFilter} onChange={(v) => { setEmployerFilter(v); setCurrentPage(1); }} options={filterOptions.employers} />
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }} className="h-10 rounded-xl border border-foreground-200 bg-background-50 px-3 text-[10px] text-foreground-700 focus:border-primary-300 focus:outline-none" />
              <span className="text-[10px] text-foreground-400">to</span>
              <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }} className="h-10 rounded-xl border border-foreground-200 bg-background-50 px-3 text-[10px] text-foreground-700 focus:border-primary-300 focus:outline-none" />
              {(cohortFilter !== 'all' || programmeFilter !== 'all' || groupFilter !== 'all' || employerFilter !== 'all' || riskFilter !== 'all' || dateFrom || dateTo || searchQuery) && (
                <button onClick={resetFilters} className="h-10 rounded-xl px-3 text-[10px] font-semibold text-foreground-500 hover:bg-background-100 hover:text-foreground-800">Clear Filters</button>
              )}
            </div>
          </div>
        </section>

        <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground-700">
          <i className="ri-arrow-down-s-line"></i>
          Attendance Analytics
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(520px,0.8fr)]">
          <section className="min-h-[330px] rounded-xl border border-foreground-200/60 bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Average Attendance Trend</h3>
              <select value={trendView} onChange={(event) => setTrendView(event.target.value as TrendView)} className="rounded-lg border border-foreground-200 bg-background-50 px-3 py-2 text-[10px] font-semibold text-foreground-600 focus:border-primary-300 focus:outline-none">
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </div>
            {attendanceTrendData.length ? (
              <TrendChart data={attendanceTrendData} height={235} color="primary" yAxisMax={100} yAxisMin={0} />
            ) : (
              <div className="flex h-[235px] items-center justify-center text-[11px] text-foreground-400">No attendance trend records yet.</div>
            )}
          </section>

          <section className="flex min-h-[330px] flex-col rounded-xl border border-foreground-200/60 bg-white p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Distribution</h3>
            <div className="mx-auto mt-4 flex min-h-[250px] w-full flex-1 flex-col items-center justify-center gap-7 sm:flex-row 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_15rem_minmax(0,1fr)] 2xl:gap-8">
              <div
                className="relative h-56 w-56 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)] sm:-translate-x-5 2xl:col-start-2 2xl:h-60 2xl:w-60 2xl:-translate-x-6 2xl:justify-self-center 2xl:self-center"
                style={{ background: attendanceDistributionGradient }}
                role="img"
                aria-label={`Attendance distribution for ${attendanceDistributionTotal} learners`}
              >
                <div className="absolute inset-[42px] flex items-center justify-center rounded-full bg-white shadow-[0_2px_12px_rgba(15,23,42,0.08)] 2xl:inset-[46px]">
                  <div className="text-center">
                    <p className="text-3xl font-heading font-bold text-foreground-900">{attendanceDistributionTotal}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-foreground-400">Learners</p>
                  </div>
                </div>
              </div>

              <div className="w-full max-w-[280px] space-y-2.5 2xl:col-start-3 2xl:justify-self-start 2xl:self-center">
                {attendanceDistribution.map((bucket, index) => (
                  <div key={bucket.label} className="flex items-center justify-between gap-3 rounded-xl border border-foreground-100/60 bg-background-100/50 px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ATTENDANCE_DISTRIBUTION_COLORS[index] }}></span>
                      <span className="truncate text-[10px] font-medium text-foreground-600">{bucket.label}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-[12px] font-bold text-foreground-900">{bucket.value}</span>
                      <span className="ml-1 text-[9px] text-foreground-400">
                        ({attendanceDistributionTotal ? Math.round((bucket.value / attendanceDistributionTotal) * 100) : 0}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div>
          <section className="rounded-xl border border-foreground-200/60 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
                  <i className="ri-alarm-warning-line"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">At-Risk Learners</h3>
                  <p className="text-[10px] text-foreground-400">{atRiskLearners.length} matching the current filters</p>
                </div>
              </div>
              <button type="button" onClick={() => { setRiskFilter('red'); setCurrentPage(1); }} className="text-[10px] font-semibold text-primary-700 hover:text-primary-800">View All</button>
            </div>
            <div className="mt-4 max-h-[230px] space-y-2 overflow-y-auto pr-1">
              {atRiskLearners.length ? atRiskLearners.map((learner) => (
                <div key={learner.id} className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50/60 p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-red-600 ring-1 ring-red-100">{learner.initials}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-bold text-foreground-900">{learner.learner}</p>
                    <p className="mt-0.5 text-[9px] text-red-600">
                      {formatPercent(learner.attendance)} attendance
                      {learner.consecutiveMissed ? ` · ${learner.consecutiveMissed} consecutive absence${learner.consecutiveMissed === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full border border-red-200 bg-white px-2 py-1 text-[8px] font-semibold text-red-600">At Risk</span>
                </div>
              )) : (
                <div className="flex min-h-[150px] items-center justify-center rounded-xl border border-dashed border-foreground-200 text-[11px] text-foreground-400">
                  No at-risk learners match the current filters.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-foreground-100 bg-white px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <i className="ri-table-line text-sm"></i>
              </span>
              <div>
                <p className="text-[12px] font-bold text-foreground-900">Learner attendance records</p>
                <p className="mt-0.5 text-[9px] text-foreground-400">{filteredData.length} learner{filteredData.length === 1 ? '' : 's'} matching the current filters</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[10px] font-medium text-foreground-500">
              Rows:
              <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="h-8 rounded-lg border border-foreground-200 bg-background-50 px-2.5 text-[10px] font-semibold text-foreground-700 focus:border-primary-300 focus:outline-none">
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1380px] text-left">
              <thead className="bg-background-100/80">
                <tr className="border-b border-foreground-200/70">
                  <th className="w-14 px-5 py-3.5"><input type="checkbox" aria-label="Select all learners" className="h-4 w-4 rounded accent-primary-600" /></th>
                  <th className="w-[310px] px-4 py-3.5 text-[9px] font-bold uppercase tracking-[0.08em] text-foreground-500 whitespace-nowrap">Learner</th>
                  <th className="w-[190px] px-4 py-3.5 text-[9px] font-bold uppercase tracking-[0.08em] text-foreground-500 whitespace-nowrap">Attendance</th>
                  <th className="w-[175px] px-4 py-3.5 text-[9px] font-bold uppercase tracking-[0.08em] text-foreground-500 whitespace-nowrap">Present / Absent</th>
                  <th className="w-[250px] px-4 py-3.5 text-[9px] font-bold uppercase tracking-[0.08em] text-foreground-500 whitespace-nowrap">Absence authorisation</th>
                  <th className="w-[170px] px-4 py-3.5 text-[9px] font-bold uppercase tracking-[0.08em] text-foreground-500 whitespace-nowrap">Catch-up</th>
                  <th className="w-[190px] px-4 py-3.5 text-[9px] font-bold uppercase tracking-[0.08em] text-foreground-500 whitespace-nowrap">Consecutive absences</th>
                  <th className="w-[170px] px-4 py-3.5 text-[9px] font-bold uppercase tracking-[0.08em] text-foreground-500 whitespace-nowrap">Last session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {loading && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-sm text-foreground-400">Loading live attendance data...</td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center">
                      <div className="inline-flex flex-col items-center gap-2 text-red-600">
                        <i className="ri-error-warning-line text-2xl"></i>
                        <span className="text-sm font-semibold">Unable to load live attendance data.</span>
                        <span className="text-xs text-foreground-400">{error}</span>
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && !error && paginatedData.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-sm text-foreground-400">No learners match the current filters.</td>
                  </tr>
                )}
                {!loading && !error && paginatedData.map(row => {
                  const rowPadding = 'py-4';
                  return (
                    <tr key={row.id} className="group even:bg-background-100/25 transition-colors hover:bg-primary-50/35">
                      <td className={`px-5 ${rowPadding}`}><input type="checkbox" aria-label={`Select ${row.learner}`} className="h-4 w-4 rounded accent-primary-600" /></td>
                      <td className={`px-4 ${rowPadding}`}>
                        <div className="flex min-w-[285px] items-center gap-3.5">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${getAvatarClasses(row.risk)}`}>
                            <span className="text-[11px] font-bold">{row.initials}</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => navigate(`/coach/attendance/${row.id}`)} className="truncate text-left text-[12px] font-bold text-foreground-900 transition-colors hover:text-primary-700">{row.learner}</button>
                              <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold ${row.isOnBreak ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{row.isOnBreak ? 'On Break' : displayText(row.programStatus)}</span>
                            </div>
                            <p className="mt-0.5 truncate text-[10px] text-foreground-500">{displayText(row.email)}</p>
                            <p className="mt-1 truncate text-[8px] text-foreground-400">{displayText(row.cohort)} <span className="mx-1.5">·</span> {displayText(row.programme)}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 ${rowPadding}`}>
                        {row.attendance === null ? (
                          <span className="text-[12px] text-foreground-300">{MISSING_VALUE}</span>
                        ) : (
                          <div className="min-w-[145px]">
                            <div className="flex items-center gap-2">
                              <span className={`text-[15px] font-bold ${getAttendanceTone(row.attendance)}`}>{row.attendance}%</span>
                              <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold ${getDisplayRiskClasses(row)}`}>{getDisplayRiskLabel(row)}</span>
                            </div>
                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-background-200">
                              <div className={`h-full rounded-full ${getAttendanceBar(row.attendance)}`} style={{ width: `${row.attendance}%` }}></div>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className={`px-4 ${rowPadding}`}>
                        {row.present === null || row.absent === null ? (
                          <span className="text-[12px] text-foreground-300">{MISSING_VALUE}</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button type="button" onClick={() => openAttendanceDetails(row, 'present')} className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[9px] font-semibold text-emerald-700 hover:bg-emerald-100">Present <strong>{row.present}</strong></button>
                            <button type="button" onClick={() => openAttendanceDetails(row, 'absent')} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[9px] font-semibold text-red-700 hover:bg-red-100">Absent <strong>{row.absent}</strong></button>
                            <button type="button" onClick={() => openAttendanceDetails(row, 'all')} className="w-full text-left text-[9px] font-medium text-foreground-400 hover:text-primary-600">Total sessions: {row.sessions ?? (row.present + row.absent)}</button>
                          </div>
                        )}
                      </td>
                      <td className={`px-4 ${rowPadding}`}>
                        <div className="grid grid-cols-3 gap-1.5">
                          <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-center">
                            <p className="text-[8px] font-medium text-emerald-600">Authorised</p>
                            <p className="mt-0.5 text-[11px] font-bold text-emerald-700">{formatCount(row.authorisedAbsent)}</p>
                          </div>
                          <div className="rounded-lg bg-red-50 px-2 py-1.5 text-center">
                            <p className="text-[8px] font-medium text-red-600">Unauthorised</p>
                            <p className="mt-0.5 text-[11px] font-bold text-red-700">{formatCount(row.unauthorisedAbsent)}</p>
                          </div>
                          <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-center">
                            <p className="text-[8px] font-medium text-amber-600">Unreviewed</p>
                            <p className="mt-0.5 text-[11px] font-bold text-amber-700">{formatCount(row.authorisationUnknown)}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 ${rowPadding}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[9px] font-semibold text-emerald-700">Done {formatCount(row.catchupCompleted ?? row.catchup)}</span>
                          <span className="rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] font-semibold text-amber-700">Pending {formatCount(row.catchupPending)}</span>
                        </div>
                        <p className="mt-1.5 text-[9px] text-foreground-400">Next: {displayText(row.nextSession)}</p>
                      </td>
                      <td className={`px-4 ${rowPadding}`}>
                        <span className={`inline-flex rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${(row.consecutiveMissed || 0) >= 2 ? 'bg-red-50 text-red-700' : 'bg-background-100 text-foreground-700'}`}>Current: {formatCount(row.consecutiveMissed)}</span>
                        {(row.consecutiveMissed || 0) >= 2 && <p className="mt-1.5 text-[9px] font-medium text-red-500">{row.consecutiveMissed} consecutive missed sessions</p>}
                      </td>
                      <td className={`px-4 ${rowPadding}`}>
                        <p className="text-[11px] font-bold text-foreground-800">{displayText(row.lastSession)}</p>
                        <button type="button" onClick={() => navigate(`/coach/attendance/${row.id}`)} className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-semibold text-primary-600 hover:text-primary-700">View profile <i className="ri-arrow-right-line"></i></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 bg-background-100/30 border-t border-background-200/30 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-foreground-400">
              <span>Showing {filteredData.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}-{Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} learners</span>
              <span className="text-foreground-300">|</span>
              <span>Page {currentPage} of {totalPages}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-skip-back-line"></i></button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-arrow-left-s-line"></i></button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;
                  return (
                    <button key={pageNum} onClick={() => setCurrentPage(pageNum)} className={`w-7 h-7 rounded-lg text-[11px] font-medium transition-smooth cursor-pointer ${currentPage === pageNum ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:bg-background-200'}`}>{pageNum}</button>
                  );
                })}
              </div>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-arrow-right-s-line"></i></button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"><i className="ri-skip-forward-line"></i></button>
            </div>
          </div>
        </div>
      </div>

      {selectedAttendanceLearner && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={closeAttendanceDetails}>
          <div className="absolute inset-0 bg-foreground-950/45 backdrop-blur-sm"></div>
          <div className="relative flex max-h-[84vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-foreground-100 px-5 py-4">
              <div className="min-w-0">
                <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[10px] font-semibold text-primary-700">
                  <i className="ri-calendar-check-line text-xs"></i>
                  Attendance details
                </span>
                <h3 className="truncate text-base font-heading font-bold text-foreground-900">{selectedAttendanceLearner.learner}</h3>
                <p className="mt-0.5 truncate text-[11px] text-foreground-400">
                  {displayText(selectedAttendanceLearner.cohort)} · {displayText(selectedAttendanceLearner.group)}
                </p>
              </div>
              <button type="button" onClick={closeAttendanceDetails} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-foreground-400 hover:bg-background-100 hover:text-foreground-700 cursor-pointer" aria-label="Close attendance details">
                <i className="ri-close-line text-lg"></i>
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
                      className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-smooth cursor-pointer ${
                        active
                          ? filter === 'absent'
                            ? 'bg-red-500 text-white shadow-sm'
                            : filter === 'present'
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'bg-primary-500 text-white shadow-sm'
                          : 'bg-background-100 text-foreground-500 hover:bg-background-200'
                      }`}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-y-auto p-4">
              {attendanceDetailsLoading ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                    <i className="ri-loader-4-line animate-spin text-lg"></i>
                  </span>
                  <p className="text-[12px] text-foreground-500">Loading attendance sessions...</p>
                </div>
              ) : attendanceDetailsError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-700">
                  {attendanceDetailsError}
                </div>
              ) : filteredAttendanceDetails.length ? (
                <div className="space-y-2">
                  {filteredAttendanceDetails.map((session, index) => (
                    <div key={`${session.sessionId}-${session.sessionDate || index}-${index}`} className="rounded-xl border border-foreground-100 bg-background-100/50 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${attendanceStatusClasses(session.status)}`}>
                              {attendanceStatusLabel(session.status)}
                            </span>
                            <span className="text-[10px] text-foreground-400">{displayText(session.sessionType)}</span>
                          </div>
                          <p className="mt-2 truncate text-[13px] font-semibold text-foreground-900">{displayText(session.sessionTitle)}</p>
                          <p className="mt-1 text-[11px] text-foreground-400">Session ID: {displayText(session.sessionId)}</p>
                          {session.reason && session.reason !== MISSING_VALUE && (
                            <p className="mt-2 rounded-lg bg-background-50 px-3 py-2 text-[11px] text-foreground-600">Reason: {session.reason}</p>
                          )}
                        </div>
                        <div className="shrink-0 rounded-xl bg-background-50 px-3 py-2 text-left sm:text-right">
                          <p className="text-[12px] font-bold text-foreground-900">{displayText(session.sessionDateLabel)}</p>
                          <p className="mt-0.5 text-[11px] text-foreground-400">{formatSessionTime(session.startTime, session.endTime)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-foreground-200 bg-background-100/40 p-6 text-center">
                  <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-background-50 text-foreground-400">
                    <i className="ri-calendar-close-line text-lg"></i>
                  </span>
                  <p className="text-[13px] font-semibold text-foreground-700">No sessions found</p>
                  <p className="mt-1 max-w-sm text-[11px] text-foreground-400">
                    No {attendanceDetailFilter === 'all' ? 'attendance' : attendanceDetailFilter} session details were returned for this learner.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedKpi && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setSelectedKpi(null)}>
          <div className="absolute inset-0 bg-foreground-950/45 backdrop-blur-sm"></div>
          <div className="relative flex max-h-[80vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-foreground-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-foreground-900">{kpiTitle[selectedKpi]}</h3>
                <p className="mt-0.5 text-[11px] text-foreground-400">{kpiLearners.length} learner{kpiLearners.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" onClick={() => setSelectedKpi(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700 cursor-pointer" aria-label="Close popup">
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {kpiLearners.length ? (
                <div className="space-y-2">
                  {kpiLearners.map(learner => (
                    <div key={`${learner.id}-${learner.email || learner.learner}`} className="flex items-center justify-between gap-4 rounded-xl border border-foreground-100 bg-background-100/50 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1 ${getAvatarClasses(learner.risk)}`}>{learner.initials}</span>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-foreground-900">{learner.learner}</p>
                          <p className="truncate text-[10px] text-foreground-400">{learner.cohort} · {learner.group}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-[12px] font-bold ${getAttendanceTone(learner.attendance)}`}>{formatPercent(learner.attendance)}</p>
                        <p className="text-[9px] text-foreground-400">{selectedKpi === 'catchups' ? `${formatCount(learner.catchupPending)} pending catch-up` : `${formatCount(learner.present)}/${formatCount(learner.absent)} present/absent`}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-[12px] text-foreground-400">No learners in this category.</div>
              )}
            </div>
          </div>
        </div>
      )}

    </WorkspaceShell>
  );
}
