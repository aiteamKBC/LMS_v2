import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import SparklineChart from '@/components/feature/SparklineChart';
import { roleNavMap } from '@/mocks/navigation';
import TrendChart from './components/TrendChart';
import RiskPieChart from './components/RiskPieChart';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/attendance';
const ATTENDANCE_DETAILS_ENDPOINT = '/coach_api/coach/attendance/details';
const MISSING_VALUE = '--';

type RiskTone = 'red' | 'amber' | 'green' | null;
type TrendView = 'week' | 'month' | 'year';
type AttendanceKpi = 'average' | 'on-track' | 'at-risk' | 'needs-attention' | 'catchups';
type AttendanceDetailFilter = 'all' | 'present' | 'absent';

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
    <button type="button" onClick={onClick} className={`bg-background-50 rounded-xl border p-4 flex flex-col gap-2 text-left hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary-300/40 transition-smooth cursor-pointer ${borderMap[tone]}`}>
      <div className="flex items-center justify-between">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        {hint && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${toneMap[tone]}`}>{hint}</span>}
      </div>
      <div>
        <p className={`text-2xl font-heading font-bold ${tone === 'primary' ? 'text-foreground-900' : tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-amber-600'}`}>{value}</p>
        <p className="text-[10px] text-foreground-400">{label}</p>
      </div>
    </button>
  );
}

