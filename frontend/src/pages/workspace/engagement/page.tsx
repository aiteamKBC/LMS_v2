import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { useToast } from '@/hooks/useToast';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { LearnerProfilePanel } from '@/pages/engagement/LearnerProfilePanel';
import { roleNavMap } from '@/mocks/navigation';
import {
  fetchVoucherClaims, updateVoucherClaim, fetchLeaderboard, fetchOverviewStats, fetchLearnerAnalytics,
  type LeaderboardEntry, type EngagementOverviewStats, type LearnerAnalyticsRow,
} from '@/api/engagement';
import { type VoucherClaim } from '@/mocks/engagement-data';
import { TableBodySkeleton } from '@/components/feature/Skeletons';
import { EmptyState } from '@/components/feature/EmptyState';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';

const engagementNav = roleNavMap.engagement;

// A leaderboard row plus its own monthly delta, joined client-side from the
// two real /leaderboard/ calls (all-time + monthly) below.
interface RankedLearner {
  id: string;
  name: string;
  cohort: string | null;
  points: number;
  pointsThisMonth: number;
}

function PersonAvatar({ name, className, fallbackClassName }: { name: string; className: string; fallbackClassName: string }) {
  return (
    <div className={`${className} rounded-full shrink-0 overflow-hidden bg-background-200`}>
      <div className={`w-full h-full flex items-center justify-center font-bold ${fallbackClassName}`}>{name.charAt(0)}</div>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-background-200 shrink-0"></div>
          <div className="w-9 h-9 rounded-full bg-background-200 shrink-0"></div>
          <div className="flex-1 h-3 rounded bg-background-200"></div>
          <div className="w-14 h-3 rounded bg-background-200 shrink-0"></div>
        </div>
      ))}
    </div>
  );
}

