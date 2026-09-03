import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { LearnerProfilePanel } from '@/pages/engagement/LearnerProfilePanel';
import { EmptyState } from '@/components/feature/EmptyState';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerAnalytics, type LearnerAnalyticsRow } from '@/api/engagement';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { useToast } from '@/hooks/useToast';

const engagementNav = roleNavMap.engagement;

// Mirrors services.ENGAGEMENT_SCORE_WEIGHTS server-side.
const SCORE_DIMENSIONS = [
  { key: 'attendanceRate' as const, label: 'Attendance Rate', weight: 30 },
  { key: 'ksbProgress' as const, label: 'KSB Progression', weight: 30 },
  { key: 'otjhPct' as const, label: 'OTJH Progress', weight: 20 },
  { key: 'quizAverage' as const, label: 'Quiz Average', weight: 20 },
];

function otjhPct(r: LearnerAnalyticsRow) {
  return r.otjhTarget ? Math.min(100, Math.round((r.otjhHours / r.otjhTarget) * 100)) : null;
}

function attendancePct(r: LearnerAnalyticsRow) {
  return r.totalSessions ? Math.round(((r.totalSessions - (r.sessionsMissed ?? 0)) / r.totalSessions) * 100) : null;
}

const RISK_LABEL: Record<'red' | 'amber' | 'green', string> = { red: 'AT RISK', amber: 'MONITOR', green: 'ON TRACK' };
const RISK_BADGE: Record<'red' | 'amber' | 'green', string> = {
  red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-emerald-100 text-emerald-700',
};
const RISK_ROW_BG: Record<'red' | 'amber' | 'green', string> = { red: 'bg-red-50/20', amber: 'bg-amber-50/20', green: '' };
const RISK_AVATAR: Record<'red' | 'amber' | 'green', string> = {
  red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700', green: 'bg-emerald-100 text-emerald-700',
};

