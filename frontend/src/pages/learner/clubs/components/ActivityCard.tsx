import { CommunityActivity } from '../data';

const difficultyConfig: Record<string, { bg: string; text: string; dot: string }> = {
  Easy: { bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-400' },
  Medium: { bg: 'bg-amber-50', text: 'text-amber-600', dot: 'bg-amber-400' },
  Hard: { bg: 'bg-rose-50', text: 'text-rose-600', dot: 'bg-rose-400' },
};

interface ActivityCardProps {
  activity: CommunityActivity;
}

export function ActivityCard({ activity }: ActivityCardProps) {
  const diff = difficultyConfig[activity.difficulty] || difficultyConfig.Easy;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium hover:border-primary-200/50 transition-smooth">
      <div className="flex items-start gap-4 mb-3">
        <span className="w-11 h-11 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
          <AppIcon className={`${activity.icon} text-lg`}></AppIcon>
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h4 className="text-sm font-semibold text-foreground-900">{activity.title}</h4>
            <span className="text-xs font-bold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">+{activity.points} pts</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-foreground-400 mb-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${diff.bg} ${diff.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${diff.dot}`}></span>
              {activity.difficulty}
            </span>
            <span><AppIcon className="ri-time-line mr-0.5"></AppIcon>{activity.estimatedTime}</span>
            {activity.evidenceRequired && (
              <span><AppIcon className="ri-camera-line mr-0.5"></AppIcon>Evidence Required</span>
            )}
            {activity.approvalRequired && (
              <span className="text-amber-500"><AppIcon className="ri-shield-check-line mr-0.5"></AppIcon>Approval Required</span>
            )}
          </div>
          <p className="text-sm text-foreground-500 leading-relaxed mb-3">{activity.description}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{activity.category}</span>
            {activity.club !== 'All Clubs' && (
              <span className="text-xs text-foreground-400"><AppIcon className="ri-community-line mr-0.5"></AppIcon>{activity.club}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-3 border-t border-background-200/30">
        {activity.joined ? (
          <>
            <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-upload-line mr-1"></AppIcon> Submit Evidence
            </button>
            <button className="px-4 py-2 bg-background-50 border border-background-200/40 rounded-lg text-xs font-medium text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-information-line mr-1"></AppIcon> View Requirements
            </button>
          </>
        ) : (
          <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap opacity-50 pointer-events-none">
            <AppIcon className="ri-lock-line mr-1"></AppIcon> Join Club First
          </button>
        )}
      </div>
    </div>
  );
}