export default function EngagementDashboard() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const operator = useOperatorIdentity();
  const [selectedChampionId, setSelectedChampionId] = useState<string | null>(null);
  const [championMeta, setChampionMeta] = useState<{ name: string; cohort: string | null } | null>(null);

  const [stats, setStats] = useState<EngagementOverviewStats | null>(null);

  const [leaderboard, setLeaderboard] = useState<RankedLearner[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  const [voucherClaims, setVoucherClaims] = useState<VoucherClaim[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);

  const [learners, setLearners] = useState<LearnerAnalyticsRow[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchLearnerAnalytics()
      .then(data => { if (!cancelled) setLearners(data); })
      .catch(err => { if (!cancelled) warning('Could not load learner analytics', err.message); })
      .finally(() => { if (!cancelled) setAnalyticsLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  useEffect(() => {
    let cancelled = false;
    fetchOverviewStats().catch(err => { if (!cancelled) warning('Could not load engagement stats', err.message); return null; })
      .then(data => { if (!cancelled && data) setStats(data); });
    return () => { cancelled = true; };
  }, [warning]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLeaderboard('all-time'), fetchLeaderboard('monthly')])
      .then(([allTime, monthly]) => {
        if (cancelled) return;
        const monthlyByLearner = new Map(monthly.entries.map(e => [e.learnerId, e.points]));
        setLeaderboard(allTime.entries.map(toRanked(monthlyByLearner)));
      })
      .catch(err => { if (!cancelled) warning('Could not load leaderboard', err.message); })
      .finally(() => { if (!cancelled) setLeaderboardLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

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
      const updated = await updateVoucherClaim(id, { status: 'approved' });
      setVoucherClaims(prev => prev.map(c => c.id === id ? updated : c));
      success(`Claim approved for ${learner}`);
    } catch (err: any) {
      warning('Could not approve claim', err.message);
    }
  }

  async function rejectClaim(id: string, learner: string) {
    try {
      const updated = await updateVoucherClaim(id, { status: 'rejected' });
      setVoucherClaims(prev => prev.map(c => c.id === id ? updated : c));
      warning(`Claim rejected for ${learner}`);
    } catch (err: any) {
      warning('Could not reject claim', err.message);
    }
  }

  function openChampionProfile(learnerId: string) {
    const entry = leaderboard.find(l => l.id === learnerId);
    setChampionMeta(entry ? { name: entry.name, cohort: entry.cohort } : null);
    setSelectedChampionId(learnerId);
  }

  const pendingClaims = voucherClaims.filter(c => c.status === 'pending');

  // -- Chart data, derived from the real bulk learner-analytics fetch -------
  const scoredLearners = learners.filter(l => l.engagementScore != null);
  const engagementDistribution = [
    { range: '0-20%', count: scoredLearners.filter(l => (l.engagementScore ?? 0) <= 20).length, fill: '#ef4444' },
    { range: '21-40%', count: scoredLearners.filter(l => (l.engagementScore ?? 0) > 20 && (l.engagementScore ?? 0) <= 40).length, fill: '#f97316' },
    { range: '41-60%', count: scoredLearners.filter(l => (l.engagementScore ?? 0) > 40 && (l.engagementScore ?? 0) <= 60).length, fill: '#eab308' },
    { range: '61-80%', count: scoredLearners.filter(l => (l.engagementScore ?? 0) > 60 && (l.engagementScore ?? 0) <= 80).length, fill: '#22c55e' },
    { range: '81-100%', count: scoredLearners.filter(l => (l.engagementScore ?? 0) > 80).length, fill: '#10b981' },
  ];
  const otjhRatios = learners.map(l => l.otjhTarget ? l.otjhHours / l.otjhTarget : null).filter((v): v is number => v != null);
  const otjhProgress = [
    { name: 'On Track', value: otjhRatios.filter(v => v >= 0.9).length, color: '#22c55e' },
    { name: 'Slightly Behind', value: otjhRatios.filter(v => v >= 0.75 && v < 0.9).length, color: '#eab308' },
    { name: 'Significantly Behind', value: otjhRatios.filter(v => v >= 0.5 && v < 0.75).length, color: '#f97316' },
    { name: 'At Risk', value: otjhRatios.filter(v => v < 0.5).length, color: '#ef4444' },
  ];
  const riskBreakdown = [
    { name: 'On track', value: learners.filter(l => l.riskLevel === 'green').length, color: '#22c55e' },
    { name: 'Monitor', value: learners.filter(l => l.riskLevel === 'amber').length, color: '#f59e0b' },
    { name: 'At risk', value: learners.filter(l => l.riskLevel === 'red').length, color: '#ef4444' },
  ];
  const avgOf = (values: (number | null)[]) => { const v = values.filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0; };
  const engagementDrivers = [
    { name: 'Attendance', value: avgOf(learners.map(l => l.attendanceRate)) },
    { name: 'Evidence', value: avgOf(learners.map(l => l.evidenceTarget ? (l.evidenceSubmitted / l.evidenceTarget) * 100 : null)) },
    { name: 'OTJH', value: avgOf(learners.map(l => l.otjhTarget ? (l.otjhHours / l.otjhTarget) * 100 : null)) },
    { name: 'Quiz', value: avgOf(learners.map(l => l.quizAverage)) },
    { name: 'KSB', value: avgOf(learners.map(l => l.ksbProgress)) },
    { name: 'Messages', value: avgOf(learners.map(l => l.messageResponse)) },
  ];
  const programmeNames = Array.from(new Set(learners.map(l => l.programme).filter(Boolean)));
  const programmeComparison = programmeNames.map(name => {
    const group = learners.filter(l => l.programme === name);
    return { name, engagement: avgOf(group.map(l => l.engagementScore)), attendance: avgOf(group.map(l => l.attendanceRate)), learnerCount: group.length };
  });

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Engagement Command Centre" pageSubtitle="Points economy overview — grants, leaderboard, and voucher claims"
      userName={operator.name} userRole={operator.role}
    >
      <div className="engagement-command-page p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Engagement Command Centre"
          description={`${stats ? stats.activeLearners.toLocaleString() : '…'} learners earned points this month. ${pendingClaims.length} voucher claim${pendingClaims.length === 1 ? '' : 's'} awaiting review.`}
          icon="ri-heart-pulse-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20learner%20engagement%20group%20collaboration%20team%20discussion%20apprenticeship%20purple%20gold%20accent%20editorial%20photography%20modern%20office%20warm%20welcoming%20atmosphere&width=400&height=160&seq=engagement-hero-01&orientation=landscape"
          imageAlt="Engagement Command Centre"
          stats={[
            { label: 'Active Learners', value: stats ? String(stats.activeLearners) : '…' },
            { label: 'Points This Month', value: stats ? stats.pointsAwardedThisMonth.toLocaleString() : '…' },
            { label: 'Pending Claims', value: String(pendingClaims.length) },
          ]}
        />

        {/* Stat Cards — real points-economy aggregates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <EngagementStatCard
            label="Points Awarded" value={stats ? `${(stats.pointsAwarded / 1000).toFixed(1)}k` : '…'}
            trend={stats ? `+${stats.pointsAwardedThisMonth.toLocaleString()} this month` : undefined} trendUp
            icon="ri-award-line" color="accent"
          />
          <EngagementStatCard
            label="Vouchers Claimed" value={stats ? String(stats.vouchersClaimed) : '…'}
            trend={stats ? `+${stats.vouchersClaimedThisMonth} this month` : undefined} trendUp
            icon="ri-coupon-3-line" color="secondary"
          />
          <EngagementStatCard
            label="Active Learners" value={stats ? String(stats.activeLearners) : '…'}
            sub="earned points this month" icon="ri-group-line" color="primary"
          />
          <EngagementStatCard
            label="Event Seats Booked" value={stats ? String(stats.eventSeatsBooked) : '…'}
            icon="ri-calendar-event-line" color="primary"
          />
        </div>

        {/* Champions podium + Top Learners Leaderboard, side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="lg:order-2">
            {leaderboardLoading ? (
              <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm p-6"><LeaderboardSkeleton /></div>
            ) : leaderboard.length < 3 ? (
              <div className="h-full flex items-center">
                <EmptyState icon="ri-trophy-line" title="Not enough grants yet for a podium" subtitle="At least 3 learners need points on the board." />
              </div>
            ) : (
              <CourseChampionsPodium champions={leaderboard.slice(0, 3)} onViewAll={() => navigate('/engagement/recognition')} onOpenProfile={openChampionProfile} />
            )}
          </div>

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
            {leaderboardLoading ? (
              <LeaderboardSkeleton />
            ) : leaderboard.length === 0 ? (
              <div className="flex-1 flex items-center p-4">
                <EmptyState icon="ri-list-check" title="No points earned yet" />
              </div>
            ) : (
              <div className="flex-1 flex flex-col divide-y divide-background-200/30">
                {leaderboard.slice(0, 8).map((l, i) => (
                  <button key={l.id} onClick={() => openChampionProfile(l.id)} className="flex-1 p-4 flex items-center gap-4 hover:bg-background-100/50 transition-smooth text-left cursor-pointer">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      i === 0 ? 'bg-accent-400 text-white' :
                      i === 1 ? 'bg-foreground-300 text-white' :
                      i === 2 ? 'bg-amber-700/70 text-white' :
                      'bg-background-200 text-foreground-500 border border-foreground-200/60'
                    }`}>{i + 1}</span>
                    <PersonAvatar name={l.name} className="w-9 h-9" fallbackClassName="text-xs bg-primary-100 text-primary-700" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground-900 truncate">{l.name}</p>
                      <p className="text-[10px] text-foreground-400 truncate">{l.cohort || '—'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-foreground-900">{l.points.toLocaleString()} <span className="text-[10px] font-normal text-foreground-400">pts</span></p>
                      <p className="text-[10px] font-medium text-foreground-400">+{l.pointsThisMonth} this month</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Vouchers Claimed — Need Approval */}
        <section className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-foreground-200/60 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Vouchers Claimed — Need Approval</h3>
              <p className="text-[11px] text-foreground-400 mt-0.5">Voucher redemption requests awaiting review</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-foreground-400 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">{pendingClaims.length} pending</span>
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
                {!claimsLoading && pendingClaims.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-6 text-center text-[11px] text-foreground-400">No voucher claims are pending review.</td></tr>
                )}
                {pendingClaims.map(claim => (
                  <tr key={claim.id} className="hover:bg-background-100/50 transition-smooth">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <PersonAvatar name={claim.learner} className="w-8 h-8" fallbackClassName="text-xs bg-accent-100 text-accent-600" />
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

        {/* Analytics charts — real data from /engagement_api/learner-analytics/ */}
        {!analyticsLoading && learners.length > 0 && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Engagement Score Distribution</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Learners by engagement score range</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">{scoredLearners.length} scored</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={engagementDistribution} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--background-200)" />
                    <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={{ stroke: 'var(--background-200)' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Learners">
                      {engagementDistribution.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH Progress</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Learners by off-the-job training progress status</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">{otjhProgress[0].value} on track</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={otjhProgress} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" stroke="none">
                      {otjhProgress.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Pie>
                    <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-900 text-2xl font-semibold">{learners.length}</text>
                    <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-400 text-[10px]">learners</text>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px' }} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Risk Breakdown</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Current learner risk distribution</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">{learners.length} learners</span>
                </div>
                <div className="flex items-center gap-5">
                  <ResponsiveContainer width="48%" height={190}>
                    <PieChart>
                      <Pie data={riskBreakdown} dataKey="value" innerRadius={48} outerRadius={72} paddingAngle={3} stroke="none">
                        {riskBreakdown.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-900 text-xl font-semibold">{learners.length}</text>
                      <text x="50%" y="59%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground-400 text-[9px]">learners</text>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-3">
                    {riskBreakdown.map(entry => (
                      <div key={entry.name} className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-2 text-foreground-500"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }}></span>{entry.name}</span>
                        <span className="font-semibold text-foreground-800">{entry.value} <span className="font-normal text-foreground-400">({learners.length ? Math.round(entry.value / learners.length * 100) : 0}%)</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Engagement Drivers</h3>
                    <p className="text-[11px] text-foreground-400 mt-0.5">Average performance across key signals</p>
                  </div>
                  <span className="text-[10px] text-foreground-500 bg-background-100 px-2 py-1 rounded-full">0-100%</span>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={engagementDrivers} layout="vertical" margin={{ top: 0, right: 10, left: 5, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="var(--background-200)" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={62} tick={{ fontSize: 10, fill: 'var(--foreground-500)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px' }} />
                    <Bar dataKey="value" fill="oklch(var(--primary-500))" radius={[0, 5, 5, 0]} barSize={14} name="Average" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {programmeComparison.length > 1 && (
                <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 lg:col-span-2">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-heading font-semibold text-foreground-900">Programme Comparison</h3>
                      <p className="text-[11px] text-foreground-400 mt-0.5">Average engagement and attendance by programme</p>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-foreground-400"><span><AppIcon className="ri-checkbox-blank-circle-fill text-primary-500 mr-1"></AppIcon>Engagement</span><span><AppIcon className="ri-checkbox-blank-circle-fill text-accent-500 mr-1"></AppIcon>Attendance</span></div>
                  </div>
                  <ResponsiveContainer width="100%" height={Math.max(120, programmeComparison.length * 46)}>
                    <BarChart data={programmeComparison} layout="vertical" margin={{ top: 0, right: 10, left: 5, bottom: 0 }} barGap={3}>
                      <CartesianGrid horizontal={false} stroke="var(--background-200)" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--foreground-400)' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 9, fill: 'var(--foreground-500)' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--background-200)', fontSize: '11px' }} />
                      <Bar dataKey="engagement" fill="oklch(var(--primary-500))" radius={[0, 4, 4, 0]} barSize={9} name="Engagement" />
                      <Bar dataKey="attendance" fill="oklch(var(--accent-500))" radius={[0, 4, 4, 0]} barSize={9} name="Attendance" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </>
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

        <LearnerProfilePanel
          learnerId={selectedChampionId}
          learnerName={championMeta?.name}
          cohort={championMeta?.cohort ?? undefined}
          onClose={() => setSelectedChampionId(null)}
        />
      </div>
    </WorkspaceShell>
  );
}

function toRanked(monthlyByLearner: Map<string, number>) {
  return (entry: LeaderboardEntry): RankedLearner => ({
    id: entry.learnerId, name: entry.learner, cohort: entry.cohort,
    points: entry.points, pointsThisMonth: monthlyByLearner.get(entry.learnerId) ?? 0,
  });
}

function CourseChampionsPodium({ champions, onViewAll, onOpenProfile }: { champions: RankedLearner[]; onViewAll: () => void; onOpenProfile: (learnerId: string) => void }) {
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

function PodiumSpot({ learner, rank, revealDelay, gapLabel, reduceMotion, onOpenProfile }: { learner: RankedLearner; rank: 1 | 2 | 3; revealDelay: number; gapLabel: string; reduceMotion: boolean; onOpenProfile: (learnerId: string) => void }) {
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
          <div className={`w-full h-full flex items-center justify-center font-semibold text-white ${isFirst ? 'text-xl' : 'text-base'}`}>
            {initials}
          </div>
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

function TopAchieverCard({ learner }: { learner: RankedLearner }) {
  const initials = learner.name.split(' ').map(w => w[0]).join('').slice(0, 2);
  return (
    <div className="w-full rounded-xl bg-white p-4 flex items-center gap-4 border" style={{ borderColor: withAlpha(BRAND_PURPLE, 0.15) }}>
      {/* Avatar */}
      <div className="w-14 h-14 rounded-full border-4 border-white bg-primary-700 shrink-0 overflow-hidden" style={{ boxShadow: `0 0 0 2px ${GOLD}` }}>
        <div className="w-full h-full flex items-center justify-center text-base font-semibold text-white">{initials}</div>
      </div>

      {/* Name + role */}
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-accent-50 text-accent-600 border border-accent-200/60 mb-1">
          <AppIcon className="ri-vip-crown-fill text-[10px]"></AppIcon> Top achiever
        </span>
        <p className="text-sm font-medium truncate" style={{ color: TEXT_DARK }}>{learner.name}</p>
        <p className="text-[11px] truncate" style={{ color: TEXT_MUTED }}>{learner.cohort || '—'}</p>
      </div>

      {/* Points + this-month delta, right-aligned */}
      <div className="text-right shrink-0">
        <p className="text-xl font-medium leading-tight" style={{ color: BRAND_PURPLE }}>
          {learner.points.toLocaleString()}
          <span className="text-[9px] font-medium ml-1" style={{ color: TEXT_MUTED }}>pts</span>
        </p>
        <p className="mt-0.5 text-[11px] font-medium" style={{ color: TEXT_MUTED }}>
          +{learner.pointsThisMonth} this month
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

function EngagementStatCard({ label, value, sub, trend, trendUp, icon, color }: { label: string; value: string; sub?: string; trend?: string; trendUp?: boolean; icon: string; color: string }) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-sm p-4 card-premium hover:-translate-y-0.5">
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
      ) : sub ? (
        <p className="text-[11px] text-foreground-400 mt-1">{sub}</p>
      ) : null}
    </div>
  );
}
