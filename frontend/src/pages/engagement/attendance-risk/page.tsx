import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { ProgrammeFilter } from '@/components/feature/ProgrammeFilter';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { ENGAGEMENT_LEARNERS, countByProgramme, filterByProgramme, type ProgrammeCode, type ProgrammeFilterValue } from '@/mocks/engagement-data';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const engagementNav = roleNavMap.engagement;

type RiskLevel = 'critical' | 'high' | 'medium';
type Trend = 'deteriorating' | 'declining' | 'stable' | 'improving';
type MonthlyStatus = 'rising' | 'falling' | 'stable';
type SortKey = 'score' | 'attendance' | 'name' | 'missed' | 'consecutive';

interface AttendanceRisk {
  id: string;
  name: string;
  avatarImg?: string;
  programmeCode: ProgrammeCode;
  programme: string;
  cohort: string;
  coach: string;
  attendanceRate: number;
  sessionsMissed: number;
  totalSessions: number;
  consecutiveMissed: number;
  lastAttendance: string;
  trend: Trend;
  action: string;
  employerNotified: boolean;
  interventionDate: string | null;
  engagementScore: number;
  quizAverage: number;
  ksbProgress: number;
  overallPoints: number;
  monthlyStatus: MonthlyStatus;
  badgesCount: number;
  topBadge: string;
}

// Raw learner records — derived from the shared engagement roster. riskLevel is
// not hand-picked here, it's derived from attendance + engagement + quiz + KSB
// via computeRiskScore() below.
const RISK_DATA: AttendanceRisk[] = ENGAGEMENT_LEARNERS.map(l => ({
  id: l.id, name: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, programme: l.programme, cohort: l.cohort, coach: l.coach,
  attendanceRate: l.attendanceRate, sessionsMissed: l.sessionsMissed, totalSessions: l.totalSessions,
  consecutiveMissed: l.consecutiveMissed, lastAttendance: l.lastAttendance, trend: l.attendanceTrend,
  action: l.attendanceAction, employerNotified: l.employerNotified, interventionDate: l.interventionDate,
  engagementScore: l.engagementScore, quizAverage: l.quizAverage, ksbProgress: l.ksbProgress,
  overallPoints: l.overallPoints, monthlyStatus: l.monthlyStatus, badgesCount: l.badgesCount, topBadge: l.topBadge,
}));

const ATTENDANCE_TREND_DATA = [
  { week: 'Wk 1', avgAttendance: 88 },
  { week: 'Wk 2', avgAttendance: 84 },
  { week: 'Wk 3', avgAttendance: 86 },
  { week: 'Wk 4', avgAttendance: 82 },
  { week: 'Wk 5', avgAttendance: 79 },
  { week: 'Wk 6', avgAttendance: 81 },
  { week: 'Wk 7', avgAttendance: 85 },
  { week: 'Wk 8', avgAttendance: 80 },
];

// Weighted risk formula — same idea as the Engagement Score Breakdown on the
// Learner Monitoring page, applied here to derive attendance risk level.
const RISK_WEIGHTS = [
  { key: 'attendanceRate' as const, label: 'Attendance Rate', weight: 40 },
  { key: 'engagementScore' as const, label: 'Engagement Score', weight: 25 },
  { key: 'ksbProgress' as const, label: 'KSB Progression', weight: 20 },
  { key: 'quizAverage' as const, label: 'Quiz Average', weight: 15 },
];

// Session-count-derived attendance %, kept separate from the authored
// `attendanceRate` field so the displayed fraction and percentage always agree.
function sessionAttendancePct(r: Pick<AttendanceRisk, 'totalSessions' | 'sessionsMissed'>) {
  return r.totalSessions > 0 ? Math.round(((r.totalSessions - r.sessionsMissed) / r.totalSessions) * 100) : 0;
}

function computeRiskScore(r: Pick<AttendanceRisk, 'attendanceRate' | 'engagementScore' | 'ksbProgress' | 'quizAverage'>) {
  const score = RISK_WEIGHTS.reduce((sum, w) => sum + r[w.key] * (w.weight / 100), 0);
  const level: RiskLevel = score < 55 ? 'critical' : score < 70 ? 'high' : 'medium';
  return { score: Math.round(score), level };
}

