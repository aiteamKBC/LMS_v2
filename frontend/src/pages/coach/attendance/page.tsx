import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import SparklineChart from '@/components/feature/SparklineChart';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import TrendChart from './components/TrendChart';
import RiskPieChart from './components/RiskPieChart';

const coachNav = roleNavMap.coach;
const API_ENDPOINT = '/coach_api/coach/attendance';
const MISSING_VALUE = '--';

type RiskTone = 'red' | 'amber' | 'green' | null;
type TrendDirection = 'up' | 'down' | 'stable';
type TrendView = 'week' | 'month' | 'year';

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
  trend: TrendDirection;
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

function safePercentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function DonutChart({ percentage, size = 72, strokeWidth = 6, color = 'primary' }: { percentage: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  const colorMap: Record<string, { stroke: string; text: string }> = {
    primary: { stroke: 'stroke-primary-500', text: 'text-primary-700' },
    accent: { stroke: 'stroke-accent-500', text: 'text-accent-700' },
    emerald: { stroke: 'stroke-emerald-500', text: 'text-emerald-700' },
    amber: { stroke: 'stroke-amber-500', text: 'text-amber-700' },
    red: { stroke: 'stroke-red-500', text: 'text-red-700' },
  };
  const c = colorMap[color] || colorMap.primary;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-background-200" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className={`${c.stroke} transition-all duration-700`} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-bold ${c.text}`}>{percentage}%</span>
      </div>
    </div>
  );
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

function StatCard({ icon, label, value, hint, tone = 'primary' }: { icon: string; label: string; value: string; hint?: string; tone?: 'primary' | 'emerald' | 'red' | 'amber' }) {
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
    <div className={`bg-background-50 rounded-xl border p-4 flex flex-col gap-2 hover:shadow-sm transition-smooth ${borderMap[tone]}`}>
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
    </div>
  );
}

