import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { ProgrammeFilter } from '@/components/feature/ProgrammeFilter';
import { useToast } from '@/hooks/useToast';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { LearnerProfilePanel } from '@/pages/engagement/LearnerProfilePanel';
import { roleNavMap } from '@/mocks/navigation';
import {
  ENGAGEMENT_LEARNERS as ROSTER,
  countByProgramme, filterByProgramme, type ProgrammeCode, type ProgrammeFilterValue,
} from '@/mocks/engagement-data';
import { fetchVoucherClaims, updateVoucherClaim } from '@/api/engagement';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, ScatterChart, Scatter, ZAxis, ReferenceLine } from 'recharts';
import { TableBodySkeleton } from '@/components/feature/Skeletons';

const engagementNav = roleNavMap.engagement;

type TabKey = 'overview' | 'attendance' | 'engagement';

interface EngagementLearner {
  id: string;
  name: string;
  avatarImg?: string;
  programmeCode: ProgrammeCode;
  programme: string;
  cohort: string;
  engagementScore: number;
  attendanceRate: number;
  lastActive: string;
  riskLevel: string;
  trend: string;
  flags: string[];
  points: number;
  pointsThisMonth: number;
  monthlyTrend: 'up' | 'down' | 'stable';
}

// All dashboard datasets derive from the shared engagement roster + event
// arrays (single source of truth), so programmes stay consistent across pages.
const ENGAGEMENT_LEARNERS: EngagementLearner[] = ROSTER.map(l => ({
  id: l.id, name: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, programme: l.programme, cohort: l.cohort,
  engagementScore: l.engagementScore, attendanceRate: l.attendanceRate, lastActive: l.lastActive,
  riskLevel: l.riskLevel, trend: l.trend, flags: l.flags, points: l.overallPoints, pointsThisMonth: l.pointsThisMonth,
  monthlyTrend: l.monthlyStatus === 'rising' ? 'up' : l.monthlyStatus === 'falling' ? 'down' : 'stable',
}));

const TOP_LEARNERS = [...ENGAGEMENT_LEARNERS].sort((a, b) => b.points - a.points);

// Learners whose attendance is a concern (below 90% or a worsening trend).
const ATTENDANCE_RISK = ROSTER
  .filter(l => l.attendanceRate < 90 || l.attendanceTrend === 'deteriorating' || l.attendanceTrend === 'declining')
  .map(l => ({ name: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, rate: l.attendanceRate, missed: l.sessionsMissed, trend: l.attendanceTrend, action: l.attendanceAction, lastSession: l.lastAttendance, coach: l.coach }));

function PersonAvatar({ name, avatarImg, className, fallbackClassName }: { name: string; avatarImg?: string; className: string; fallbackClassName: string }) {
  const initial = name.charAt(0);
  return (
    <div className={`${className} rounded-full shrink-0 overflow-hidden bg-background-200`}>
      {avatarImg ? (
        <img src={avatarImg} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className={`w-full h-full flex items-center justify-center font-bold ${fallbackClassName}`}>{initial}</div>
      )}
    </div>
  );
}

const ENGAGEMENT_STATS = {
  totalLearners: 59,
  activeThisWeek: 48,
  activeLearnersThisMonth: 6,
  averageEngagement: 72,
  redRisk: 2,
  amberRisk: 4,
  pointsAwarded: 45200,
  pointsAwardedThisMonth: 3800,
  vouchersClaimed: 312,
  vouchersClaimedThisMonth: 28,
  eventSeats: 892,
  eventSeatsThisMonth: 64,
};

const ATTENDANCE_TREND_DATA = [
  { week: 'Wk 1', attendance: 88, target: 90 },
  { week: 'Wk 2', attendance: 84, target: 90 },
  { week: 'Wk 3', attendance: 86, target: 90 },
  { week: 'Wk 4', attendance: 82, target: 90 },
  { week: 'Wk 5', attendance: 79, target: 90 },
  { week: 'Wk 6', attendance: 81, target: 90 },
  { week: 'Wk 7', attendance: 85, target: 90 },
  { week: 'Wk 8', attendance: 77, target: 90 },
  { week: 'Wk 9', attendance: 80, target: 90 },
  { week: 'Wk 10', attendance: 83, target: 90 },
];

const PROGRAMME_LABELS: Record<ProgrammeCode, string> = {
  PCP: 'Project Control', APM: 'Acc. Project Manager', MM: 'Marketing Management', ME: 'Marketing Execution',
};

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function scatterStatus(attendance: number, engagement: number) {
  if (attendance < 75 || engagement < 40) return { label: 'Priority', color: '#ef4444' };
  if (attendance < 90 || engagement < 70) return { label: 'Watch', color: '#f59e0b' };
  return { label: 'On track', color: '#22c55e' };
}

function LearnerScatterDot({ cx, cy, payload }: any) {
  if (typeof cx !== 'number' || typeof cy !== 'number') return null;
  const status = payload?.status ?? scatterStatus(payload?.attendance ?? 0, payload?.engagement ?? 0);
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={status.color} fillOpacity={0.14} />
      <circle cx={cx} cy={cy} r={4.5} fill={status.color} stroke="#ffffff" strokeWidth={2} />
    </g>
  );
}

