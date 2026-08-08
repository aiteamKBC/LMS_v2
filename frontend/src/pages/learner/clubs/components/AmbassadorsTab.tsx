import { useNavigate } from 'react-router-dom';
import { AMBASSADORS, AMBASSADOR_REQUIREMENTS, COMMUNITY_BADGES } from '../data';

export function AmbassadorsTab() {
  const navigate = useNavigate();
  const allRequirementsMet = AMBASSADOR_REQUIREMENTS.every(
    (req) => (req.isPercentage ? (req.current >= req.target) : (req.current >= req.target))
  );

  return (
    <section className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Ambassador Programme</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Develop leadership skills, represent your club, and earn exclusive recognition</p>
        </div>
      </div>

      {/* Ambassador Journey */}
      <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
        <div className="flex items-start gap-4 mb-5">
          <span className="w-12 h-12 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
            <AppIcon className="ri-shield-star-line text-xl"></AppIcon>
          </span>
          <div>
            <h4 className="text-sm font-heading font-semibold text-foreground-900">Become A Club Ambassador</h4>
            <p className="text-xs text-foreground-400 mt-0.5 leading-relaxed">
              Complete the requirements below to become eligible for the ambassador application. Ambassadors lead clubs, mentor peers, and shape the future of the KBC learner community.
            </p>
          </div>
        </div>

        {/* Progress Requirements */}
        <div className="space-y-3 mb-5">
          {AMBASSADOR_REQUIREMENTS.map((req) => {
            const pct = req.isPercentage ? req.current : Math.round((req.current / req.target) * 100);
            const done = req.isPercentage ? (req.current >= req.target) : (req.current >= req.target);
            const isPending = 'isPending' in req && req.isPending;

            const colorMap = {
              primary: { bar: 'bg-primary-400', bg: 'bg-primary-50', icon: 'text-primary-600' },
              accent: { bar: 'bg-accent-400', bg: 'bg-accent-50', icon: 'text-accent-600' },
              secondary: { bar: 'bg-secondary-400', bg: 'bg-secondary-50', icon: 'text-secondary-600' },
            };
            const c = colorMap[req.color];

            return (
              <div key={req.id} className={`flex items-center gap-4 p-3 rounded-xl transition-all ${done ? 'bg-emerald-50/60 ring-1 ring-emerald-200/40' : c.bg}`}>
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${done ? 'bg-emerald-100 text-emerald-600' : `bg-white/80 ${c.icon}`}`}>
                  <AppIcon className={`${done ? 'ri-check-double-line' : req.icon} text-lg`}></AppIcon>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-foreground-900">{req.label}</span>
                    <span className={`text-xs font-semibold ${done ? 'text-emerald-600' : 'text-foreground-500'}`}>
                      {isPending ? 'Pending' : `${req.current}/${req.target}${req.isPercentage ? '%' : ''}`}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-white/60 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${done ? 'bg-emerald-500' : c.bar}`}
                      style={{ width: `${isPending ? 0 : Math.min(pct, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Eligibility CTA */}
        <div className={`rounded-xl p-4 text-center ${allRequirementsMet ? 'bg-emerald-50 border border-emerald-200/60' : 'bg-background-100/70 border border-background-200/40'}`}>
          {allRequirementsMet ? (
            <>
              <p className="text-sm font-semibold text-emerald-700 mb-2">
                <AppIcon className="ri-check-double-line mr-1"></AppIcon> Eligible For Ambassador Application
              </p>
              <button className="px-6 py-2.5 bg-accent-500 text-foreground-950 rounded-lg text-sm font-semibold hover:bg-accent-400 transition-smooth cursor-pointer whitespace-nowrap shadow-sm shadow-accent-500/15">
                <AppIcon className="ri-shield-star-line mr-1.5"></AppIcon> Apply To Become Ambassador
              </button>
            </>
          ) : (
            <p className="text-sm text-foreground-500">
              Complete all requirements above to unlock the ambassador application. Keep engaging with your community!
            </p>
          )}
        </div>
      </div>

      {/* Ambassador Directory */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Ambassador Directory</h3>
            <p className="text-xs text-foreground-400 mt-0.5">Meet the learners who lead each club — they organise events, mentor peers, and shape the community</p>
          </div>
          <span className="text-xs font-semibold text-foreground-500 bg-background-100 px-2 py-0.5 rounded-full">{AMBASSADORS.length} Ambassadors</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {AMBASSADORS.map((amb) => (
            <div key={amb.name} className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium hover:border-primary-200/50 transition-smooth">
              {/* Header */}
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 text-base font-bold">
                  {amb.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-foreground-900">{amb.name}</h4>
                  <p className="text-xs text-primary-600 font-medium mt-0.5">{amb.role} — {amb.club}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-xs text-foreground-400"><AppIcon className="ri-calendar-line mr-0.5"></AppIcon>Since {amb.joined}</span>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span className="text-xs text-foreground-400"><AppIcon className="ri-presentation-line mr-0.5"></AppIcon>{amb.sessionsHosted} sessions</span>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span className="text-xs text-foreground-400"><AppIcon className="ri-star-line mr-0.5"></AppIcon>{amb.contributions} contributions</span>
                  </div>
                </div>
              </div>

              {/* Bio */}
              <p className="text-sm text-foreground-500 leading-relaxed mb-3">{amb.bio}</p>

              {/* Expertise */}
              <div className="mb-3">
                <p className="text-xs font-semibold text-foreground-400 mb-1.5">Specialisms</p>
                <div className="flex flex-wrap gap-1.5">
                  {amb.expertise.map((skill) => (
                    <span key={skill} className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{skill}</span>
                  ))}
                </div>
              </div>

              {/* Topics */}
              <div>
                <p className="text-xs font-semibold text-foreground-400 mb-1.5">Topics</p>
                <div className="flex flex-wrap gap-1">
                  {amb.topics.map((topic) => (
                    <span key={topic} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500 border border-background-200/40">{topic}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Community Badges */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Community Badges</h3>
            <p className="text-xs text-foreground-400 mt-0.5">Earn recognition badges as you contribute to the community</p>
          </div>
          <span className="text-xs font-semibold text-accent-600 bg-accent-100 px-2 py-0.5 rounded-full">
            {COMMUNITY_BADGES.filter((b) => b.earned).length}/{COMMUNITY_BADGES.length} Earned
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COMMUNITY_BADGES.map((badge) => {
            const badgeColorMap = {
              primary: { bg: 'bg-primary-100', text: 'text-primary-700' },
              accent: { bg: 'bg-accent-100', text: 'text-accent-700' },
              secondary: { bg: 'bg-secondary-100', text: 'text-secondary-700' },
            };
            const c = badgeColorMap[badge.color];
            return (
              <div
                key={badge.id}
                onClick={() => navigate(`/learner/clubs/badge/${badge.id}`)}
                className={`rounded-xl border p-4 text-center transition-all ${badge.earned ? 'bg-background-50 border-background-200/60 hover:border-primary-300/50 cursor-pointer' : 'bg-background-100/50 border-background-200/30 opacity-70 cursor-pointer hover:opacity-90'}`}
              >
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 ${c.bg} ${c.text} ${badge.earned ? '' : 'opacity-50'}`}>
                  <AppIcon className={`${badge.icon} text-lg`}></AppIcon>
                </span>
                <p className={`text-xs font-semibold leading-snug ${badge.earned ? 'text-foreground-900' : 'text-foreground-400'}`}>
                  {badge.title}
                </p>
                {badge.earned ? (
                  <p className="text-[10px] text-foreground-400 mt-0.5">Earned {badge.earnedDate}</p>
                ) : (
                  <div className="mt-2">
                    <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary-400"
                        style={{ width: `${badge.progress && badge.progressTarget ? Math.round((badge.progress / badge.progressTarget) * 100) : 0}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] text-foreground-400 mt-1">
                      {badge.progress}/{badge.progressTarget} {badge.progressLabel}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}