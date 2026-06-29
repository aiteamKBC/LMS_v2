import { COMMUNITY_STATS } from '../data';

export function CommunityHero() {
  const stats = [
    { icon: 'ri-community-line', value: COMMUNITY_STATS.totalClubs, label: 'Total Clubs', color: 'accent' as const },
    { icon: 'ri-star-line', value: COMMUNITY_STATS.myClubs, label: 'My Clubs', color: 'accent' as const },
    { icon: 'ri-coins-line', value: COMMUNITY_STATS.communityPoints, label: 'Community Points', color: 'primary' as const },
    { icon: 'ri-calendar-event-line', value: COMMUNITY_STATS.eventsThisMonth, label: 'Events This Month', color: 'secondary' as const },
    { icon: 'ri-user-heart-line', value: COMMUNITY_STATS.activeLearners, label: 'Active Learners', color: 'primary' as const },
    { icon: 'ri-chat-1-line', value: COMMUNITY_STATS.communityDiscussions, label: 'Discussions', color: 'secondary' as const },
  ];

  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
      </div>
      <div className="relative p-6 sm:p-8">
        {/* Top row */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-5 mb-6">
          <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
            <i className="ri-community-line text-white text-2xl"></i>
          </span>
          <div className="flex-1">
            <h2 className="text-xl font-heading font-bold text-white mb-1">KBC Learner Community Hub</h2>
            <p className="text-sm text-white/80 leading-relaxed max-w-3xl">
              Connect with fellow apprentices, attend exclusive events, earn recognition points, develop leadership skills, and build your professional network throughout your apprenticeship journey.
            </p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {stats.map((stat) => {
            const colorMap = {
              accent: { bg: 'bg-accent-500/20', icon: 'text-accent-300', value: 'text-accent-300' },
              primary: { bg: 'bg-primary-400/20', icon: 'text-primary-300', value: 'text-primary-200' },
              secondary: { bg: 'bg-secondary-400/20', icon: 'text-secondary-300', value: 'text-secondary-200' },
            };
            const c = colorMap[stat.color];
            return (
              <div key={stat.label} className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 text-center hover:bg-white/15 transition-smooth">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5 ${c.bg}`}>
                  <i className={`${stat.icon} text-base ${c.icon}`}></i>
                </span>
                <p className={`text-xl font-bold ${c.value}`}>{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</p>
                <p className="text-xs text-white/50 font-medium mt-0.5">{stat.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}