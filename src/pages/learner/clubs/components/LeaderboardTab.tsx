import { useState } from 'react';
import {
  LeaderboardEntry,
  LEADERBOARD_ALL_TIME,
  LEADERBOARD_MONTHLY,
  LEADERBOARD_CLUB,
  POINTS_HISTORY,
  POINT_RULES,
  COMMUNITY_IMPACT,
} from '../data';

type RankingType = 'monthly' | 'all-time' | 'club';

const movementIcon = (m: string) => {
  if (m === 'up') return { icon: 'ri-arrow-up-s-line', cls: 'text-emerald-600 bg-emerald-100' };
  if (m === 'down') return { icon: 'ri-arrow-down-s-line', cls: 'text-red-500 bg-red-100' };
  if (m === 'new') return { icon: 'ri-sparkling-2-line', cls: 'text-primary-600 bg-primary-100' };
  return { icon: 'ri-subtract-line', cls: 'text-foreground-400 bg-foreground-100' };
};

const rankingTabs: { key: RankingType; label: string; icon: string }[] = [
  { key: 'monthly', label: 'Monthly Rankings', icon: 'ri-calendar-line' },
  { key: 'all-time', label: 'All-Time Rankings', icon: 'ri-trophy-line' },
  { key: 'club', label: 'Club Rankings', icon: 'ri-community-line' },
];

export function LeaderboardTab() {
  const [rankingType, setRankingType] = useState<RankingType>('monthly');

  const dataMap: Record<RankingType, LeaderboardEntry[]> = {
    monthly: LEADERBOARD_MONTHLY,
    'all-time': LEADERBOARD_ALL_TIME,
    club: LEADERBOARD_CLUB,
  };
  const leaderboardData = dataMap[rankingType];
  const userEntry = leaderboardData.find((e) => e.highlight);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Community Leaderboard</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Top contributors recognised for their impact across all clubs — updated weekly</p>
        </div>
        <span className="text-xs text-foreground-400 bg-background-100 px-2 py-1 rounded-full">Points reset monthly</span>
      </div>

      {/* User Rank Banner */}
      {userEntry && (
        <div className="bg-primary-50/40 rounded-xl border border-primary-200/50 p-4 mb-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-sm font-bold">SW</div>
            <div>
              <p className="text-sm font-semibold text-foreground-900">You are Rank #{userEntry.rank}</p>
              <p className="text-xs text-foreground-400 mt-0.5">
                {userEntry.rank > 1 ? (
                  <><strong className="text-accent-600">{leaderboardData[userEntry.rank - 2].points - userEntry.points}</strong> Points Needed To Reach Rank #{userEntry.rank - 1}</>
                ) : (
                  'You are at the top — keep it up!'
                )}
              </p>
            </div>
          </div>
          <div className="sm:ml-auto flex items-center gap-2 text-xs text-foreground-400 flex-wrap">
            <span className="bg-accent-50 text-accent-600 px-2 py-0.5 rounded-full font-medium">Top Club Contributor</span>
            <span className="bg-secondary-50 text-secondary-600 px-2 py-0.5 rounded-full font-medium">Most Improved</span>
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
            <i className={`${tab.icon} text-xs`}></i>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Top 3 Podium */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {leaderboardData.slice(0, 3).map((entry, i) => {
          const podiumStyles = [
            'bg-gradient-to-b from-amber-50 to-amber-100 border-amber-200/60',
            'bg-gradient-to-b from-slate-50 to-slate-100 border-slate-200/60',
            'bg-gradient-to-b from-orange-50 to-orange-100 border-orange-200/60',
          ];
          const rankIcons = ['ri-medal-fill text-amber-500 text-xl', 'ri-medal-fill text-slate-400 text-lg', 'ri-medal-fill text-orange-400 text-lg'];
          return (
            <div key={entry.rank} className={`rounded-xl border p-5 text-center ${podiumStyles[i]}`}>
              <i className={rankIcons[i]}></i>
              <div className="w-14 h-14 rounded-full bg-white border-2 border-white shadow-sm flex items-center justify-center mx-auto mt-3 text-sm font-bold text-foreground-800">
                {entry.avatar}
              </div>
              <p className="text-sm font-semibold text-foreground-900 mt-3">{entry.name}</p>
              <p className="text-xs text-foreground-400 mt-0.5">{entry.club}</p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="text-lg font-bold text-foreground-900">{entry.points.toLocaleString()}</span>
                <span className="text-[9px] text-foreground-400">pts</span>
              </div>
              <span className="inline-block mt-2 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/70 text-foreground-600 border border-foreground-100/30">
                {entry.badge}
              </span>
            </div>
          );
        })}
      </div>

      {/* Full Leaderboard */}
      <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden mb-6">
        <div className="divide-y divide-background-200/30">
          {leaderboardData.map((entry) => {
            const mv = movementIcon(entry.movement);
            return (
              <div
                key={`${entry.category}-${entry.rank}`}
                className={`p-4 flex items-center gap-4 ${entry.highlight ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : ''}`}
              >
                <div className="w-8 text-center shrink-0">
                  {entry.rank <= 3 ? (
                    <span className="text-lg">{entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}</span>
                  ) : (
                    <span className="text-sm font-bold text-foreground-400">#{entry.rank}</span>
                  )}
                </div>
                <div className="w-9 h-9 rounded-full bg-background-100 flex items-center justify-center shrink-0 text-xs font-bold text-foreground-600">
                  {entry.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground-900">{entry.name}</span>
                    {entry.highlight && (
                      <span className="text-[9px] font-semibold text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded-full">You</span>
                    )}
                  </div>
                  <span className="text-xs text-foreground-400">{entry.club}</span>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-foreground-900">{entry.points.toLocaleString()}</p>
                  <p className="text-[9px] text-foreground-400">{entry.contributions} contributions</p>
                </div>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${mv.cls}`}>
                  <i className={`${mv.icon} text-xs`}></i>
                </span>
                <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500 shrink-0 hidden sm:block">
                  {entry.badge}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Points System + History + Impact (3-col layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Points System */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
          <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-3 flex items-center gap-2">
            <i className="ri-coins-line text-accent-500"></i> How Points Are Earned
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
                    <i className={`${rule.icon} text-xs`}></i>
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
            <i className="ri-history-line text-primary-500"></i> Points History
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
            <i className="ri-heart-pulse-line text-secondary-500"></i> Your Community Impact
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
      <i className={`${icon} text-sm ${c.text} mb-1 block`}></i>
      <p className={`text-lg font-bold ${c.val}`}>{value}</p>
      <p className="text-[10px] text-foreground-400">{label}</p>
    </div>
  );
}