export default function EngagementDashboard() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilterValue>('all');
  const [selectedChampionId, setSelectedChampionId] = useState<string | null>(null);

  // Voucher claims are real engagement_api data (unlike the learner-stats
  // sections below, which stay mocked — per-learner stats are owned by
  // another team). Loads on mount; the mock arrays already show what this
  // table looks like once real claims exist.
  const [voucherClaims, setVoucherClaims] = useState<Awaited<ReturnType<typeof fetchVoucherClaims>>>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchVoucherClaims()
      .then(data => { if (!cancelled) setVoucherClaims(data); })
      .catch(err => { if (!cancelled) warning('Could not load voucher claims', err.message); })
      .finally(() => { if (!cancelled) setClaimsLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  async function approveClaim(id: string, learner: string) {
    try {
      const updated = await updateVoucherClaim(id, { status: 'approved', reviewedBy: 'Tom Harrington' });
      setVoucherClaims(prev => prev.map(c => c.id === id ? updated : c));
      success(`Claim approved for ${learner}`);
    } catch (err: any) {
      warning('Could not approve claim', err.message);
    }
  }

  async function rejectClaim(id: string, learner: string) {
    try {
      const updated = await updateVoucherClaim(id, { status: 'rejected', reviewedBy: 'Tom Harrington' });
      setVoucherClaims(prev => prev.map(c => c.id === id ? updated : c));
      warning(`Claim rejected for ${learner}`);
    } catch (err: any) {
      warning('Could not reject claim', err.message);
    }
  }

  const programmeCounts = countByProgramme(ENGAGEMENT_LEARNERS);
  const filteredLearners = filterByProgramme(ENGAGEMENT_LEARNERS, programmeFilter);
  const filteredRoster = filterByProgramme(ROSTER, programmeFilter);
  const filteredTopLearners = [...filteredLearners].sort((a, b) => b.points - a.points);
  const filteredAttendanceRisk = filterByProgramme(ATTENDANCE_RISK, programmeFilter);
  const pendingClaims = voucherClaims.filter(c => c.status === 'pending');
  const filteredVoucherClaims = filterByProgramme(pendingClaims, programmeFilter);

  const redRiskCount = filteredLearners.filter(l => l.riskLevel === 'red').length;
  const amberRiskCount = filteredLearners.filter(l => l.riskLevel === 'amber').length;
  const greenRiskCount = filteredLearners.filter(l => l.riskLevel === 'green').length;
  const avgEngagement = filteredLearners.length ? Math.round(filteredLearners.reduce((sum, l) => sum + l.engagementScore, 0) / filteredLearners.length) : 0;
  const filteredEngagementDistribution = [
    { range: '0–20%', count: filteredLearners.filter(l => l.engagementScore <= 20).length, fill: '#ef4444' },
    { range: '21–40%', count: filteredLearners.filter(l => l.engagementScore > 20 && l.engagementScore <= 40).length, fill: '#f97316' },
    { range: '41–60%', count: filteredLearners.filter(l => l.engagementScore > 40 && l.engagementScore <= 60).length, fill: '#eab308' },
    { range: '61–80%', count: filteredLearners.filter(l => l.engagementScore > 60 && l.engagementScore <= 80).length, fill: '#22c55e' },
    { range: '81–100%', count: filteredLearners.filter(l => l.engagementScore > 80).length, fill: '#10b981' },
  ];
  const filteredOtjhProgress = [
    { name: 'On Track', value: filteredRoster.filter(l => l.otjhHours / l.otjhTarget >= 0.9).length, color: '#22c55e' },
    { name: 'Slightly Behind', value: filteredRoster.filter(l => l.otjhHours / l.otjhTarget >= 0.75 && l.otjhHours / l.otjhTarget < 0.9).length, color: '#eab308' },
    { name: 'Significantly Behind', value: filteredRoster.filter(l => l.otjhHours / l.otjhTarget >= 0.5 && l.otjhHours / l.otjhTarget < 0.75).length, color: '#f97316' },
    { name: 'At Risk', value: filteredRoster.filter(l => l.otjhHours / l.otjhTarget < 0.5).length, color: '#ef4444' },
  ];
  const otjhOnTrack = filteredOtjhProgress[0].value;
  const riskBreakdown = [
    { name: 'On track', value: greenRiskCount, color: '#22c55e' },
    { name: 'Amber risk', value: amberRiskCount, color: '#f59e0b' },
    { name: 'Red risk', value: redRiskCount, color: '#ef4444' },
  ];
  const engagementDrivers = [
    { name: 'Attendance', value: average(filteredRoster.map(l => l.attendanceRate)) },
    { name: 'Evidence', value: average(filteredRoster.map(l => l.evidenceTarget ? (l.evidenceSubmitted / l.evidenceTarget) * 100 : 0)) },
    { name: 'OTJH', value: average(filteredRoster.map(l => l.otjhTarget ? (l.otjhHours / l.otjhTarget) * 100 : 0)) },
    { name: 'Quiz', value: average(filteredRoster.map(l => l.quizAverage)) },
    { name: 'KSB', value: average(filteredRoster.map(l => l.ksbProgress)) },
    { name: 'Messages', value: average(filteredRoster.map(l => l.messageResponse)) },
  ];
  const programmeComparison = (['PCP', 'APM', 'MM', 'ME'] as ProgrammeCode[]).map(code => {
    const learners = filteredRoster.filter(l => l.programmeCode === code);
    return { name: PROGRAMME_LABELS[code], engagement: average(learners.map(l => l.engagementScore)), attendance: average(learners.map(l => l.attendanceRate)), learnerCount: learners.length };
  }).filter(programme => programme.learnerCount > 0);
  const learnerScatter = filteredRoster.map(learner => ({ name: learner.name, attendance: learner.attendanceRate, engagement: learner.engagementScore, programme: learner.programme, status: scatterStatus(learner.attendanceRate, learner.engagementScore) }));

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Engagement Command Centre" pageSubtitle="Learner engagement monitoring and attendance risk tracking"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Engagement Command Centre"
          description={`${filteredLearners.length} learners${programmeFilter === 'all' ? '' : ` in ${programmeFilter}`}. ${redRiskCount} red-risk, ${amberRiskCount} amber-risk. Average engagement: ${avgEngagement}%.`}
          icon="ri-heart-pulse-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20learner%20engagement%20group%20collaboration%20team%20discussion%20apprenticeship%20purple%20gold%20accent%20editorial%20photography%20modern%20office%20warm%20welcoming%20atmosphere&width=400&height=160&seq=engagement-hero-01&orientation=landscape"
          imageAlt="Engagement Command Centre"
          stats={[
            { label: 'Learners', value: String(filteredLearners.length) },
            { label: 'Red Risk', value: String(redRiskCount), variant: 'danger' },
            { label: 'Amber Risk', value: String(amberRiskCount) },
          ]}
        />

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <EngagementStatCard label="Engagement Score" value={`${avgEngagement}%`} sub={`${ENGAGEMENT_STATS.activeThisWeek}/${ENGAGEMENT_STATS.totalLearners} active`} icon="ri-heart-line" color="primary" />
          <EngagementStatCard label="At Risk Learners" value={String(redRiskCount + amberRiskCount)} sub={`${redRiskCount} red · ${amberRiskCount} amber`} icon="ri-alert-line" color="accent" />
          <EngagementStatCard label="Attendance Risk" value={String(filteredAttendanceRisk.length)} sub="deteriorating patterns" icon="ri-calendar-check-line" color="secondary" />
          <EngagementStatCard label="Green Learners" value={String(greenRiskCount)} sub="on track" icon="ri-shield-check-line" color="primary" />
        </div>

        {/* Stat Cards — Rewards & Participation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <EngagementStatCard
            label="Active Learners" value={ENGAGEMENT_STATS.totalLearners.toLocaleString()}
            trend={`+${ENGAGEMENT_STATS.activeLearnersThisMonth} this month`} trendUp
            icon="ri-group-line" color="primary"
          />
          <EngagementStatCard
            label="Points Awarded" value={`${(ENGAGEMENT_STATS.pointsAwarded / 1000).toFixed(1)}k`}
            trend={`+${ENGAGEMENT_STATS.pointsAwardedThisMonth.toLocaleString()} this month`} trendUp
            icon="ri-award-line" color="accent"
          />
          <EngagementStatCard
            label="Vouchers Claimed" value={String(ENGAGEMENT_STATS.vouchersClaimed)}
            trend={`+${ENGAGEMENT_STATS.vouchersClaimedThisMonth} this month`} trendUp
            icon="ri-coupon-3-line" color="secondary"
          />
          <EngagementStatCard
            label="Event Seats" value={String(ENGAGEMENT_STATS.eventSeats)}
            trend={`+${ENGAGEMENT_STATS.eventSeatsThisMonth} this month`} trendUp
            icon="ri-calendar-event-line" color="primary"
          />
        </div>

        {/* Programme Filter */}
        <ProgrammeFilter value={programmeFilter} onChange={setProgrammeFilter} counts={programmeCounts} />

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'overview' as TabKey, label: 'Engagement Overview', icon: 'ri-heart-line' },
            { key: 'attendance' as TabKey, label: 'Attendance Risk', icon: 'ri-alert-line', badge: filteredAttendanceRisk.length },
            { key: 'engagement' as TabKey, label: 'Learner Engagement', icon: 'ri-bar-chart-2-line' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer border-b-2 ${
                activeTab === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm border-accent-400' : 'text-foreground-500 hover:text-foreground-700 border-transparent'
              }`}
            >
              <AppIcon className={`${tab.icon} text-sm`}></AppIcon>
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Engagement Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Champions podium + Top Learners Leaderboard, side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Course Champions Podium — right on desktop */}
              <div className="lg:order-2">
                <CourseChampionsPodium champions={filteredTopLearners.slice(0, 3)} onViewAll={() => navigate('/engagement/recognition')} onOpenProfile={setSelectedChampionId} />
              </div>

              {/* Top Learners Leaderboard — left on desktop */}
              <section className="lg:order-1 h-full flex flex-col bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-foreground-200/60 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Top Learners Leaderboard</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Ranked by total points earned</p>
                  </div>
                  <button onClick={() => navigate('/engagement/recognition')} className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap">
                    View All
                  </button>
                </div>
                <div className="flex-1 flex flex-col divide-y divide-background-200/30">
                  {filteredTopLearners.slice(0, 8).map((l, i) => (
                    <div key={l.name} className="flex-1 p-4 flex items-center gap-4 hover:bg-background-100/50 transition-smooth">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i === 0 ? 'bg-accent-400 text-white' :
                        i === 1 ? 'bg-foreground-300 text-white' :
                        i === 2 ? 'bg-amber-700/70 text-white' :
                        'bg-background-200 text-foreground-500 border border-foreground-200/60'
                      }`}>{i + 1}</span>
                      <PersonAvatar name={l.name} avatarImg={l.avatarImg} className="w-9 h-9" fallbackClassName={`text-xs ${
                        l.riskLevel === 'red' ? 'bg-red-100 text-red-700' :
                        l.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-foreground-900 truncate">{l.name}</p>
                        <p className="text-[10px] text-foreground-400 truncate">{l.programme} · {l.cohort}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-foreground-900">{l.points.toLocaleString()} <span className="text-[10px] font-normal text-foreground-400">pts</span></p>
                        <p className={`text-[10px] font-medium flex items-center justify-end gap-0.5 ${
                          l.monthlyTrend === 'up' ? 'text-emerald-600' : l.monthlyTrend === 'down' ? 'text-red-600' : 'text-foreground-400'
                        }`}>
                          <AppIcon className={l.monthlyTrend === 'up' ? 'ri-arrow-up-line' : l.monthlyTrend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'}></AppIcon>
                          +{l.pointsThisMonth} this month
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {filteredLearners.map((l, i) => (
                <div key={i} className={`bg-background-50 rounded-2xl border p-4 shadow-sm card-premium hover:-translate-y-0.5 ${
                  l.riskLevel === 'red' ? 'border-red-200/50 bg-red-50/20' :
                  l.riskLevel === 'amber' ? 'border-amber-200/50 bg-amber-50/20' :
                  'border-foreground-200/60'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <PersonAvatar name={l.name} avatarImg={l.avatarImg} className="w-9 h-9" fallbackClassName={`text-xs ${
                        l.riskLevel === 'red' ? 'bg-red-100 text-red-700' :
                        l.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`} />
                      <div>
                        <p className="text-[13px] font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[10px] text-foreground-400">{l.programme}</p>
                      </div>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      l.riskLevel === 'red' ? 'bg-red-500' :
                      l.riskLevel === 'amber' ? 'bg-amber-500' :
                      'bg-emerald-500'
                    }`}></span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-foreground-400">Engagement</span>
                      <span className={`font-semibold ${l.engagementScore >= 70 ? 'text-emerald-600' : l.engagementScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{l.engagementScore}%</span>
                    </div>
                    <div className="w-full bg-background-200 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${l.engagementScore >= 70 ? 'bg-emerald-500' : l.engagementScore >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${l.engagementScore}%` }}></div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-foreground-400">
                      <span>Attendance: {l.attendanceRate}%</span>
                      <span>Last active: {l.lastActive}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-foreground-400">Trend:</span>
                      <span className={`font-medium ${
                        l.trend === 'up' ? 'text-emerald-600' : l.trend === 'down' ? 'text-red-600' : 'text-foreground-500'
                      }`}>
                        <AppIcon className={`${l.trend === 'up' ? 'ri-arrow-up-line' : l.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'} text-[9px] mr-0.5`}></AppIcon>
                        {l.trend}
                      </span>
                    </div>
                  </div>
                  {l.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {l.flags.map(flag => (
                        <span key={flag} className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">{flag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Vouchers Claimed — Need Approval */}
            <section className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-foreground-200/60 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Vouchers Claimed — Need Approval</h3>
                  <p className="text-[11px] text-foreground-400 mt-0.5">Voucher redemption requests awaiting review</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{filteredVoucherClaims.length} pending</span>
                  <button onClick={() => navigate('/engagement/voucher-claims')} className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap">
                    View All
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="px-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">Learner</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">Reward</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">Points</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">Requested</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">Delivery</th>
                      <th className="px-5 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-widest">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claimsLoading && <TableBodySkeleton rows={5} columns={6} />}
                    {!claimsLoading && filteredVoucherClaims.length === 0 && (
                      <tr><td colSpan={6} className="px-5 py-6 text-center text-[11px] text-foreground-400">No voucher claims for this programme.</td></tr>
                    )}
                    {filteredVoucherClaims.map(claim => (
                      <tr key={claim.id} className="hover:bg-background-100/50 transition-smooth">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <PersonAvatar name={claim.learner} avatarImg={claim.avatarImg} className="w-8 h-8" fallbackClassName="text-xs bg-accent-100 text-accent-600" />
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-foreground-900 truncate">{claim.learner}</p>
                              <p className="text-[10px] text-foreground-400 truncate">{claim.programme}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-[12px] text-foreground-700">{claim.reward}</td>
                        <td className="px-5 py-3 text-[12px] font-semibold text-foreground-900">{claim.points} pts</td>
                        <td className="px-5 py-3 text-[11px] text-foreground-400">{claim.requestedAt}</td>
                        <td className="px-5 py-3 text-[11px] text-foreground-400">{claim.deliveryMethod}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => approveClaim(claim.id, claim.learner)} className="px-3 py-1.5 bg-emerald-500/10 text-emerald-700 rounded-lg text-[10px] font-bold hover:bg-emerald-500/20 transition-smooth cursor-pointer whitespace-nowrap">Approve</button>
                            <button onClick={() => rejectClaim(claim.id, claim.learner)} className="px-3 py-1.5 bg-red-500/10 text-red-700 rounded-lg text-[10px] font-bold hover:bg-red-500/20 transition-smooth cursor-pointer whitespace-nowrap">Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Attendance Trends */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Trends</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Weekly attendance rate vs 90% target</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">Last 10 weeks</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ATTENDANCE_TREND_DATA} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                    <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartSidePanel />} position={{ x: 8, y: 8 }} />
                    <Line type="monotone" dataKey="target" stroke="var(--foreground-300)" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Target 90%" />
                    <Line type="monotone" dataKey="attendance" stroke="oklch(var(--primary-500))" strokeWidth={2.5} dot={{ r: 3, fill: 'oklch(var(--primary-500))' }} activeDot={{ r: 5 }} name="Attendance" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Engagement Score Distribution */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Engagement Score Distribution</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Learners by engagement score range</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">{filteredLearners.length} learners</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={filteredEngagementDistribution} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartSidePanel />} position={{ x: 8, y: 8 }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Learners">
                      {filteredEngagementDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* OTJH progress */}
            <div className="w-full">
              {/* OTJH Progress Pie Chart */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH Progress</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Learners by off-the-job training progress status</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">{otjhOnTrack} on track</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={filteredOtjhProgress}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="none"
                    >
                      {filteredOtjhProgress.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-900 text-2xl font-semibold">{filteredRoster.length}</text>
                    <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-400 text-[10px]">learners</text>
                    <Tooltip content={<ChartSidePanel />} position={{ x: 8, y: 8 }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

            </div>

            {/* Actionable insight charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {/* Risk breakdown */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Risk Breakdown</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Current learner risk distribution</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">{filteredRoster.length} learners</span>
                </div>
                <div className="flex items-center gap-5">
                  <ResponsiveContainer width="48%" height={190}>
                    <PieChart>
                      <Pie data={riskBreakdown} dataKey="value" innerRadius={48} outerRadius={72} paddingAngle={3} stroke="none">
                        {riskBreakdown.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-900 text-xl font-semibold">{filteredRoster.length}</text>
                      <text x="50%" y="59%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-400 text-[9px]">learners</text>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-3">
                    {riskBreakdown.map(entry => (
                      <div key={entry.name} className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-2 text-foreground-500"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }}></span>{entry.name}</span>
                        <span className="font-semibold text-foreground-800">{entry.value} <span className="font-normal text-foreground-400">({filteredRoster.length ? Math.round(entry.value / filteredRoster.length * 100) : 0}%)</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Engagement drivers */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Engagement Drivers</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Average performance across key signals</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">0–100%</span>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={engagementDrivers} layout="vertical" margin={{ top: 0, right: 10, left: 5, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="var(--background-200)" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={62} tick={{ fontSize: 10, fill: 'var(--foreground-500)' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartSidePanel />} position={{ x: 8, y: 8 }} />
                    <Bar dataKey="value" fill="oklch(var(--primary-500))" radius={[0, 5, 5, 0]} barSize={14} name="Average" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Programme comparison */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Programme Comparison</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Average engagement and attendance by programme</p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-foreground-400"><span><AppIcon className="ri-checkbox-blank-circle-fill text-primary-500 mr-1"></AppIcon>Engagement</span><span><AppIcon className="ri-checkbox-blank-circle-fill text-accent-500 mr-1"></AppIcon>Attendance</span></div>
                </div>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={programmeComparison} layout="vertical" margin={{ top: 0, right: 10, left: 5, bottom: 0 }} barGap={3}>
                    <CartesianGrid horizontal={false} stroke="var(--background-200)" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 9, fill: 'var(--foreground-500)' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartSidePanel />} position={{ x: 8, y: 8 }} />
                    <Bar dataKey="engagement" fill="oklch(var(--primary-500))" radius={[0, 4, 4, 0]} barSize={9} name="Engagement" />
                    <Bar dataKey="attendance" fill="oklch(var(--accent-500))" radius={[0, 4, 4, 0]} barSize={9} name="Attendance" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Attendance vs engagement */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance vs Engagement</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Each dot is a learner: attendance on X, engagement on Y</p>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-medium text-foreground-500">
                    <span><AppIcon className="ri-checkbox-blank-circle-fill text-emerald-500 mr-1"></AppIcon>On track</span>
                    <span><AppIcon className="ri-checkbox-blank-circle-fill text-amber-500 mr-1"></AppIcon>Watch</span>
                    <span><AppIcon className="ri-checkbox-blank-circle-fill text-red-500 mr-1"></AppIcon>Priority</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={210}>
                  <ScatterChart margin={{ top: 5, right: 10, bottom: 10, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis type="number" dataKey="attendance" domain={[50, 100]} name="Attendance" unit="%" tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <YAxis type="number" dataKey="engagement" domain={[0, 100]} name="Engagement" unit="%" tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <ZAxis range={[45, 45]} />
                    <ReferenceLine x={90} stroke="var(--foreground-300)" strokeDasharray="4 4" />
                    <ReferenceLine y={40} stroke="var(--foreground-300)" strokeDasharray="4 4" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartSidePanel />} position={{ x: 8, y: 8 }} />
                    <Scatter data={learnerScatter} shape={<LearnerScatterDot />} name="Learner" />
                  </ScatterChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-foreground-400 mt-1">
                  <span><AppIcon className="ri-error-warning-fill text-red-500 mr-1"></AppIcon>Bottom-left: priority follow-up</span>
                  <span><AppIcon className="ri-checkbox-circle-fill text-emerald-500 mr-1"></AppIcon>Top-right: on track</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Attendance Risk */}
        {activeTab === 'attendance' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Risk Monitoring</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Learners with attendance below 90% or deteriorating patterns</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-red-50 text-red-600 px-2 py-0.5 rounded-full">{filteredAttendanceRisk.length} at risk</span>
            </div>
            <div className="space-y-3">
              {filteredAttendanceRisk.length === 0 && <ProgrammeEmptyState message="No attendance risk records for this programme." />}
              {filteredAttendanceRisk.map((l, i) => (
                <div key={i} className="bg-background-50 rounded-2xl border border-foreground-200/60 p-4 shadow-sm card-premium hover:-translate-y-0.5">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <PersonAvatar name={l.name} avatarImg={l.avatarImg} className="w-10 h-10" fallbackClassName={`text-sm ${
                        l.rate < 70 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[11px] text-foreground-400">Coach: {l.coach}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] shrink-0 flex-wrap">
                      <span className={`text-lg font-bold ${l.rate < 70 ? 'text-red-600' : 'text-amber-600'}`}>{l.rate}%</span>
                      <span className="text-foreground-400">{l.missed} missed</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        l.trend === 'deteriorating' ? 'bg-red-100 text-red-700' :
                        l.trend === 'declining' ? 'bg-amber-100 text-amber-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{l.trend}</span>
                      <span className="text-foreground-400">{l.lastSession}</span>
                    </div>
                  </div>
                  <div className="mt-3 bg-amber-50/50 rounded-lg p-3 flex items-start gap-2">
                    <AppIcon className="ri-alert-line text-amber-600 text-sm mt-0.5"></AppIcon>
                    <div>
                      <p className="text-[11px] font-medium text-amber-800">Recommended Action</p>
                      <p className="text-[11px] text-amber-700">{l.action}</p>
                    </div>
                    <button className="ml-auto px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-semibold shadow-lg shadow-amber-600/20 hover:bg-amber-700 hover:shadow-amber-600/30 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
                      Take Action
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Learner Engagement Detail */}
        {activeTab === 'engagement' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Learner Engagement Detail</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Comprehensive engagement scores based on attendance, evidence, OTJH, and activity</p>
              </div>
              <button className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap">
                <AppIcon className="ri-download-line mr-1"></AppIcon> Export Report
              </button>
            </div>
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {filteredLearners.map((l, i) => (
                  <div key={i} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-background-100/50 transition-smooth ${l.riskLevel === 'red' ? 'bg-red-50/20' : l.riskLevel === 'amber' ? 'bg-amber-50/20' : ''}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <PersonAvatar name={l.name} avatarImg={l.avatarImg} className="w-10 h-10" fallbackClassName={`text-sm ${
                        l.riskLevel === 'red' ? 'bg-red-100 text-red-700' :
                        l.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{l.name}</p>
                        <p className="text-[11px] text-foreground-400">{l.programme} · {l.cohort}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] shrink-0 flex-wrap">
                      <div className="flex items-center gap-1">
                        <span className="text-foreground-400">Score:</span>
                        <span className={`font-bold text-sm ${l.engagementScore >= 70 ? 'text-emerald-600' : l.engagementScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{l.engagementScore}%</span>
                      </div>
                      <span className="text-foreground-400">Att: {l.attendanceRate}%</span>
                      <span className="text-foreground-400">{l.lastActive}</span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        l.riskLevel === 'red' ? 'bg-red-100 text-red-700' :
                        l.riskLevel === 'amber' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>{l.riskLevel.toUpperCase()}</span>
                      {l.flags.length > 0 && l.riskLevel !== 'green' && (
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold shadow-lg shadow-primary-500/20 hover:bg-primary-600 hover:shadow-primary-500/30 transition-smooth cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-phone-line mr-1"></AppIcon> Contact
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Quick Actions */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Points Rules', icon: 'ri-gift-2-line', path: '/engagement/points-rules' },
            { label: 'Rewards Shop', icon: 'ri-shopping-bag-3-line', path: '/engagement/rewards-shop' },
            { label: 'Voucher Claims', icon: 'ri-coupon-line', path: '/engagement/voucher-claims' },
            { label: 'Events', icon: 'ri-calendar-event-line', path: '/engagement/events' },
            { label: 'Learner Clubs', icon: 'ri-team-line', path: '/engagement/clubs' },
            { label: 'Recognition', icon: 'ri-thumb-up-line', path: '/engagement/recognition' },
          ].map(link => (
            <button
              key={link.label}
              onClick={() => navigate(link.path)}
              className="flex flex-col items-center gap-2 px-3 py-4 bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm text-[11px] font-medium text-foreground-600 hover:-translate-y-0.5 hover:shadow-md hover:border-primary-200/50 transition-smooth cursor-pointer"
            >
              <span className="w-9 h-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
                <AppIcon className={`${link.icon} text-sm`}></AppIcon>
              </span>
              <span className="text-center whitespace-nowrap">{link.label}</span>
            </button>
          ))}
        </section>
        <LearnerProfilePanel learnerId={selectedChampionId} onClose={() => setSelectedChampionId(null)} />
      </div>
    </WorkspaceShell>
  );
}

function ProgrammeEmptyState({ message }: { message: string }) {
  return (
    <div className="p-6 text-center text-[11px] text-foreground-400">
      <AppIcon className="ri-filter-off-line text-lg text-foreground-300 block mb-1"></AppIcon>
      {message}
    </div>
  );
}

function CourseChampionsPodium({ champions, onViewAll, onOpenProfile }: { champions: EngagementLearner[]; onViewAll: () => void; onOpenProfile: (learnerId: string) => void }) {
  const [first, second, third] = champions;
  const reduceMotion = useReducedMotion();
  if (!first || !second || !third) return null;

  return (
    <section
      className="relative rounded-2xl border shadow-xl overflow-hidden animate-hero-fade-in-up"
      style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)', borderColor: withAlpha(GOLD, 0.28) }}
    >
      <ConfettiBurst reducedMotion={reduceMotion} />
      {/* Bevel hairline — light-register analog of the app hero's top highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-white/60 pointer-events-none z-10"></div>
      {/* Ambient glows tuned for the light surface — decorative only */}
      <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full blur-3xl pointer-events-none" style={{ background: `radial-gradient(circle, ${withAlpha(GOLD, 0.14)} 0%, transparent 70%)` }}></div>
      <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full blur-3xl pointer-events-none" style={{ background: `radial-gradient(circle, ${withAlpha(BRAND_PURPLE, 0.14)} 0%, transparent 70%)` }}></div>

      <div className="relative z-20 p-6 sm:p-8">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full mb-3 border bg-white/10 text-accent-200 border-white/20">
            <AppIcon className="ri-trophy-line"></AppIcon> Engagement Sprint
          </span>
          <h3 className="text-xl font-heading font-medium text-white">Champions</h3>
          <p className="text-[12px] mt-1 text-white/65">Celebrating this month's top performers by points earned</p>
        </div>

        {/* Podium — full width, centered, blocks flush against each other */}
        <div className="w-full max-w-md sm:max-w-lg mx-auto flex items-end justify-center">
          <PodiumSpot learner={second} rank={2} revealDelay={140} gapLabel={`${(first.points - second.points).toLocaleString()} pts behind champion`} reduceMotion={reduceMotion} onOpenProfile={onOpenProfile} />
          <PodiumSpot learner={first} rank={1} revealDelay={380} gapLabel={`${(first.points - second.points).toLocaleString()} pts ahead of #2`} reduceMotion={reduceMotion} onOpenProfile={onOpenProfile} />
          <PodiumSpot learner={third} rank={3} revealDelay={0} gapLabel={`${(second.points - third.points).toLocaleString()} pts behind #2`} reduceMotion={reduceMotion} onOpenProfile={onOpenProfile} />
        </div>

        {/* Top Achiever spotlight strip — full width, below the podium */}
        <div className="mt-8">
          <TopAchieverCard learner={first} />
        </div>

        <div className="text-center mt-6">
          <button onClick={onViewAll} className="text-[11px] font-medium text-accent-200 hover:text-white transition-smooth cursor-pointer">
            View full leaderboard <AppIcon className="ri-arrow-right-line ml-1"></AppIcon>
          </button>
        </div>
      </div>
    </section>
  );
}

// Engagement Sprint podium palette — centralized here so no rank/brand hex
// value is ever hardcoded inline elsewhere in this component.
const RANK_COLORS = {
  first: '#C8951F',
  second: '#9AA3B2',
  third: '#B86B3C',
} as const;
const BRAND_PURPLE = '#5B18E3';
const TEXT_DARK = '#1E124D';
const TEXT_MUTED = '#6B5C99';
const PODIUM_SURFACE = '#1A0940';
const SUCCESS_GREEN = '#2F8F5B';
// Heritage gold — the design system reserves accent-* gold for celebratory
// focal points, so the #1 champion is accented with it. DOM elements use the
// Tailwind accent-* tokens directly; this hex mirrors oklch(var(--accent-500))
// for the canvas confetti, which can't reference CSS classes.
const GOLD = RANK_COLORS.first;

// #9A7AF7 (rank 3) is too light for reliable white-text contrast, so rank-3
// text/icons fall back to TEXT_DARK instead of white.
function withAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Lightens a hex toward white by `amount` (0–1) — used for the top of the
// beveled podium-block gloss gradients.
function lighten(hex: string, amount: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Per-rank visual treatment. Bars use the tonal ramp (1st darkest → 3rd
// lightest) with top-only 12px rounding; each carries a subtle icon as a
// texture detail. Avatars get a white ring gap plus a thin rank-colored ring
// via box-shadow, and the badge border matches the panel bg so it reads as
// "clipped" out of the ring rather than glued to the photo.
const PODIUM_RANK_STYLES = {
  1: {
    badgeStyle: { backgroundColor: RANK_COLORS.first, color: TEXT_DARK },
    // White border = the ring gap; gold box-shadow ring + soft glow (champion).
    ringStyle: { boxShadow: `0 0 0 2px ${GOLD}, 0 10px 24px -6px ${withAlpha(GOLD, 0.5)}` },
    barStyle: {
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 22px -10px ${withAlpha(GOLD, 0.45)}`,
      background: `linear-gradient(to bottom, ${lighten(RANK_COLORS.first, 0.22)} 0%, ${RANK_COLORS.first} 100%)`,
    },
    barIcon: 'ri-trophy-fill',
    barIconStyle: { color: TEXT_DARK, opacity: 0.55 },
    barHeight: 'h-40 sm:h-52',
    avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
    order: 'order-1 sm:order-2',
  },
  2: {
    badgeStyle: { backgroundColor: RANK_COLORS.second, color: TEXT_DARK },
    ringStyle: { boxShadow: `0 0 0 2px ${RANK_COLORS.second}, 0 8px 18px -8px ${withAlpha(RANK_COLORS.second, 0.45)}` },
    barStyle: {
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 22px -10px ${withAlpha(RANK_COLORS.second, 0.4)}`,
      background: `linear-gradient(to bottom, ${lighten(RANK_COLORS.second, 0.2)} 0%, ${RANK_COLORS.second} 100%)`,
    },
    barIcon: 'ri-medal-fill',
    barIconStyle: { color: TEXT_DARK, opacity: 0.45 },
    barHeight: 'h-28 sm:h-36',
    avatarSize: 'w-16 h-16 sm:w-20 sm:h-20',
    order: 'order-2 sm:order-1',
  },
  3: {
    badgeStyle: { backgroundColor: RANK_COLORS.third, color: '#ffffff' },
    ringStyle: { boxShadow: `0 0 0 2px ${RANK_COLORS.third}, 0 8px 18px -8px ${withAlpha(RANK_COLORS.third, 0.45)}` },
    barStyle: {
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 22px -10px ${withAlpha(RANK_COLORS.third, 0.4)}`,
      background: `linear-gradient(to bottom, ${lighten(RANK_COLORS.third, 0.18)} 0%, ${RANK_COLORS.third} 100%)`,
    },
    // Lightest bar — dark icon at low opacity keeps it a subtle texture, not white-on-light.
    barIcon: 'ri-medal-fill',
    barIconStyle: { color: '#ffffff', opacity: 0.4 },
    barHeight: 'h-24 sm:h-32',
    avatarSize: 'w-16 h-16 sm:w-20 sm:h-20',
    order: 'order-3 sm:order-3',
  },
} as const;

function PodiumSpot({ learner, rank, revealDelay, gapLabel, reduceMotion, onOpenProfile }: { learner: EngagementLearner; rank: 1 | 2 | 3; revealDelay: number; gapLabel: string; reduceMotion: boolean; onOpenProfile: (learnerId: string) => void }) {
  const isFirst = rank === 1;
  const initials = learner.name.split(' ').map(w => w[0]).join('').slice(0, 2);
  const styles = PODIUM_RANK_STYLES[rank];
  const displayedPoints = useCountUp(learner.points, revealDelay + 180, reduceMotion);
  const medalLabel = rank === 1 ? 'Gold champion' : rank === 2 ? 'Silver runner-up' : 'Bronze third place';

  return (
    <button
      type="button"
      onClick={() => onOpenProfile(learner.id)}
      className={`flex-1 flex flex-col items-center text-left cursor-pointer group ${styles.order} ${isFirst ? 'relative z-10' : ''} ${reduceMotion ? '' : 'animate-hero-fade-in-up'}`}
      style={reduceMotion ? undefined : { animationDelay: `${revealDelay}ms` }}
      aria-label={`View ${learner.name}'s profile`}
    >
      {/* Avatar with a white ring gap; badge is punched out with a panel-colored border */}
      <div className="relative mb-3">
        {isFirst && (
          <AppIcon className="ri-vip-crown-fill absolute -top-8 left-1/2 -translate-x-1/2 text-3xl drop-shadow-lg" style={{ color: GOLD }}></AppIcon>
        )}
        <div className={`${styles.avatarSize} rounded-full border-4 border-white bg-primary-700 shrink-0 overflow-hidden`} style={styles.ringStyle}>
          {learner.avatarImg ? (
            <img src={learner.avatarImg} alt={learner.name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center font-semibold text-white ${isFirst ? 'text-xl' : 'text-base'}`}>
              {initials}
            </div>
          )}
        </div>
        <span
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-[3px]"
          style={{ ...styles.badgeStyle, borderColor: PODIUM_SURFACE }}
        >
          {rank}
        </span>
      </div>

      <p className="text-[13px] font-medium text-center truncate max-w-full px-1 text-white group-hover:underline">{learner.name}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: RANK_COLORS[rank === 1 ? 'first' : rank === 2 ? 'second' : 'third'] }}>
        <AppIcon className={rank === 1 ? 'ri-trophy-fill' : 'ri-medal-fill'}></AppIcon>{medalLabel}
      </span>
      <p className="text-[12px] font-semibold mt-1 text-accent-200">{displayedPoints.toLocaleString()} pts</p>
      <p className="text-[9px] text-center min-h-3 mt-0.5 px-1 text-white/55">{gapLabel}</p>

      {/* Grand champion pill — sits above the 1st-place bar, below name/points */}
      {isFirst && (
        <span
          className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full text-[9px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          style={{ background: `linear-gradient(135deg, ${GOLD} 0%, ${lighten(GOLD, 0.35)} 100%)`, color: TEXT_DARK }}
        >
          <AppIcon className="ri-vip-crown-fill text-[10px]"></AppIcon> Grand champion
        </span>
      )}

      {/* Podium bar — tonal ramp, top-only 12px radius, subtle icon as texture */}
      <div
        className={`w-full ${styles.barHeight} rounded-t-xl mt-3 flex items-start justify-center pt-3`}
        style={styles.barStyle}
      >
        <AppIcon className={`${styles.barIcon} text-3xl`} style={styles.barIconStyle}></AppIcon>
      </div>
    </button>
  );
}

function TopAchieverCard({ learner }: { learner: EngagementLearner }) {
  const initials = learner.name.split(' ').map(w => w[0]).join('').slice(0, 2);
  const trendColor = learner.monthlyTrend === 'down' ? '#C0392B' : learner.monthlyTrend === 'up' ? SUCCESS_GREEN : TEXT_MUTED;
  const trendIcon = learner.monthlyTrend === 'up' ? 'ri-arrow-up-line' : learner.monthlyTrend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line';
  return (
    <div className="w-full rounded-xl bg-white p-4 flex items-center gap-4 border" style={{ borderColor: withAlpha(BRAND_PURPLE, 0.15) }}>
      {/* Avatar */}
      <div className="w-14 h-14 rounded-full border-4 border-white bg-primary-700 shrink-0 overflow-hidden" style={{ boxShadow: `0 0 0 2px ${GOLD}` }}>
        {learner.avatarImg ? (
          <img src={learner.avatarImg} alt={learner.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-base font-semibold text-white">{initials}</div>
        )}
      </div>

      {/* Name + role */}
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-accent-50 text-accent-600 border border-accent-200/60 mb-1">
          <AppIcon className="ri-vip-crown-fill text-[10px]"></AppIcon> Top achiever
        </span>
        <p className="text-sm font-medium truncate" style={{ color: TEXT_DARK }}>{learner.name}</p>
        <p className="text-[11px] truncate" style={{ color: TEXT_MUTED }}>{learner.programme}</p>
      </div>

      {/* Points + trend, right-aligned */}
      <div className="text-right shrink-0">
        <p className="text-xl font-medium leading-tight" style={{ color: BRAND_PURPLE }}>
          {learner.points.toLocaleString()}
          <span className="text-[9px] font-medium ml-1" style={{ color: TEXT_MUTED }}>pts</span>
        </p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium" style={{ color: trendColor }}>
          <AppIcon className={trendIcon}></AppIcon> +{learner.pointsThisMonth} this month
        </p>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ['#ffffff', '#F7D77C', RANK_COLORS.first, '#CBB7FF', '#F3B991'];

function useCountUp(target: number, delay: number, reduceMotion: boolean) {
  const [value, setValue] = useState(reduceMotion ? target : 0);

  useEffect(() => {
    if (reduceMotion) {
      setValue(target);
      return;
    }

    setValue(0);
    let animationFrame = 0;
    let startTime = 0;
    const timer = window.setTimeout(() => {
      const animate = (time: number) => {
        if (!startTime) startTime = time;
        const progress = Math.min((time - startTime) / 850, 1);
        setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) animationFrame = requestAnimationFrame(animate);
      };
      animationFrame = requestAnimationFrame(animate);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(animationFrame);
    };
  }, [target, delay, reduceMotion]);

  return value;
}

function ConfettiBurst({ reducedMotion }: { reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let pixelRatio = 1;

    const resizeCanvas = () => {
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    resizeCanvas();
    const pieces = Array.from({ length: 84 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 2 + Math.random() * 4,
      speed: 22 + Math.random() * 34,
      drift: -12 + Math.random() * 24,
      rotation: Math.random() * 360,
      spin: -100 + Math.random() * 200,
      twinkleSpeed: 2 + Math.random() * 4,
      phase: Math.random() * Math.PI * 2,
      shape: Math.random() > 0.48 ? 'sparkle' : 'confetti',
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    }));

    const duration = 11000;
    const fadeOut = 1800;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt * 1000;
      ctx.clearRect(0, 0, width, height);
      const fade = Math.max(0, Math.min(1, (duration - elapsed) / fadeOut));
      pieces.forEach(p => {
        p.y += p.speed * dt;
        p.x += p.drift * dt;
        p.rotation += p.spin * dt;
        if (p.y - p.size > height) {
          p.y = -p.size;
          p.x = Math.random() * width;
        }
        const twinkle = 0.5 + Math.sin(elapsed / 1000 * p.twinkleSpeed + p.phase) * 0.5;
        ctx.save();
        ctx.globalAlpha = fade * (0.35 + twinkle * 0.65);
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        if (p.shape === 'sparkle') {
          const size = p.size * (0.75 + twinkle * 0.65);
          ctx.beginPath();
          ctx.moveTo(0, -size);
          ctx.lineTo(size * 0.34, -size * 0.34);
          ctx.lineTo(size, 0);
          ctx.lineTo(size * 0.34, size * 0.34);
          ctx.lineTo(0, size);
          ctx.lineTo(-size * 0.34, size * 0.34);
          ctx.lineTo(-size, 0);
          ctx.lineTo(-size * 0.34, -size * 0.34);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.52);
        }
        ctx.restore();
      });
      if (elapsed < duration) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, width, height);
    };

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(canvas);
    raf = requestAnimationFrame(tick);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" aria-hidden="true"></canvas>;
}

// Recharts positions its default tooltip next to the pointer. This dashboard
// uses a fixed panel instead so the graph remains readable while the hovered
// values stay in one predictable place inside the card.
function ChartSidePanel({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const firstPoint = payload[0]?.payload ?? {};
  const title = firstPoint.name ?? firstPoint.subject ?? label ?? payload[0]?.name ?? 'Selected data';
  const subtitle = firstPoint.programme;

  return (
    <div className="w-36 rounded-xl border border-primary-100 bg-background-50/95 p-3 shadow-xl backdrop-blur-sm pointer-events-none">
      <p className="text-[10px] font-bold text-foreground-900 truncate">{title}</p>
      {subtitle && <p className="text-[9px] text-foreground-400 truncate mt-0.5">{subtitle}</p>}
      <div className="mt-2 space-y-1.5">
        {payload.map((entry: any) => (
          <div key={entry.dataKey ?? entry.name} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="flex items-center gap-1 min-w-0 text-foreground-500">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: entry.color ?? 'oklch(var(--primary-500))' }}></span>
              <span className="truncate">{entry.name ?? entry.dataKey}</span>
            </span>
            <span className="font-semibold text-foreground-800 shrink-0">{typeof entry.value === 'number' ? Math.round(entry.value) : entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EngagementStatCard({ label, value, sub, trend, trendUp, icon, color }: { label: string; value: string; sub?: string; trend?: string; trendUp?: boolean; icon: string; color: string }) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm p-4 card-premium hover:-translate-y-0.5 cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <span className={`w-11 h-11 rounded-lg flex items-center justify-center ${iconBg}`}>
          <AppIcon className={`${icon} text-base`}></AppIcon>
        </span>
      </div>
      <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      {trend ? (
        <p className={`mt-2 flex items-center gap-1 text-[11px] font-medium ${trendUp ? 'text-emerald-600' : 'text-red-600'}`}>
          <AppIcon className={trendUp ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></AppIcon>
          {trend}
        </p>
      ) : (
        <p className="text-[11px] text-foreground-400 mt-1">{sub}</p>
      )}
    </div>
  );
}
