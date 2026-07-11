import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { ProgrammeFilter } from '@/components/feature/ProgrammeFilter';
import { roleNavMap } from '@/mocks/navigation';
import {
  ENGAGEMENT_LEARNERS as ROSTER, VOUCHER_CLAIMS,
  countByProgramme, filterByProgramme, type ProgrammeCode, type ProgrammeFilterValue,
} from '@/mocks/engagement-data';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';

const engagementNav = roleNavMap.engagement;

type TabKey = 'overview' | 'attendance' | 'engagement';

interface EngagementLearner {
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
  name: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, programme: l.programme, cohort: l.cohort,
  engagementScore: l.engagementScore, attendanceRate: l.attendanceRate, lastActive: l.lastActive,
  riskLevel: l.riskLevel, trend: l.trend, flags: l.flags, points: l.overallPoints, pointsThisMonth: l.pointsThisMonth,
  monthlyTrend: l.monthlyStatus === 'rising' ? 'up' : l.monthlyStatus === 'falling' ? 'down' : 'stable',
}));

const TOP_LEARNERS = [...ENGAGEMENT_LEARNERS].sort((a, b) => b.points - a.points);

const PENDING_VOUCHER_CLAIMS = VOUCHER_CLAIMS
  .filter(v => v.status === 'pending')
  .map(v => ({ id: v.id, learner: v.learner, avatarImg: v.avatarImg, programmeCode: v.programmeCode, programme: v.programme, reward: v.reward, points: v.points, requestedAt: v.requestedAt, deliveryMethod: v.deliveryMethod }));

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

const ENGAGEMENT_DISTRIBUTION = [
  { range: '0-20%', count: 1, fill: '#ef4444' },
  { range: '21-40%', count: 2, fill: '#f97316' },
  { range: '41-60%', count: 4, fill: '#eab308' },
  { range: '61-80%', count: 12, fill: '#22c55e' },
  { range: '81-100%', count: 6, fill: '#10b981' },
];

const OTJH_PROGRESS_DATA = [
  { name: 'On Track', value: 38, color: '#22c55e' },
  { name: 'Slightly Behind', value: 12, color: '#eab308' },
  { name: 'Significantly Behind', value: 6, color: '#f97316' },
  { name: 'At Risk', value: 3, color: '#ef4444' },
];

const CLUB_ACTIVITY_DATA = [
  { subject: 'Attendance', Marketing: 85, Leadership: 78, AI: 92, Career: 70, Sustainability: 65, Project: 80, British: 75 },
  { subject: 'Contributions', Marketing: 90, Leadership: 82, AI: 88, Career: 75, Sustainability: 60, Project: 85, British: 70 },
  { subject: 'New Members', Marketing: 75, Leadership: 65, AI: 80, Career: 70, Sustainability: 55, Project: 72, British: 68 },
  { subject: 'Events Held', Marketing: 80, Leadership: 70, AI: 85, Career: 60, Sustainability: 50, Project: 75, British: 65 },
  { subject: 'Points Earned', Marketing: 95, Leadership: 88, AI: 90, Career: 72, Sustainability: 58, Project: 82, British: 74 },
];

const CLUB_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