type ScoredRisk = AttendanceRisk & { score: number; level: RiskLevel };

const RISK_CONFIG: Record<RiskLevel, { bg: string; text: string; border: string; cardBorder: string; cardBg: string; avatarBg: string; avatarText: string; icon: string; label: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200/50', cardBorder: 'border-red-200/50', cardBg: 'bg-red-50/20', avatarBg: 'bg-red-100', avatarText: 'text-red-700', icon: 'ri-error-warning-line', label: 'Critical' },
  high: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200/50', cardBorder: 'border-amber-200/50', cardBg: 'bg-amber-50/20', avatarBg: 'bg-amber-100', avatarText: 'text-amber-700', icon: 'ri-alert-line', label: 'High' },
  medium: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200/50', cardBorder: 'border-foreground-200/60', cardBg: '', avatarBg: 'bg-emerald-100', avatarText: 'text-emerald-700', icon: 'ri-checkbox-circle-line', label: 'Medium' },
};

// Shared green/amber/red banding used across all the progress bars below.
function bandColor(value: number) {
  return value >= 70 ? 'bg-emerald-500' : value >= 55 ? 'bg-amber-500' : 'bg-red-500';
}
function bandText(value: number) {
  return value >= 70 ? 'text-emerald-600' : value >= 55 ? 'text-amber-600' : 'text-red-600';
}

const TREND_CONFIG: Record<Trend, { bg: string; text: string; icon: string }> = {
  deteriorating: { bg: 'bg-red-100', text: 'text-red-700', icon: 'ri-arrow-down-line' },
  declining: { bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-arrow-down-line' },
  stable: { bg: 'bg-background-100', text: 'text-foreground-500', icon: 'ri-subtract-line' },
  improving: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: 'ri-arrow-up-line' },
};

const MONTHLY_STATUS_CONFIG: Record<MonthlyStatus, { text: string; icon: string; label: string }> = {
  rising: { text: 'text-emerald-600', icon: 'ri-arrow-up-line', label: 'Rising' },
  falling: { text: 'text-red-600', icon: 'ri-arrow-down-line', label: 'Falling' },
  stable: { text: 'text-foreground-400', icon: 'ri-subtract-line', label: 'Stable' },
};

