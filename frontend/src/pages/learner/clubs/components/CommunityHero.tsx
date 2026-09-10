import { WorkspaceMetricContent } from '@/components/ui/WorkspaceMetricContent';
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
    <div className="learner-super-admin-hero relative rounded-2xl overflow-hidden workspace-page-hero" >
      <div className="absolute inset-0 pointer-events-none overflow-hidden hidden">
        <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
      </div>
      <div className="relative p-6 sm:p-6">
        {/* Top row */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-5 mb-6">
          <span className="w-14 h-14 rounded-2xl bg-primary-100/60 backdrop-blur-sm flex items-center justify-center shrink-0">
            <AppIcon className="ri-community-line text-primary-800 text-2xl"></AppIcon>
          </span>
          <div className="flex-1">
            <h2 className="text-xl font-heading font-bold text-primary-800 mb-1">KBC Learner Community Hub</h2>
            <p className="text-sm text-foreground-500 leading-relaxed max-w-3xl">
              Connect with fellow apprentices, attend exclusive events, earn recognition points, develop leadership skills, and build your professional network throughout your apprenticeship journey.
            </p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {stats.map((stat) => {
            return (
              <div key={stat.label} className="ui-metric-card coach-metric-card"><WorkspaceMetricContent label={stat.label} value={<>{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</>} icon={stat.icon} valuePosition="stacked" /></div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