export default function EngagementDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilterValue>('all');

  const programmeCounts = countByProgramme(ENGAGEMENT_LEARNERS);
  const filteredLearners = filterByProgramme(ENGAGEMENT_LEARNERS, programmeFilter);
  const filteredTopLearners = [...filteredLearners].sort((a, b) => b.points - a.points);
  const filteredAttendanceRisk = filterByProgramme(ATTENDANCE_RISK, programmeFilter);
  const filteredVoucherClaims = filterByProgramme(PENDING_VOUCHER_CLAIMS, programmeFilter);

  const redRiskCount = filteredLearners.filter(l => l.riskLevel === 'red').length;
  const amberRiskCount = filteredLearners.filter(l => l.riskLevel === 'amber').length;
  const greenRiskCount = filteredLearners.filter(l => l.riskLevel === 'green').length;
  const avgEngagement = filteredLearners.length ? Math.round(filteredLearners.reduce((sum, l) => sum + l.engagementScore, 0) / filteredLearners.length) : 0;

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
              <i className={`${tab.icon} text-sm`}></i>
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
                <CourseChampionsPodium champions={filteredTopLearners.slice(0, 3)} onViewAll={() => navigate('/engagement/recognition')} />
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
                          <i className={l.monthlyTrend === 'up' ? 'ri-arrow-up-line' : l.monthlyTrend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'}></i>
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
                        <i className={`${l.trend === 'up' ? 'ri-arrow-up-line' : l.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'} text-[9px] mr-0.5`}></i>
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
                    {filteredVoucherClaims.length === 0 && (
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
                            <button className="px-3 py-1.5 bg-emerald-500/10 text-emerald-700 rounded-lg text-[10px] font-bold hover:bg-emerald-500/20 transition-smooth cursor-pointer whitespace-nowrap">Approve</button>
                            <button className="px-3 py-1.5 bg-red-500/10 text-red-700 rounded-lg text-[10px] font-bold hover:bg-red-500/20 transition-smooth cursor-pointer whitespace-nowrap">Reject</button>
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
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">Last 10 weeks</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ATTENDANCE_TREND_DATA} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                    <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
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
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{ENGAGEMENT_DISTRIBUTION.reduce((s, d) => s + d.count, 0)} learners</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={ENGAGEMENT_DISTRIBUTION} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Learners">
                      {ENGAGEMENT_DISTRIBUTION.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Charts Row 2 - OTJH Pie + Club Radar */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* OTJH Progress Pie Chart */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH Progress</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Learners by off-the-job training progress status</p>
                  </div>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">59 learners</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={OTJH_PROGRESS_DATA}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="none"
                    >
                      {OTJH_PROGRESS_DATA.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Club Activity Radar Chart */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Club Activity</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Performance across learner clubs by dimension</p>
                  </div>
                  <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">7 clubs</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={CLUB_ACTIVITY_DATA} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                    <PolarGrid stroke="var(--background-200)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--foreground-400)' }} />
                    <Radar name="Marketing" dataKey="Marketing" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="Leadership" dataKey="Leadership" stroke="#f97316" fill="#f97316" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="AI" dataKey="AI" stroke="#eab308" fill="#eab308" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="Career" dataKey="Career" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} strokeWidth={1.5} />
                    <Radar name="Sustainability" dataKey="Sustainability" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={1.5} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px', background: 'var(--background-50)' }} />
                  </RadarChart>
                </ResponsiveContainer>
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
                    <i className="ri-alert-line text-amber-600 text-sm mt-0.5"></i>
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
                <i className="ri-download-line mr-1"></i> Export Report
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
                          <i className="ri-phone-line mr-1"></i> Contact
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
                <i className={`${link.icon} text-sm`}></i>
              </span>
              <span className="text-center whitespace-nowrap">{link.label}</span>
            </button>
          ))}
        </section>
      </div>
    </WorkspaceShell>
  );
}

function ProgrammeEmptyState({ message }: { message: string }) {
  return (
    <div className="p-6 text-center text-[11px] text-foreground-400">
      <i className="ri-filter-off-line text-lg text-foreground-300 block mb-1"></i>
      {message}
    </div>
  );
}

function CourseChampionsPodium({ champions, onViewAll }: { champions: EngagementLearner[]; onViewAll: () => void }) {
  const [first, second, third] = champions;
  if (!first || !second || !third) return null;

  return (
    <section className="relative rounded-2xl border shadow-xl overflow-hidden animate-hero-fade-in-up" style={{ backgroundColor: BG_LIGHT_PURPLE, borderColor: withAlpha(BRAND_PURPLE, 0.12) }}>
      <ConfettiBurst />
      {/* Bevel hairline — light-register analog of the app hero's top highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-white/60 pointer-events-none z-10"></div>
      {/* Ambient glows tuned for the light surface — decorative only */}
      <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full blur-3xl pointer-events-none" style={{ background: `radial-gradient(circle, ${withAlpha(GOLD, 0.14)} 0%, transparent 70%)` }}></div>
      <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full blur-3xl pointer-events-none" style={{ background: `radial-gradient(circle, ${withAlpha(BRAND_PURPLE, 0.14)} 0%, transparent 70%)` }}></div>

      <div className="relative z-20 p-6 sm:p-8">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full mb-3 border" style={{ backgroundColor: withAlpha(BRAND_PURPLE, 0.1), borderColor: withAlpha(BRAND_PURPLE, 0.3), color: BRAND_PURPLE }}>
            <i className="ri-trophy-line"></i> Engagement Sprint
          </span>
          <h3 className="text-xl font-heading font-medium" style={{ color: TEXT_DARK }}>Champions</h3>
          <p className="text-[12px] mt-1" style={{ color: TEXT_MUTED }}>Celebrating this month's top performers by points earned</p>
        </div>

        {/* Podium — full width, centered, blocks flush against each other */}
        <div className="w-full max-w-md sm:max-w-lg mx-auto flex items-end justify-center stagger-children">
          <PodiumSpot learner={second} rank={2} />
          <PodiumSpot learner={first} rank={1} />
          <PodiumSpot learner={third} rank={3} />
        </div>

        {/* Top Achiever spotlight strip — full width, below the podium */}
        <div className="mt-8">
          <TopAchieverCard learner={first} />
        </div>

        <div className="text-center mt-6">
          <button onClick={onViewAll} className="text-[11px] font-medium hover:opacity-70 transition-smooth cursor-pointer" style={{ color: BRAND_PURPLE }}>
            View full leaderboard <i className="ri-arrow-right-line ml-1"></i>
          </button>
        </div>
      </div>
    </section>
  );
}

