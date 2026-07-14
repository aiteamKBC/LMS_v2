import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { ProgrammeFilter } from '@/components/feature/ProgrammeFilter';
import { LearnerProfilePanel } from '@/pages/engagement/LearnerProfilePanel';
import { roleNavMap } from '@/mocks/navigation';
import { ENGAGEMENT_LEARNERS, countByProgramme, filterByProgramme, type ProgrammeCode, type ProgrammeFilterValue } from '@/mocks/engagement-data';

const engagementNav = roleNavMap.engagement;

interface LearnerEngagement {
  id: string;
  name: string;
  avatarImg?: string;
  programmeCode: ProgrammeCode;
  programme: string;
  cohort: string;
  coach: string;
  engagementScore: number;
  lastLogin: string;
  sessionsAttended: number;
  totalSessions: number;
  consecutiveMissed: number;
  lastAttendance: string;
  evidenceSubmitted: number;
  evidenceTarget: number;
  otjhHours: number;
  otjhTarget: number;
  clubActivity: number;
  messageResponse: number;
  trend: 'up' | 'down' | 'stable';
  attendanceTrend: 'deteriorating' | 'declining' | 'stable' | 'improving';
  quizAverage: number;
  ksbProgress: number;
  overallPoints: number;
  overallStatus: 'on-track' | 'monitor' | 'at-risk';
  pointsThisMonth: number;
  monthlyStatus: 'rising' | 'falling' | 'stable';
  badgesCount: number;
  topBadge: string;
  flags: string[];
  attendanceAction: string;
  employerNotified: boolean;
  interventionDate: string | null;
}

// Derived from the shared engagement roster (single source of truth).
const LEARNERS: LearnerEngagement[] = ENGAGEMENT_LEARNERS.map(l => ({
  id: l.id, name: l.name, avatarImg: l.avatarImg, programmeCode: l.programmeCode, programme: l.programme, cohort: l.cohort, coach: l.coach,
  engagementScore: l.engagementScore, lastLogin: l.lastActive, sessionsAttended: l.sessionsAttended, totalSessions: l.totalSessions,
  consecutiveMissed: l.consecutiveMissed, lastAttendance: l.lastAttendance,
  evidenceSubmitted: l.evidenceSubmitted, evidenceTarget: l.evidenceTarget, otjhHours: l.otjhHours, otjhTarget: l.otjhTarget,
  clubActivity: l.clubActivity, messageResponse: l.messageResponse, trend: l.trend, attendanceTrend: l.attendanceTrend,
  quizAverage: l.quizAverage, ksbProgress: l.ksbProgress, overallPoints: l.overallPoints, overallStatus: l.overallStatus,
  pointsThisMonth: l.pointsThisMonth, monthlyStatus: l.monthlyStatus, badgesCount: l.badgesCount, topBadge: l.topBadge,
  flags: l.flags, attendanceAction: l.attendanceAction, employerNotified: l.employerNotified, interventionDate: l.interventionDate,
}));

