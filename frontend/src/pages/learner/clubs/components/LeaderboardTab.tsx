import { useEffect, useMemo, useState } from 'react';
import { fetchLeaderboard, type LeaderboardEntry as RankedEntry } from '@/api/engagement';
import { fetchLearnerDetail } from '@/api/learnerDetail';
import { useMyLearner } from '@/hooks/useMyLearner';
import { POINT_RULES, POINTS_HISTORY, COMMUNITY_IMPACT } from '../data';

// 'club' maps to a cohort-scoped ranking (the viewer's own cohort) — true
// club-membership ranking is deferred until clubs have per-learner membership
// rows (today Engagement.club_meetings only tracks an integer attendee
// counter). See engagement_api.views.leaderboard.
type RankingType = 'monthly' | 'all-time' | 'club';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

const rankingTabs: { key: RankingType; label: string; icon: string }[] = [
  { key: 'monthly', label: 'Monthly Rankings', icon: 'ri-calendar-line' },
  { key: 'all-time', label: 'All-Time Rankings', icon: 'ri-trophy-line' },
  { key: 'club', label: 'Cohort Rankings', icon: 'ri-community-line' },
];

export function LeaderboardTab() {
  const myLearner = useMyLearner();
  const [rankingType, setRankingType] = useState<RankingType>('monthly');
  const [myCohort, setMyCohort] = useState<string | null>(null);
  const [entries, setEntries] = useState<RankedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchLearnerDetail(myLearner.kind, myLearner.id)
      .then(detail => { if (!cancelled) setMyCohort(detail.cohort || null); })
      .catch(() => { /* leaderboard still works without cohort scoping */ });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const scope = rankingType === 'monthly' ? 'monthly' : 'all-time';
    const cohort = rankingType === 'club' ? myCohort || undefined : undefined;
    if (rankingType === 'club' && !myCohort) { setEntries([]); setLoading(false); return; }
    fetchLeaderboard(scope, cohort)
      .then(result => { if (!cancelled) { setEntries(result.entries); setError(''); } })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load the leaderboard.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rankingType, myCohort]);

  const myEntry = useMemo(() => entries.find(e => e.learnerId === myLearner.id) ?? null, [entries, myLearner.id]);
  const podium = entries.slice(0, 3);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Community Leaderboard</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Ranked by real points earned — spending points doesn't affect your rank</p>
        </div>
      </div>

      {/* User Rank Banner */}
      {myEntry && (
        <div className="bg-primary-50/40 rounded-xl border border-primary-200/50 p-4 mb-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-sm font-bold">{initials(myEntry.learner)}</div>
          <div>
            <p className="text-sm font-semibold text-foreground-900">You are Rank #{myEntry.rank}</p>
            <p className="text-xs text-foreground-400 mt-0.5">{myEntry.points.toLocaleString()} points earned</p>
          </div>
        </div>
      )}

      {/* Ranking Type Tabs */}
      <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 mb-5 overflow-x-auto">
        {rankingTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setRankingType(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
              rankingType === tab.key
                ? 'bg-background-50 text-foreground-900 shadow-sm'
                : 'text-foreground-500 hover:text-foreground-700'
            }`}
          >
            <AppIcon className={`${tab.icon} text-xs`}></AppIcon>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-xs text-foreground-400 py-6 text-center">Loading rankings…</p>}

      {!loading && error && <p className="text-xs text-red-500 py-6 text-center">{error}</p>}

      {!loading && !error && rankingType === 'club' && !myCohort && (
        <p className="text-xs text-foreground-400 py-6 text-center">Your cohort isn't set yet, so a cohort ranking isn't available.</p>
      )}

      {!loading && !error && entries.length === 0 && !(rankingType === 'club' && !myCohort) && (
        <p className="text-xs text-foreground-400 py-6 text-center">No points earned in this ranking yet.</p>
      )}

      {!loading && !error && entries.length > 0 && (
        <>
          {/* Top 3 Podium */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {podium.map((entry, i) => {
              const podiumStyles = [
                'bg-gradient-to-b from-amber-50 to-amber-100 border-amber-200/60',
                'bg-gradient-to-b from-slate-50 to-slate-100 border-slate-200/60',
                'bg-gradient-to-b from-orange-50 to-orange-100 border-orange-200/60',
              ];
              const rankIcons = ['ri-medal-fill text-amber-500 text-xl', 'ri-medal-fill text-slate-400 text-lg', 'ri-medal-fill text-orange-400 text-lg'];
              return (
                <div key={entry.learnerId} className={`rounded-xl border p-5 text-center ${podiumStyles[i]}`}>
                  <AppIcon className={rankIcons[i]}></AppIcon>
                  <div className="w-14 h-14 rounded-full bg-white border-2 border-white shadow-sm flex items-center justify-center mx-auto mt-3 text-sm font-bold text-foreground-800">
                    {initials(entry.learner)}
                  </div>
                  <p className="text-sm font-semibold text-foreground-900 mt-3">{entry.learner}</p>
                  <p className="text-xs text-foreground-400 mt-0.5">{entry.cohort || '—'}</p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="text-lg font-bold text-foreground-900">{entry.points.toLocaleString()}</span>
                    <span className="text-[9px] text-foreground-400">pts</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Full Leaderboard */}
          <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden mb-6">
            <div className="divide-y divide-background-200/30">
              {entries.map((entry) => {
                const highlight = entry.learnerId === myLearner.id;
                return (
                  <div
                    key={entry.learnerId}
                    className={`p-4 flex items-center gap-4 ${highlight ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : ''}`}
                  >
                    <div className="w-8 text-center shrink-0">
                      {entry.rank <= 3 ? (
                        <span className="text-lg">{entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}</span>
                      ) : (
                        <span className="text-sm font-bold text-foreground-400">#{entry.rank}</span>
                      )}
                    </div>
                    <div className="w-9 h-9 rounded-full bg-background-100 flex items-center justify-center shrink-0 text-xs font-bold text-foreground-600">
                      {initials(entry.learner)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground-900">{entry.learner}</span>
                        {highlight && (
                          <span className="text-[9px] font-semibold text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded-full">You</span>
                        )}
                      </div>
                      <span className="text-xs text-foreground-400">{entry.cohort || '—'}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-foreground-900">{entry.points.toLocaleString()}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Points System + History + Impact (3-col layout) — still illustrative
          content, not per-learner data; unaffected by the ranking fix above. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Points System */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
          <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-3 flex items-center gap-2">
            <AppIcon className="ri-coins-line text-accent-500"></AppIcon> How Points Are Earned
          </h4>
          <div className="space-y-2.5">
            {POINT_RULES.map((rule) => {
              const colorMap = {
                primary: { bg: 'bg-primary-100', text: 'text-primary-600' },
                accent: { bg: 'bg-accent-100', text: 'text-accent-600' },
                secondary: { bg: 'bg-secondary-100', text: 'text-secondary-600' },
              };
              const c = colorMap[rule.color];
              return (
                <div key={rule.id} className="flex items-center gap-2.5">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${c.bg} ${c.text}`}>
                    <AppIcon className={`${rule.icon} text-xs`}></AppIcon>
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-foreground-800">{rule.action}</p>
                    <p className="text-[10px] text-foreground-400">{rule.description}</p>
                  </div>
                  <span className="ml-auto text-xs font-bold text-accent-600 shrink-0">+{rule.points}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Points History */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
          <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-3 flex items-center gap-2">
            <AppIcon className="ri-history-line text-primary-500"></AppIcon> Points History
          </h4>
          <div className="space-y-2">
            {POINTS_HISTORY.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-1.5 border-b border-background-200/30 last:border-0">
                <div className="min-w-0 flex-1 mr-2">
                  <p className="text-xs text-foreground-700 truncate">{entry.action}</p>
                  <p className="text-[10px] text-foreground-400">{entry.club} &middot; {entry.date}</p>
                </div>
                <span className="text-xs font-bold text-emerald-600 shrink-0">+{entry.points}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Community Impact */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
          <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-3 flex items-center gap-2">
            <AppIcon className="ri-heart-pulse-line text-secondary-500"></AppIcon> Your Community Impact
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <ImpactStat icon="ri-calendar-check-line" value={COMMUNITY_IMPACT.eventsAttended} label="Events Attended" color="primary" />
            <ImpactStat icon="ri-task-line" value={COMMUNITY_IMPACT.activitiesCompleted} label="Activities Done" color="accent" />
            <ImpactStat icon="ri-chat-1-line" value={COMMUNITY_IMPACT.discussionsJoined} label="Discussions Joined" color="secondary" />
            <ImpactStat icon="ri-folder-upload-line" value={COMMUNITY_IMPACT.resourcesShared} label="Resources Shared" color="primary" />
            <ImpactStat icon="ri-user-heart-line" value={COMMUNITY_IMPACT.learnersSupported} label="Learners Supported" color="accent" />
            <ImpactStat icon="ri-coins-line" value={COMMUNITY_IMPACT.totalPoints} label="Total Points" color="secondary" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ImpactStat({ icon, value, label, color }: { icon: string; value: number; label: string; color: 'primary' | 'accent' | 'secondary' }) {
  const colorMap = {
    primary: { bg: 'bg-primary-50', text: 'text-primary-600', val: 'text-primary-700' },
    accent: { bg: 'bg-accent-50', text: 'text-accent-600', val: 'text-accent-700' },
    secondary: { bg: 'bg-secondary-50', text: 'text-secondary-600', val: 'text-secondary-700' },
  };
  const c = colorMap[color];
  return (
    <div className={`rounded-lg p-3 text-center ${c.bg}`}>
      <AppIcon className={`${icon} text-sm ${c.text} mb-1 block`}></AppIcon>
      <p className={`text-lg font-bold ${c.val}`}>{value}</p>
      <p className="text-[10px] text-foreground-400">{label}</p>
    </div>
  );
}