// Engagement Sprint podium palette — centralized here so no rank/brand hex
// value is ever hardcoded inline elsewhere in this component.
const RANK_COLORS = {
  first: '#4A12C4',
  second: '#6F35F5',
  third: '#9A7AF7',
} as const;
const BRAND_PURPLE = '#5B18E3';
const TEXT_DARK = '#1E124D';
const TEXT_MUTED = '#6B5C99';
const BG_LIGHT_PURPLE = '#EBE3FC';
const SUCCESS_GREEN = '#2F8F5B';
// Heritage gold — the design system reserves accent-* gold for celebratory
// focal points, so the #1 champion is accented with it. DOM elements use the
// Tailwind accent-* tokens directly; this hex mirrors oklch(var(--accent-500))
// for the canvas confetti, which can't reference CSS classes.
const GOLD = '#C8951F';

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
    badgeStyle: { backgroundColor: RANK_COLORS.first, color: '#ffffff' },
    // White border = the ring gap; gold box-shadow ring + soft glow (champion).
    ringStyle: { boxShadow: `0 0 0 2px ${GOLD}, 0 10px 24px -6px ${withAlpha(GOLD, 0.5)}` },
    barStyle: {
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 22px -10px ${withAlpha(GOLD, 0.45)}`,
      background: `linear-gradient(to bottom, ${lighten(RANK_COLORS.first, 0.22)} 0%, ${RANK_COLORS.first} 100%)`,
    },
    barIcon: 'ri-trophy-fill',
    barIconStyle: { color: '#ffffff', opacity: 0.6 },
    barHeight: 'h-40 sm:h-52',
    avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
    order: 'order-1 sm:order-2',
  },
  2: {
    badgeStyle: { backgroundColor: RANK_COLORS.second, color: '#ffffff' },
    ringStyle: { boxShadow: `0 0 0 2px ${RANK_COLORS.second}, 0 8px 18px -8px ${withAlpha(RANK_COLORS.second, 0.45)}` },
    barStyle: {
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 22px -10px ${withAlpha(RANK_COLORS.second, 0.4)}`,
      background: `linear-gradient(to bottom, ${lighten(RANK_COLORS.second, 0.2)} 0%, ${RANK_COLORS.second} 100%)`,
    },
    barIcon: 'ri-medal-fill',
    barIconStyle: { color: '#ffffff', opacity: 0.6 },
    barHeight: 'h-28 sm:h-36',
    avatarSize: 'w-16 h-16 sm:w-20 sm:h-20',
    order: 'order-2 sm:order-1',
  },
  3: {
    badgeStyle: { backgroundColor: RANK_COLORS.third, color: TEXT_DARK },
    ringStyle: { boxShadow: `0 0 0 2px ${RANK_COLORS.third}, 0 8px 18px -8px ${withAlpha(RANK_COLORS.third, 0.45)}` },
    barStyle: {
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 22px -10px ${withAlpha(RANK_COLORS.third, 0.4)}`,
      background: `linear-gradient(to bottom, ${lighten(RANK_COLORS.third, 0.18)} 0%, ${RANK_COLORS.third} 100%)`,
    },
    // Lightest bar — dark icon at low opacity keeps it a subtle texture, not white-on-light.
    barIcon: 'ri-medal-fill',
    barIconStyle: { color: TEXT_DARK, opacity: 0.35 },
    barHeight: 'h-24 sm:h-32',
    avatarSize: 'w-16 h-16 sm:w-20 sm:h-20',
    order: 'order-3 sm:order-3',
  },
} as const;

function PodiumSpot({ learner, rank }: { learner: EngagementLearner; rank: 1 | 2 | 3 }) {
  const isFirst = rank === 1;
  const initials = learner.name.split(' ').map(w => w[0]).join('').slice(0, 2);
  const styles = PODIUM_RANK_STYLES[rank];

  return (
    <div className={`flex-1 flex flex-col items-center ${styles.order} ${isFirst ? 'relative z-10' : ''}`}>
      {/* Avatar with a white ring gap; badge is punched out with a panel-colored border */}
      <div className="relative mb-3">
        {isFirst && (
          <i className="ri-vip-crown-fill absolute -top-8 left-1/2 -translate-x-1/2 text-3xl drop-shadow-lg" style={{ color: GOLD }}></i>
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
          style={{ ...styles.badgeStyle, borderColor: BG_LIGHT_PURPLE }}
        >
          {rank}
        </span>
      </div>

      <p className="text-[13px] font-medium text-center truncate max-w-full px-1" style={{ color: TEXT_DARK }}>{learner.name}</p>
      <p className="text-[11px] font-medium mt-0.5" style={{ color: BRAND_PURPLE }}>{learner.points.toLocaleString()} pts</p>

      {/* Grand champion pill — sits above the 1st-place bar, below name/points */}
      {isFirst && (
        <span
          className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full text-[9px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
          style={{ background: `linear-gradient(135deg, ${GOLD} 0%, ${lighten(GOLD, 0.35)} 100%)`, color: TEXT_DARK }}
        >
          <i className="ri-vip-crown-fill text-[10px]"></i> Grand champion
        </span>
      )}

      {/* Podium bar — tonal ramp, top-only 12px radius, subtle icon as texture */}
      <div
        className={`w-full ${styles.barHeight} rounded-t-xl mt-3 flex items-start justify-center pt-3`}
        style={styles.barStyle}
      >
        <i className={`${styles.barIcon} text-3xl`} style={styles.barIconStyle}></i>
      </div>
    </div>
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
          <i className="ri-vip-crown-fill text-[10px]"></i> Top achiever
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
          <i className={trendIcon}></i> +{learner.pointsThisMonth} this month
        </p>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = [RANK_COLORS.first, RANK_COLORS.second, RANK_COLORS.third, GOLD];

function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    canvas.width = width;
    canvas.height = height;

    const pieces = Array.from({ length: 50 }, () => ({
      x: Math.random() * width,
      y: -20 - Math.random() * height * 0.6,
      size: 4 + Math.random() * 5,
      speed: 1.2 + Math.random() * 2,
      drift: (Math.random() - 0.5) * 1.2,
      rotation: Math.random() * 360,
      spin: (Math.random() - 0.5) * 8,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    }));

    const duration = 10000;
    const fadeOut = 1200; // only fade during the final stretch, not the whole run
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      elapsed += dt;
      ctx.clearRect(0, 0, width, height);
      const fade = Math.max(0, Math.min(1, (duration - elapsed) / fadeOut));
      pieces.forEach(p => {
        p.y += p.speed;
        p.x += p.drift;
        p.rotation += p.spin;
        // Recycle pieces that fall off the bottom so the fall stays continuous
        // for the whole duration instead of emptying out after a few seconds.
        if (p.y - p.size > height) {
          p.y = -20;
          p.x = Math.random() * width;
        }
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
        ctx.restore();
      });
      if (elapsed < duration) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, width, height);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" aria-hidden="true"></canvas>;
}

function EngagementStatCard({ label, value, sub, trend, trendUp, icon, color }: { label: string; value: string; sub?: string; trend?: string; trendUp?: boolean; icon: string; color: string }) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm p-4 card-premium hover:-translate-y-0.5 cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <span className={`w-11 h-11 rounded-lg flex items-center justify-center ${iconBg}`}>
          <i className={`${icon} text-base`}></i>
        </span>
      </div>
      <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      {trend ? (
        <p className={`mt-2 flex items-center gap-1 text-[11px] font-medium ${trendUp ? 'text-emerald-600' : 'text-red-600'}`}>
          <i className={trendUp ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></i>
          {trend}
        </p>
      ) : (
        <p className="text-[11px] text-foreground-400 mt-1">{sub}</p>
      )}
    </div>
  );
}