export default function CoachAttendance() {

  const [learners, setLearners] = useState<AttendanceLearner[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary>(EMPTY_SUMMARY);
  const [trends, setTrends] = useState<Record<TrendView, TrendPoint[]>>({ week: [], month: [], year: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cohortFilter, setCohortFilter] = useState('all');
  const [programmeFilter, setProgrammeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [trendView, setTrendView] = useState<TrendView>('week');
  const [trendCount, setTrendCount] = useState(12);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(8);
  const [selectedKpi, setSelectedKpi] = useState<AttendanceKpi | null>(null);
  const [selectedAttendanceLearner, setSelectedAttendanceLearner] = useState<AttendanceLearner | null>(null);
  const [attendanceDetailFilter, setAttendanceDetailFilter] = useState<AttendanceDetailFilter>('all');
  const [attendanceDetails, setAttendanceDetails] = useState<AttendanceSessionDetail[]>([]);
  const [attendanceDetailsLoading, setAttendanceDetailsLoading] = useState(false);
  const [attendanceDetailsError, setAttendanceDetailsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAttendance() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(API_ENDPOINT);
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
  }, []);

  const cohorts = useMemo(() => [...new Set(learners.map(l => l.cohort).filter(Boolean))].sort(), [learners]);
  const programmes = useMemo(() => [...new Set(learners.map(l => l.programme).filter(Boolean))].sort(), [learners]);
  const groups = useMemo(() => [...new Set(learners.map(l => l.group).filter(Boolean))].sort(), [learners]);

  const filteredData = useMemo(() => {
    let data = learners;
    if (cohortFilter !== 'all') data = data.filter(l => l.cohort === cohortFilter);
    if (programmeFilter !== 'all') data = data.filter(l => l.programme === programmeFilter);
    if (groupFilter !== 'all') data = data.filter(l => l.group === groupFilter);
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
  }, [learners, cohortFilter, programmeFilter, groupFilter, searchQuery, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const trendData = useMemo(() => {
    const base = trends[trendView] || [];
    return base.slice(-Math.min(trendCount, base.length));
  }, [trends, trendView, trendCount]);

  const attendanceTrendValues = useMemo(() => {
    const values = trendData.map(point => Math.max(0, 100 - point.value));
    return values.length ? values : [summary.averageAttendance || 0];
  }, [trendData, summary.averageAttendance]);

  const trendUp = attendanceTrendValues.length >= 2 && attendanceTrendValues[attendanceTrendValues.length - 1] >= attendanceTrendValues[0];
  const knownLearnerCount = summary.learnersWithAttendance;
  const trendMax = Math.max(30, Math.min(100, Math.ceil((Math.max(...trendData.map(point => point.value), 0) + 5) / 10) * 10));
  const maxCount = trendView === 'week' ? Math.max(1, trends.week.length || 52) : trendView === 'month' ? Math.max(1, trends.month.length || 12) : Math.max(1, trends.year.length || 4);
  const countLabel = trendView === 'week' ? 'Weeks' : trendView === 'month' ? 'Months' : 'Years';
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
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Attendance Dashboard" pageSubtitle="Attendance overview from KBC attendance records" userName="Med Maher" userRole="Progress Coach">
      <div className="p-4 md:p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-5">
              <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <i className="ri-calendar-2-line text-white text-2xl"></i>
              </span>
              <div className="flex-1">
                <h2 className="text-lg font-heading font-bold text-white mb-1">Attendance Dashboard</h2>
                <p className="text-[13px] text-white/80 leading-relaxed">
                  Average attendance: <strong>{formatPercent(summary.averageAttendance)}</strong> across {summary.activeLearners ?? summary.totalLearners} active learners
                  {(summary.onBreakLearners || 0) > 0 ? ` + ${summary.onBreakLearners} on break` : ''} ({summary.learnersWithAttendance} with attendance records) in {summary.cohortCount} cohorts.
                  {' '}{summary.totalPresent} present out of {summary.totalSessions} sessions, {summary.totalAbsent} absences.
                  {' '}{summary.atRisk} at risk, {summary.needsAttention} need attention, {summary.onTrack} on track.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button type="button" onClick={() => setSelectedKpi('average')} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col gap-2 text-left hover:border-primary-300/40 hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary-300/40 transition-smooth cursor-pointer">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center">
                <i className="ri-bar-chart-line text-primary-600 text-sm"></i>
              </span>
              <div className="w-20 h-8">
                <SparklineChart data={attendanceTrendValues.slice(-6)} color={(summary.averageAttendance || 0) >= 90 ? 'emerald' : (summary.averageAttendance || 0) >= 80 ? 'amber' : 'red'} width={80} height={32} showDots={false} showFill={false} />
              </div>
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-foreground-900">{formatPercent(summary.averageAttendance)}</p>
              <p className="text-[10px] text-foreground-400">Average Attendance</p>
              <div className="flex items-center gap-1 mt-1">
                <i className={`${trendUp ? 'ri-arrow-up-line text-emerald-500' : 'ri-arrow-down-line text-red-500'} text-[10px]`}></i>
                <span className={`text-[10px] font-medium ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>{trendData.length ? (trendUp ? 'Improving' : 'Declining') : MISSING_VALUE}</span>
              </div>
            </div>
          </button>
          <StatCard icon="ri-check-double-line" label="On Track (90%+)" value={formatCount(summary.onTrack)} hint={percentOf(summary.onTrack, knownLearnerCount)} tone="emerald" onClick={() => setSelectedKpi('on-track')} />
          <StatCard icon="ri-error-warning-line" label="At Risk (<80%)" value={formatCount(summary.atRisk)} hint={percentOf(summary.atRisk, knownLearnerCount)} tone="red" onClick={() => setSelectedKpi('at-risk')} />
          <StatCard icon="ri-alert-line" label="Needs Attention (80-89%)" value={formatCount(summary.needsAttention)} hint={percentOf(summary.needsAttention, knownLearnerCount)} tone="amber" onClick={() => setSelectedKpi('needs-attention')} />
          <StatCard icon="ri-timer-line" label="Catch-ups Pending" value={formatCount(summary.catchupsPending)} hint={summary.overdueCatchups === null ? MISSING_VALUE : `${summary.overdueCatchups} overdue`} tone="amber" onClick={() => setSelectedKpi('catchups')} />
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-w-0 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
                    <i className="ri-line-chart-line text-accent-600 text-sm"></i>
                  </span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Absence Trend</h3>
                    <p className="text-[10px] text-foreground-400">Absence rate from kbc_attendance over time</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-background-100 rounded-lg p-1">
                    {(['week', 'month', 'year'] as TrendView[]).map(view => (
                      <button key={view} onClick={() => setTrendView(view)} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${trendView === view ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                        {view === 'week' ? 'Week' : view === 'month' ? 'Month' : 'Year'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-foreground-400">Show</span>
                    <input type="number" min={1} max={maxCount} value={trendCount} onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (val >= 1 && val <= maxCount) setTrendCount(val);
                    }} className="w-12 px-2 py-1 bg-background-100 border border-foreground-200 rounded-md text-[11px] text-center text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50" />
                    <span className="text-[10px] text-foreground-400">{countLabel}</span>
                  </div>
                </div>
              </div>

              {trendData.length ? (
                <TrendChart data={trendData} height={260} color="red" yAxisMax={trendMax} yAxisMin={0} />
              ) : (
                <div className="h-[260px] flex items-center justify-center text-sm text-foreground-400">No attendance trend records yet.</div>
              )}
            </div>
          </div>

          <div className="lg:w-[280px] shrink-0 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="p-5 flex flex-col items-center h-full">
              <div className="flex items-center gap-2.5 mb-4 self-start">
                <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <i className="ri-pie-chart-line text-red-600 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Risk Distribution</h3>
                  <p className="text-[10px] text-foreground-400">{knownLearnerCount} matched learners</p>
                </div>
              </div>
              {knownLearnerCount ? (
                <RiskPieChart
                  slices={[
                    { label: 'On Track', value: summary.onTrack, color: '#10b981', bgColor: 'bg-emerald-100', textColor: 'text-emerald-700' },
                    { label: 'Needs Attention', value: summary.needsAttention, color: '#f59e0b', bgColor: 'bg-amber-100', textColor: 'text-amber-700' },
                    { label: 'At Risk', value: summary.atRisk, color: '#ef4444', bgColor: 'bg-red-100', textColor: 'text-red-700' },
                  ]}
                  total={knownLearnerCount}
                  size={180}
                  innerRadius={48}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-foreground-400">No matched attendance records.</div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
            <div className="relative flex-1 w-full">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
              <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} placeholder="Search learners, programmes, cohorts..." className="w-full pl-9 pr-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50" />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setCurrentPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 cursor-pointer">
                  <i className="ri-close-line text-xs"></i>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <FilterDropdown allLabel="All Cohorts" value={cohortFilter} onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }} options={cohorts} />
              <FilterDropdown allLabel="All Programmes" value={programmeFilter} onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }} options={programmes} />
              <FilterDropdown allLabel="All Groups" value={groupFilter} onChange={(v) => { setGroupFilter(v); setCurrentPage(1); }} options={groups} />
              <div className="flex items-center gap-1">
                <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }} className="px-2 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[10px] text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 w-[115px]" />
                <span className="text-[10px] text-foreground-400">to</span>
                <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }} className="px-2 py-2 bg-background-100 border border-foreground-200 rounded-lg text-[10px] text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 w-[115px]" />
              </div>
              {(cohortFilter !== 'all' || programmeFilter !== 'all' || groupFilter !== 'all' || dateFrom || dateTo || searchQuery) && (
                <button onClick={resetFilters} className="px-2 py-2 rounded-lg text-[11px] text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-close-line mr-1"></i>Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-200/60">
                  <th className="pl-4 pr-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Learner</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Attendance</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Present/Absent</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Catch-up</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Risk</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Last Session</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Consecutive Absences</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {loading && (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-sm text-foreground-400">Loading live attendance data...</td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
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
                    <td colSpan={7} className="py-16 text-center text-sm text-foreground-400">No learners match the current filters.</td>
                  </tr>
                )}
                {!loading && !error && paginatedData.map(row => {
                  return (
                    <tr key={row.id} className="transition-smooth hover:bg-background-100/50">
                      <td className="pl-4 pr-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ring-1.5 ${getAvatarClasses(row.risk)}`}>
                            <span className="text-[11px] font-bold">{row.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-[12px] font-semibold text-foreground-900 truncate">{row.learner}</p>
                              {row.isOnBreak && <span className="shrink-0 text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/70">On Break</span>}
                            </div>
                            <p className="text-[10px] text-foreground-400 truncate">{displayText(row.employer)}</p>
                            <p className="text-[10px] text-foreground-300 truncate">{displayText(row.cohort)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.attendance === null ? (
                          <span className="text-[11px] text-foreground-300">{MISSING_VALUE}</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-12 h-1.5 rounded-full bg-background-200">
                              <div className={`h-full rounded-full ${getAttendanceBar(row.attendance)}`} style={{ width: `${row.attendance}%` }}></div>
                            </div>
                            <span className={`text-[11px] font-semibold ${getAttendanceTone(row.attendance)}`}>{row.attendance}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.present === null || row.absent === null ? (
                          <span className="text-[11px] text-foreground-300">{MISSING_VALUE}</span>
                        ) : (
                          <span className="inline-flex items-center justify-center gap-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => openAttendanceDetails(row, 'present')}
                              className="rounded-md px-1.5 py-0.5 font-semibold text-emerald-600 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-200 cursor-pointer"
                              title="View present sessions"
                            >
                              {row.present}
                            </button>
                            <button
                              type="button"
                              onClick={() => openAttendanceDetails(row, 'all')}
                              className="rounded-md px-0.5 py-0.5 text-foreground-300 hover:bg-background-100 hover:text-foreground-500 focus:outline-none focus:ring-2 focus:ring-primary-200 cursor-pointer"
                              title="View all attendance sessions"
                            >
                              /
                            </button>
                            <button
                              type="button"
                              onClick={() => openAttendanceDetails(row, 'absent')}
                              className="rounded-md px-1.5 py-0.5 font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 cursor-pointer"
                              title="View absent sessions"
                            >
                              {row.absent}
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center"><span className="text-[11px] text-foreground-300">{formatCount(row.catchup)}</span></td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${getDisplayRiskClasses(row)}`}>{getDisplayRiskLabel(row)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center"><span className="text-[11px] text-foreground-500">{displayText(row.lastSession)}</span></td>
                      <td className="px-3 py-2.5 text-center">
                        {row.consecutiveMissed ? (
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${row.consecutiveMissed >= 3 ? 'bg-red-100 text-red-700' : row.consecutiveMissed >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-600'}`}>{row.consecutiveMissed}</span>
                        ) : (
                          <span className="text-[11px] text-foreground-300">{MISSING_VALUE}</span>
                        )}
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
              <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="px-2 py-1 bg-background-100 border border-foreground-200 rounded-lg text-[11px] text-foreground-700 cursor-pointer focus:outline-none">
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
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
                        <p className="text-[9px] text-foreground-400">{selectedKpi === 'catchups' ? `${formatCount(learner.catchup)} catch-up` : `${formatCount(learner.present)}/${formatCount(learner.absent)} present/absent`}</p>
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