const OVERALL_STATUS_CONFIG: Record<LearnerEngagement['overallStatus'], { label: string; bg: string; text: string }> = {
  'on-track': { label: 'On Track', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'monitor': { label: 'Monitor', bg: 'bg-amber-100', text: 'text-amber-700' },
  'at-risk': { label: 'At Risk', bg: 'bg-red-100', text: 'text-red-700' },
};

const MONTHLY_STATUS_CONFIG: Record<LearnerEngagement['monthlyStatus'], { label: string; text: string; icon: string }> = {
  rising: { label: 'Rising', text: 'text-emerald-600', icon: 'ri-arrow-up-line' },
  falling: { label: 'Falling', text: 'text-red-600', icon: 'ri-arrow-down-line' },
  stable: { label: 'Stable', text: 'text-foreground-400', icon: 'ri-subtract-line' },
};

const ENGAGEMENT_BREAKDOWN = [
  { label: 'Session Attendance', weight: 30, avg: 82 },
  { label: 'Evidence Submission', weight: 25, avg: 68 },
  { label: 'OTJH Progress', weight: 20, avg: 72 },
  { label: 'Club Activity', weight: 10, avg: 45 },
  { label: 'Message Response', weight: 10, avg: 78 },
  { label: 'Last Login Recency', weight: 5, avg: 85 },
];

type EngagementBand = 'green' | 'amber' | 'red';

// The page presents engagement-score bands, so its filters must use the same
// thresholds as the score colours. `riskLevel` is a broader intervention flag
// that can differ because it also considers attendance and other signals.
function engagementBand(score: number): EngagementBand {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

export default function LearnerEngagementPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | EngagementBand>('all');
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilterValue>('all');
  const [profileId, setProfileId] = useState<string | null>(null);
  const programmeCounts = countByProgramme(LEARNERS);
  const programmeScoped = filterByProgramme(LEARNERS, programmeFilter);
  const filtered = programmeScoped.filter(l => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || l.programme.toLowerCase().includes(search.toLowerCase());
    const matchRisk = riskFilter === 'all' || engagementBand(l.engagementScore) === riskFilter;
    return matchSearch && matchRisk;
  });

  // Deep-link support: /engagement/learner-engagement?learner=en-01 opens that
  // learner's profile directly, e.g. from the absence queue or catch-up panel.
  useEffect(() => {
    const learnerId = searchParams.get('learner');
    if (!learnerId) return;
    const match = LEARNERS.find(l => l.id === learnerId);
    if (match) setProfileId(match.id);
    setSearchParams(prev => { prev.delete('learner'); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const greenCount = programmeScoped.filter(l => engagementBand(l.engagementScore) === 'green').length;
  const amberCount = programmeScoped.filter(l => engagementBand(l.engagementScore) === 'amber').length;
  const redCount = programmeScoped.filter(l => engagementBand(l.engagementScore) === 'red').length;
  const avgScore = programmeScoped.length ? Math.round(programmeScoped.reduce((s, l) => s + l.engagementScore, 0) / programmeScoped.length) : 0;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Learner Engagement" pageSubtitle="Monitor engagement scores, participation metrics, and interaction patterns across all learners"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Learner Engagement Analytics"
          description={`Average engagement score: ${avgScore}%. ${greenCount} learners green, ${amberCount} amber, ${redCount} red. Monitor 6 engagement dimensions across all active learners.`}
          icon="ri-heart-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20apprentice%20learners%20engaged%20in%20collaborative%20learning%20workshop%20modern%20professional%20setting%20warm%20lighting&width=400&height=160&seq=engagement-learner-01&orientation=landscape"
          imageAlt="Learner Engagement"
          stats={[{ label: 'Avg Score', value: `${avgScore}%` }, { label: 'Below Target', value: String(amberCount + redCount), variant: 'danger' }, { label: 'Green', value: String(greenCount), variant: 'success' }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-alert-line text-sm"></i> Attendance Risk
          </button>
        </div>

        {/* Programme Filter */}
        <ProgrammeFilter value={programmeFilter} onChange={setProgrammeFilter} counts={programmeCounts} />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search learners..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {(['all', 'green', 'amber', 'red'] as const).map(f => (
              <button key={f} onClick={() => setRiskFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${riskFilter === f ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f === 'all' ? 'All' : f === 'green' ? 'Green' : f === 'amber' ? 'Amber' : 'Red'}
              </button>
            ))}
          </div>
        </div>

        {/* Engagement Breakdown */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Engagement Score Breakdown</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ENGAGEMENT_BREAKDOWN.map(dim => (
              <div key={dim.label} className="bg-background-100/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-foreground-700">{dim.label}</span>
                  <span className="text-[10px] text-foreground-400">{dim.weight}%</span>
                </div>
                <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${dim.avg >= 80 ? 'bg-emerald-500' : dim.avg >= 60 ? 'bg-primary-500' : 'bg-amber-500'}`} style={{ width: `${dim.avg}%` }}></div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-foreground-400">Average</span>
                  <span className={`text-[10px] font-bold ${dim.avg >= 80 ? 'text-emerald-600' : dim.avg >= 60 ? 'text-primary-600' : 'text-amber-600'}`}>{dim.avg}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Learner List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Learner Engagement Scores</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} learners</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(learner => {
              const attendancePct = Math.round((learner.sessionsAttended / learner.totalSessions) * 100);
              const learnerBand = engagementBand(learner.engagementScore);
              const overallStatus = OVERALL_STATUS_CONFIG[learner.overallStatus];
              const monthlyStatus = MONTHLY_STATUS_CONFIG[learner.monthlyStatus];
              return (
                <div key={learner.id} className={`p-4 space-y-3 ${learnerBand === 'red' ? 'bg-red-50/20' : learnerBand === 'amber' ? 'bg-amber-50/20' : ''}`}>
                  {/* Header row */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <button onClick={() => setProfileId(learner.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
                      <div className="w-10 h-10 rounded-full shrink-0 overflow-hidden bg-background-200">
                        {learner.avatarImg ? (
                          <img src={learner.avatarImg} alt={learner.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full flex items-center justify-center text-sm font-bold ${learnerBand === 'red' ? 'bg-red-100 text-red-700' : learnerBand === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{learner.name.charAt(0)}</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900 hover:text-primary-600 transition-smooth">{learner.name}</p>
                        <p className="text-[10px] text-foreground-400">{learner.programme} &middot; {learner.cohort} &middot; {learner.lastLogin}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-foreground-400">Engagement:</span>
                        <span className={`font-bold text-sm ${learner.engagementScore >= 70 ? 'text-emerald-600' : learner.engagementScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{learner.engagementScore}%</span>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${learnerBand === 'red' ? 'bg-red-100 text-red-700' : learnerBand === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{learnerBand.toUpperCase()}</span>
                    </div>
                  </div>

                  {/* Attendance progress bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-foreground-400">Attendance</span>
                      <span className="text-[10px] font-semibold text-foreground-700">{learner.sessionsAttended}/{learner.totalSessions} sessions ({attendancePct}%)</span>
                    </div>
                    <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${attendancePct >= 90 ? 'bg-emerald-500' : attendancePct >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${attendancePct}%` }}></div>
                    </div>
                  </div>
                  

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-[11px]">
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Quiz Average</p>
                      <p className="font-semibold text-foreground-900">{learner.quizAverage}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">KSB Progression</p>
                      <p className="font-semibold text-foreground-900">{learner.ksbProgress}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Overall Points</p>
                      <p className="font-semibold text-foreground-900">{learner.overallPoints.toLocaleString()}</p>
                      <span className={`inline-block mt-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${overallStatus.bg} ${overallStatus.text}`}>{overallStatus.label}</span>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Points This Month</p>
                      <p className="font-semibold text-foreground-900">+{learner.pointsThisMonth}</p>
                      <span className={`inline-flex items-center gap-0.5 mt-0.5 text-[9px] font-semibold ${monthlyStatus.text}`}>
                        <i className={monthlyStatus.icon}></i>{monthlyStatus.label}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-foreground-400 mb-0.5">Badges</p>
                      <p className="font-semibold text-foreground-900 flex items-center gap-1">
                        <i className="ri-medal-line text-accent-500"></i>
                        {learner.badgesCount} <span className="text-[10px] font-normal text-foreground-400 truncate">&middot; {learner.topBadge}</span>
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Learner Profile Panel — shared rich profile, opens in place */}
      <LearnerProfilePanel learnerId={profileId} onClose={() => setProfileId(null)} />
    </WorkspaceShell>
  );
}