export default function LearnerEngagementPage() {
  const navigate = useNavigate();
  const operator = useOperatorIdentity();
  const { warning } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [learners, setLearners] = useState<LearnerAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | 'red' | 'amber' | 'green'>('all');
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLearnerAnalytics()
      .then(data => { if (!cancelled) setLearners(data); })
      .catch(err => { if (!cancelled) warning('Could not load learner analytics', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  const filtered = useMemo(() => learners.filter(l => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || l.programme.toLowerCase().includes(search.toLowerCase());
    const matchRisk = riskFilter === 'all' || l.riskLevel === riskFilter;
    return matchSearch && matchRisk;
  }), [learners, search, riskFilter]);

  // Deep-link support: /engagement/learner-engagement?learner=61 opens that
  // learner's profile directly, e.g. from the absence queue or catch-up panel.
  useEffect(() => {
    const learnerId = searchParams.get('learner');
    if (!learnerId || learners.length === 0) return;
    const match = learners.find(l => l.id === learnerId);
    if (match) setProfileId(match.id);
    setSearchParams(prev => { prev.delete('learner'); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, learners]);

  const greenCount = learners.filter(l => l.riskLevel === 'green').length;
  const amberCount = learners.filter(l => l.riskLevel === 'amber').length;
  const redCount = learners.filter(l => l.riskLevel === 'red').length;
  const scored = learners.filter(l => l.engagementScore != null);
  const avgScore = scored.length ? Math.round(scored.reduce((s, l) => s + (l.engagementScore ?? 0), 0) / scored.length) : null;

  const breakdown = useMemo(() => SCORE_DIMENSIONS.map(dim => {
    const values = learners
      .map(l => dim.key === 'attendanceRate' ? l.attendanceRate : dim.key === 'ksbProgress' ? l.ksbProgress : dim.key === 'otjhPct' ? otjhPct(l) : l.quizAverage)
      .filter((v): v is number => v != null);
    return { ...dim, avg: values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null };
  }), [learners]);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Learner Engagement" pageSubtitle="Real engagement scores computed from attendance, KSB, OTJH and quiz performance"
      userName={operator.name} userRole={operator.role}
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Learner Engagement Analytics"
          description={`Average engagement score: ${avgScore ?? '—'}%. ${greenCount} learners on track, ${amberCount} monitor, ${redCount} at risk.`}
          icon="ri-heart-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20apprentice%20learners%20engaged%20in%20collaborative%20learning%20workshop%20modern%20professional%20setting%20warm%20lighting&width=400&height=160&seq=engagement-learner-01&orientation=landscape"
          imageAlt="Learner Engagement"
          stats={[{ label: 'Avg Score', value: avgScore != null ? `${avgScore}%` : '—' }, { label: 'Below Target', value: String(amberCount + redCount), variant: 'danger' }, { label: 'On Track', value: String(greenCount), variant: 'success' }]}
        />

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <AppIcon className="ri-alert-line text-sm"></AppIcon> Attendance Risk
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" placeholder="Search learners..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {(['all', 'green', 'amber', 'red'] as const).map(f => (
              <button key={f} onClick={() => setRiskFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${riskFilter === f ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {f === 'all' ? 'All' : f === 'green' ? 'On Track' : f === 'amber' ? 'Monitor' : 'At Risk'}
              </button>
            ))}
          </div>
        </div>

        {!loading && learners.length > 0 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Engagement Score Breakdown</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {breakdown.map(dim => (
                <div key={dim.key} className="bg-background-100/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-foreground-700">{dim.label}</span>
                    <span className="text-[10px] text-foreground-400">{dim.weight}%</span>
                  </div>
                  <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${dim.avg != null && dim.avg >= 70 ? 'bg-emerald-500' : dim.avg != null && dim.avg >= 55 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${dim.avg ?? 0}%` }}></div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-foreground-400">Average</span>
                    <span className="text-[10px] font-bold text-foreground-700">{dim.avg != null ? `${dim.avg}%` : 'No data'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Learner Engagement Scores</h3>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} learners</span>
          </div>

          {loading && <p className="text-[11px] text-foreground-400 py-8 text-center">Loading learner analytics…</p>}
          {!loading && filtered.length === 0 && (
            <div className="p-6"><EmptyState icon="ri-search-line" title="No learners match this view" /></div>
          )}

          <div className="divide-y divide-background-200/30">
            {filtered.map(learner => {
              const risk = learner.riskLevel ?? 'green';
              const attPct = attendancePct(learner);
              return (
                <div key={learner.id} className={`p-4 space-y-3 ${RISK_ROW_BG[risk]}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <button onClick={() => setProfileId(learner.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
                      <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold ${RISK_AVATAR[risk]}`}>{learner.name.charAt(0)}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground-900 hover:text-primary-600 transition-smooth">{learner.name}</p>
                        <p className="text-[10px] text-foreground-400">{learner.programme} &middot; {learner.cohort} &middot; {learner.lastActive ? new Date(learner.lastActive).toLocaleDateString('en-GB') : 'No activity yet'}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-foreground-400">Engagement:</span>
                        <span className="font-bold text-sm text-foreground-900">{learner.engagementScore != null ? `${learner.engagementScore}%` : '—'}</span>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${RISK_BADGE[risk]}`}>{RISK_LABEL[risk]}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-foreground-400">Attendance</span>
                      <span className="text-[10px] font-semibold text-foreground-700">{learner.totalSessions ? `${learner.totalSessions - (learner.sessionsMissed ?? 0)}/${learner.totalSessions} sessions (${attPct}%)` : 'No data'}</span>
                    </div>
                    <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${attPct != null && attPct >= 90 ? 'bg-emerald-500' : attPct != null && attPct >= 75 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${attPct ?? 0}%` }}></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-[11px]">
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Quiz Average</p>
                      <p className="font-semibold text-foreground-900">{learner.quizAverage != null ? `${learner.quizAverage}%` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">KSB Progression</p>
                      <p className="font-semibold text-foreground-900">{learner.ksbProgress != null ? `${learner.ksbProgress}%` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Message Response</p>
                      <p className="font-semibold text-foreground-900">{learner.messageResponse != null ? `${learner.messageResponse}%` : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Club Activity</p>
                      <p className="font-semibold text-foreground-900">{learner.clubActivity} {learner.clubActivity === 1 ? 'club' : 'clubs'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Overall Points</p>
                      <p className="font-semibold text-foreground-900">{learner.points.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-foreground-400 mb-0.5">Points This Month</p>
                      <p className="font-semibold text-foreground-900">+{learner.pointsThisMonth}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <LearnerProfilePanel learnerId={profileId} onClose={() => setProfileId(null)} />
    </WorkspaceShell>
  );
}