export default function AttendanceRiskPage() {
  const navigate = useNavigate();
  const { success, info } = useToast();
  const [filter, setFilter] = useState<'all' | RiskLevel>('all');
  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilterValue>('all');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<ScoredRisk | null>(null);

  // Attach the computed risk score/level to every record up front, scoped to
  // the active programme.
  const scored = useMemo(
    () => filterByProgramme(RISK_DATA, programmeFilter).map(r => ({ ...r, ...computeRiskScore(r) })),
    [programmeFilter],
  );
  const programmeCounts = useMemo(() => countByProgramme(RISK_DATA), []);

  const criticalCount = scored.filter(r => r.level === 'critical').length;
  const highCount = scored.filter(r => r.level === 'high').length;
  const mediumCount = scored.filter(r => r.level === 'medium').length;

  const breakdownAverages = useMemo(() => RISK_WEIGHTS.map(w => ({
    ...w,
    avg: scored.length ? Math.round(scored.reduce((s, r) => s + r[w.key], 0) / scored.length) : 0,
  })), [scored]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? [...scored] : scored.filter(r => r.level === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.programme.toLowerCase().includes(q) || r.coach.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortKey) {
        case 'name': va = a.name; vb = b.name; break;
        case 'missed': va = a.sessionsMissed; vb = b.sessionsMissed; break;
        case 'consecutive': va = a.consecutiveMissed; vb = b.consecutiveMissed; break;
        case 'attendance': va = a.attendanceRate; vb = b.attendanceRate; break;
        default: va = a.score; vb = b.score;
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [scored, filter, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handleCall = (risk: AttendanceRisk) => {
    success(`Call logged for ${risk.name}`, risk.action);
  };

  const handleEmail = (risk: AttendanceRisk) => {
    info(`Email sent to ${risk.name}`, `Re: attendance at ${risk.attendanceRate}% — ${risk.programme}`);
  };

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Attendance Risk" pageSubtitle="Track learners with attendance below 90% and trigger early intervention workflows"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Attendance Risk Monitoring"
          description={`${criticalCount} critical, ${highCount} high, ${mediumCount} medium risk learners. Interventions scheduled for ${criticalCount} learners. Average attendance rate: ${Math.round(RISK_DATA.reduce((s, r) => s + r.attendanceRate, 0) / RISK_DATA.length)}%.`}
          icon="ri-alert-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20workplace%20attendance%20monitoring%20dashboard%20professional%20office%20setting%20warm%20neutral%20lighting%20modern&width=400&height=160&seq=attendance-risk-01&orientation=landscape"
          imageAlt="Attendance Risk"
          stats={[{ label: 'Critical', value: String(criticalCount), variant: 'danger' }, { label: 'High', value: String(highCount) }, { label: 'Medium', value: String(mediumCount) }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        {/* Attendance Trend Chart */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Average Attendance Trend</h3>
              <p className="text-[11px] text-foreground-400 mt-0.5">Cohort-wide weekly average vs at-risk learners tracked below</p>
            </div>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">Last 8 weeks</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={ATTENDANCE_TREND_DATA} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
              <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
              <Line type="monotone" dataKey="avgAttendance" stroke="oklch(var(--primary-500))" strokeWidth={2.5} dot={{ r: 3, fill: 'oklch(var(--primary-500))' }} activeDot={{ r: 5 }} name="Avg Attendance" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Risk Score Breakdown — how the risk level is actually measured */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">Risk Score Breakdown</h3>
          <p className="text-[11px] text-foreground-400 mb-4">Risk level is a weighted composite, not attendance alone — critical &lt;55, high &lt;70, medium ≥70</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {breakdownAverages.map(dim => (
              <div key={dim.key} className="bg-background-100/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-foreground-700">{dim.label}</span>
                  <span className="text-[10px] text-foreground-400">{dim.weight}%</span>
                </div>
                <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${bandColor(dim.avg)}`} style={{ width: `${dim.avg}%` }}></div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-foreground-400">Cohort average</span>
                  <span className={`text-[10px] font-bold ${bandText(dim.avg)}`}>{dim.avg}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Programme Filter */}
        <ProgrammeFilter value={programmeFilter} onChange={setProgrammeFilter} counts={programmeCounts} />

        {/* Search + Risk Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text" placeholder="Search learner, programme, or coach..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
            {(['all', 'critical', 'high', 'medium'] as const).map(f => {
              const count = f === 'all' ? scored.length : scored.filter(r => r.level === f).length;
              return (
                <button key={f} onClick={() => setFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === f ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                  <i className={`${f === 'all' ? 'ri-list-check' : RISK_CONFIG[f].icon} text-sm`}></i>
                  {f === 'all' ? 'All Risks' : RISK_CONFIG[f].label}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full leading-none ${filter === f ? 'bg-background-200 text-foreground-600' : 'bg-background-200/70 text-foreground-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="font-semibold text-foreground-500">Sort by:</span>
          {([
            { key: 'score' as SortKey, label: 'Risk Score' },
            { key: 'attendance' as SortKey, label: 'Attendance Rate' },
            { key: 'name' as SortKey, label: 'Name' },
            { key: 'missed' as SortKey, label: 'Sessions Missed' },
            { key: 'consecutive' as SortKey, label: 'Consecutive Missed' },
          ]).map(opt => (
            <button
              key={opt.key}
              onClick={() => handleSort(opt.key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-smooth cursor-pointer whitespace-nowrap ${sortKey === opt.key ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : 'text-foreground-500 hover:text-foreground-700 border border-transparent'}`}
            >
              {opt.label}
              {sortKey === opt.key && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></i>}
            </button>
          ))}
        </div>

        {/* Risk List */}
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-10 flex flex-col items-center justify-center text-center gap-2">
              <i className="ri-search-line text-2xl text-foreground-300"></i>
              <p className="text-sm font-semibold text-foreground-700">No learners match this view</p>
              <p className="text-[11px] text-foreground-400">Try clearing the search or switching the risk filter.</p>
            </div>
          )}
          {filtered.map(risk => {
            const rc = RISK_CONFIG[risk.level];
            const tc = TREND_CONFIG[risk.trend];
            const mc = MONTHLY_STATUS_CONFIG[risk.monthlyStatus];
            const attendancePct = sessionAttendancePct(risk);
            return (
              <div key={risk.id} className={`bg-background-50 rounded-2xl border p-4 shadow-sm card-premium hover:-translate-y-0.5 ${rc.cardBorder} ${rc.cardBg}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <button onClick={() => setSelected(risk)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
                    <div className="w-10 h-10 rounded-full shrink-0 overflow-hidden bg-background-200">
                      {risk.avatarImg ? (
                        <img src={risk.avatarImg} alt={risk.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center text-sm font-bold ${rc.avatarBg} ${rc.avatarText}`}>{risk.name.charAt(0)}</div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground-900 hover:text-primary-600 transition-smooth">{risk.name}</p>
                      <p className="text-[10px] text-foreground-400">{risk.programme} &middot; {risk.cohort} &middot; Coach: {risk.coach}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                    <span className={`text-lg font-bold ${bandText(risk.score)}`}>{risk.score}</span>
                    <span className="text-foreground-400">risk score</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${rc.bg} ${rc.text}`}>{rc.label.toUpperCase()}</span>
                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-2 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>
                      <i className={tc.icon}></i>{risk.trend}
                    </span>
                  </div>
                </div>

                {/* Progress bars — every factor feeding the risk score */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    { label: 'Attendance', value: attendancePct, sub: `${risk.totalSessions - risk.sessionsMissed}/${risk.totalSessions} sessions` },
                    { label: 'Engagement', value: risk.engagementScore },
                    { label: 'Quiz Average', value: risk.quizAverage },
                    { label: 'KSB Progression', value: risk.ksbProgress },
                  ].map(bar => (
                    <div key={bar.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-foreground-400">{bar.label}</span>
                        <span className="text-[10px] font-semibold text-foreground-700">{bar.sub ? `${bar.sub} (${bar.value}%)` : `${bar.value}%`}</span>
                      </div>
                      <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${bandColor(bar.value)}`} style={{ width: `${bar.value}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Points, trend, badges */}
                <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <p className="text-[10px] text-foreground-400 mb-0.5">Overall Points</p>
                    <p className="font-semibold text-foreground-900">{risk.overallPoints.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-foreground-400 mb-0.5">Monthly Trend</p>
                    <span className={`inline-flex items-center gap-0.5 font-semibold ${mc.text}`}><i className={mc.icon}></i>{mc.label}</span>
                  </div>
                  <div>
                    <p className="text-[10px] text-foreground-400 mb-0.5">Badges</p>
                    <p className="font-semibold text-foreground-900 flex items-center gap-1"><i className="ri-medal-line text-accent-500"></i>{risk.badgesCount}</p>
                  </div>
                </div>

                <div className="mt-3 bg-background-100/50 rounded-lg p-3 flex items-start gap-2">
                  <i className={`text-sm mt-0.5 ${risk.level === 'critical' ? 'ri-error-warning-line text-red-600' : 'ri-alert-line text-amber-600'}`}></i>
                  <div className="flex-1">
                    <p className="text-[11px] font-medium text-foreground-700">{risk.action}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-[10px] text-foreground-400">{risk.lastAttendance}</span>
                      <span className="text-[10px] text-foreground-400">{risk.employerNotified ? 'Employer notified' : 'Employer not notified'}</span>
                      {risk.interventionDate && <span className="text-[10px] text-primary-600 font-medium">Intervention: {risk.interventionDate}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => handleCall(risk)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold shadow-lg shadow-primary-500/20 hover:bg-primary-600 hover:shadow-primary-500/30 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-phone-line mr-1"></i> Call
                    </button>
                    <button onClick={() => handleEmail(risk)} className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-mail-line mr-1"></i> Email
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Learner Detail Panel */}
      <RightSlidePanel isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.name} coloredHeader>
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full shrink-0 overflow-hidden bg-background-200">
                {selected.avatarImg ? (
                  <img src={selected.avatarImg} alt={selected.name} className="w-full h-full object-cover" />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center text-base font-bold ${RISK_CONFIG[selected.level].avatarBg} ${RISK_CONFIG[selected.level].avatarText}`}>{selected.name.charAt(0)}</div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground-900">{selected.name}</p>
                <p className="text-[11px] text-foreground-400">{selected.programme} &middot; {selected.cohort}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-foreground-400">Attendance</span>
                <span className="text-[11px] font-semibold text-foreground-700">{selected.totalSessions - selected.sessionsMissed}/{selected.totalSessions} sessions ({sessionAttendancePct(selected)}%)</span>
              </div>
              <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${bandColor(sessionAttendancePct(selected))}`} style={{ width: `${sessionAttendancePct(selected)}%` }}></div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-foreground-800 mb-2">Risk Score Breakdown ({selected.score}/100)</p>
              <div className="space-y-2">
                {RISK_WEIGHTS.map(w => (
                  <div key={w.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-foreground-400">{w.label} ({w.weight}%)</span>
                      <span className="text-[10px] font-semibold text-foreground-700">{selected[w.key]}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${bandColor(selected[w.key])}`} style={{ width: `${selected[w.key]}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Overall Points</p>
                <p className="font-semibold text-foreground-900">{selected.overallPoints.toLocaleString()}</p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Monthly Trend</p>
                <span className={`inline-flex items-center gap-0.5 font-semibold ${MONTHLY_STATUS_CONFIG[selected.monthlyStatus].text}`}>
                  <i className={MONTHLY_STATUS_CONFIG[selected.monthlyStatus].icon}></i>{MONTHLY_STATUS_CONFIG[selected.monthlyStatus].label}
                </span>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Badges</p>
                <p className="font-semibold text-foreground-900 flex items-center gap-1"><i className="ri-medal-line text-accent-500"></i>{selected.badgesCount} <span className="text-[10px] font-normal text-foreground-400">&middot; {selected.topBadge}</span></p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Coach</p>
                <p className="font-semibold text-foreground-900">{selected.coach}</p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Sessions Missed</p>
                <p className="font-semibold text-foreground-900">{selected.sessionsMissed}</p>
              </div>
              <div className="bg-background-100/50 rounded-lg p-3">
                <p className="text-[10px] text-foreground-400 mb-1">Consecutive Missed</p>
                <p className="font-semibold text-foreground-900">{selected.consecutiveMissed}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${RISK_CONFIG[selected.level].bg} ${RISK_CONFIG[selected.level].text}`}>{RISK_CONFIG[selected.level].label.toUpperCase()} RISK</span>
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${TREND_CONFIG[selected.trend].bg} ${TREND_CONFIG[selected.trend].text}`}>
                <i className={TREND_CONFIG[selected.trend].icon}></i>{selected.trend}
              </span>
              <span className="text-[10px] text-foreground-400">{selected.employerNotified ? 'Employer notified' : 'Employer not notified'}</span>
            </div>

            <div className="bg-amber-50/50 rounded-lg p-3">
              <p className="text-[11px] font-medium text-amber-800 mb-0.5">Recommended Action</p>
              <p className="text-[11px] text-amber-700">{selected.action}</p>
              {selected.interventionDate && <p className="text-[10px] text-amber-600 mt-1">Scheduled: {selected.interventionDate}</p>}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => handleCall(selected)} className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold shadow-lg shadow-primary-500/20 hover:bg-primary-600 transition-smooth cursor-pointer">
                <i className="ri-phone-line mr-1"></i> Log Call
              </button>
              <button onClick={() => handleEmail(selected)} className="flex-1 px-3 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
                <i className="ri-mail-line mr-1"></i> Send Email
              </button>
            </div>

            <button onClick={() => navigate('/engagement/learner-engagement')} className="w-full px-3 py-2 border border-foreground-200/60 text-foreground-600 rounded-lg text-[11px] font-medium hover:bg-background-100 transition-smooth cursor-pointer">
              View Full Engagement Profile
            </button>
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
}