export default function CoachAttendance() {
  const navigate = useNavigate();
  const { success, info } = useToast();

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
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const [trendView, setTrendView] = useState<TrendView>('week');
  const [trendCount, setTrendCount] = useState(12);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(8);

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
  const selectedLearner = learners.find(l => l.id === selectedLearnerId) || null;

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

  const resetFilters = () => {
    setCohortFilter('all');
    setProgrammeFilter('all');
    setGroupFilter('all');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  const handleViewProfile = (learner: AttendanceLearner) => {
    navigate(`/coach/learner-case-file?id=${learner.id}`);
    success('Opening profile', learner.learner);
  };

  const handleSendMessage = (learner: AttendanceLearner) => {
    navigate(`/coach/messages?thread=th-attendance-${learner.id}`);
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
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex flex-col gap-2 hover:border-primary-300/40 transition-smooth">
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
          </div>
          <StatCard icon="ri-check-double-line" label="On Track (90%+)" value={formatCount(summary.onTrack)} hint={percentOf(summary.onTrack, knownLearnerCount)} tone="emerald" />
          <StatCard icon="ri-error-warning-line" label="At Risk (<80%)" value={formatCount(summary.atRisk)} hint={percentOf(summary.atRisk, knownLearnerCount)} tone="red" />
          <StatCard icon="ri-alert-line" label="Needs Attention (80-89%)" value={formatCount(summary.needsAttention)} hint={percentOf(summary.needsAttention, knownLearnerCount)} tone="amber" />
          <StatCard icon="ri-timer-line" label="Catch-ups Pending" value={formatCount(summary.catchupsPending)} hint={summary.overdueCatchups === null ? MISSING_VALUE : `${summary.overdueCatchups} overdue`} tone="amber" />
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
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Trend</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Risk</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Last Session</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Missed in a Row</th>
                  <th className="pr-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {loading && (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-sm text-foreground-400">Loading live attendance data...</td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
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
                    <td colSpan={9} className="py-16 text-center text-sm text-foreground-400">No learners match the current filters.</td>
                  </tr>
                )}
                {!loading && !error && paginatedData.map(row => {
                  const isSel = selectedLearnerId === row.id;
                  return (
                    <tr key={row.id} onClick={() => setSelectedLearnerId(isSel ? null : row.id)} className={`transition-smooth cursor-pointer ${isSel ? 'bg-primary-50/30' : 'hover:bg-background-100/50'}`}>
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
                          <span className="text-[11px]">
                            <span className="text-emerald-600 font-medium">{row.present}</span>
                            <span className="text-foreground-300">/</span>
                            <span className="text-red-600 font-medium">{row.absent}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center"><span className="text-[11px] text-foreground-300">{formatCount(row.catchup)}</span></td>
                      <td className="px-3 py-2.5 text-center">
                        <i className={`${row.trend === 'up' ? 'ri-arrow-up-line text-emerald-500' : row.trend === 'down' ? 'ri-arrow-down-line text-red-500' : 'ri-subtract-line text-foreground-400'} text-sm`}></i>
                      </td>
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
                      <td className="pr-4 py-2.5 text-center"><i className={`text-foreground-300 text-sm transition-transform duration-300 ${isSel ? 'ri-arrow-up-s-line rotate-180' : 'ri-arrow-down-s-line'}`}></i></td>
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

      <RightSlidePanel isOpen={selectedLearner !== null} onClose={() => setSelectedLearnerId(null)} title={selectedLearner?.learner || 'Learner Detail'} width="w-[520px]">
        {selectedLearner && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${getAvatarClasses(selectedLearner.risk)}`}>
                <span className="text-lg font-bold">{selectedLearner.initials}</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getDisplayRiskClasses(selectedLearner)}`}>{getDisplayRiskLabel(selectedLearner)}</span>
                  {selectedLearner.isOnBreak && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200/70">Excluded from attendance metrics</span>}
                  <span className="text-[10px] text-foreground-400">{displayText(selectedLearner.programme)}</span>
                </div>
                <p className="text-[12px] text-foreground-400">{displayText(selectedLearner.employer)} - {displayText(selectedLearner.cohort)}</p>
                <p className="text-[11px] text-foreground-300 mt-0.5">{displayText(selectedLearner.group)} - Last session: {displayText(selectedLearner.lastSession)}</p>
              </div>
            </div>

            {selectedLearner.risk === 'red' && (
              <div className="bg-red-50/50 rounded-xl border border-red-200/30 p-4">
                <h4 className="text-[11px] font-semibold text-red-700 mb-2 flex items-center gap-1.5"><i className="ri-alert-line"></i> Attendance Alert</h4>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">Attendance {formatPercent(selectedLearner.attendance)}</span>
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{formatCount(selectedLearner.absent)} sessions missed</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedLearner.overallProgress} size={64} color="primary" />
                <div>
                  <p className="text-[10px] text-foreground-400">Overall Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.overallProgress}%</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                {selectedLearner.attendance === null ? (
                  <div className="w-16 h-16 rounded-full bg-background-100 flex items-center justify-center text-foreground-300 font-bold">{MISSING_VALUE}</div>
                ) : (
                  <DonutChart percentage={selectedLearner.attendance} size={64} color={selectedLearner.attendance >= 90 ? 'emerald' : selectedLearner.attendance >= 80 ? 'amber' : 'red'} />
                )}
                <div>
                  <p className="text-[10px] text-foreground-400">Attendance</p>
                  <p className="text-lg font-bold text-foreground-900">{formatPercent(selectedLearner.attendance)}</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={safePercentage(selectedLearner.otjhCompleted, selectedLearner.otjhTarget)} size={64} color={safePercentage(selectedLearner.otjhCompleted, selectedLearner.otjhTarget) >= 70 ? 'emerald' : safePercentage(selectedLearner.otjhCompleted, selectedLearner.otjhTarget) >= 40 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">OTJH</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedLearner.ksbProgress} size={64} color={selectedLearner.ksbProgress >= 70 ? 'emerald' : selectedLearner.ksbProgress >= 40 ? 'primary' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">KSB Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedLearner.ksbProgress}%</p>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Sessions</span><span className="text-foreground-900 font-medium">{selectedLearner.present === null || selectedLearner.sessions === null ? MISSING_VALUE : `${selectedLearner.present}/${selectedLearner.sessions}`}</span></div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Absent</span><span className="text-red-600 font-medium">{formatCount(selectedLearner.absent)}</span></div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Catch-ups</span><span className="text-foreground-900 font-medium">{formatCount(selectedLearner.catchup)}</span></div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]"><span className="text-foreground-400">Consecutive missed</span><span className="text-foreground-900 font-medium">{formatCount(selectedLearner.consecutiveMissed)}</span></div>
              <div className="flex justify-between py-2 text-[12px]"><span className="text-foreground-400">Last Session</span><span className="text-foreground-900 font-medium">{displayText(selectedLearner.lastSession)}</span></div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button onClick={() => handleSendMessage(selectedLearner)} className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
                <i className="ri-mail-line"></i> Send Message
              </button>
              <button onClick={() => info(`Catch-up source is not connected yet`, 'No catch-up table is mapped to this page')} className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
                <i className="ri-timer-line"></i> Schedule Catch-up
              </button>
              <button onClick={() => handleViewProfile(selectedLearner)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
                <i className="ri-file-chart-line"></i> View Full Profile
              </button>
            </div>
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
}
