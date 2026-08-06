import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { ENHANCED_COMMUNITY_BADGES } from '@/pages/learner/clubs/data';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

const badgeColorMap: Record<string, { bg: string; text: string; border: string; glow: string; dot: string; bar: string; confetti: string }> = {
  primary: {
    bg: 'bg-primary-100', text: 'text-primary-700', border: 'border-primary-200/60',
    glow: 'from-primary-500/10 via-primary-400/5 to-transparent', dot: 'bg-primary-500', bar: 'bg-primary-400',
    confetti: 'text-primary-500',
  },
  accent: {
    bg: 'bg-accent-100', text: 'text-accent-700', border: 'border-accent-200/60',
    glow: 'from-accent-500/10 via-accent-400/5 to-transparent', dot: 'bg-accent-500', bar: 'bg-accent-400',
    confetti: 'text-accent-500',
  },
  secondary: {
    bg: 'bg-secondary-100', text: 'text-secondary-700', border: 'border-secondary-200/60',
    glow: 'from-secondary-500/10 via-secondary-400/5 to-transparent', dot: 'bg-secondary-500', bar: 'bg-secondary-400',
    confetti: 'text-secondary-500',
  },
};

export default function ClubBadgeDetailPage() {
  const { badgeId } = useParams<{ badgeId: string }>();
  const navigate = useNavigate();
  const [showConfetti, setShowConfetti] = useState(false);
  const badge = ENHANCED_COMMUNITY_BADGES.find((b) => b.id === badgeId);

  useEffect(() => {
    if (badge?.earned) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [badge?.earned, badge?.id]);

  if (!badge) {
    return (
      <WorkspaceShell
        role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Badge Not Found" pageSubtitle="The community badge you are looking for does not exist"
        userName={p.fullName} userRole={`${p.programme} Apprentice`}
      >
        <div className="p-6 flex flex-col items-center justify-center py-24">
          <span className="w-20 h-20 rounded-3xl bg-foreground-100 flex items-center justify-center mb-6">
            <AppIcon className="ri-emotion-sad-line text-foreground-300 text-3xl"></AppIcon>
          </span>
          <h2 className="text-xl font-heading font-bold text-foreground-900 mb-2">Badge Not Found</h2>
          <p className="text-sm text-foreground-500 mb-6">We couldn&apos;t find a community badge with that identifier.</p>
          <Link
            to="/learner/clubs"
            className="px-5 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all whitespace-nowrap"
          >
            <AppIcon className="ri-arrow-left-line mr-1.5"></AppIcon> Back to Clubs
          </Link>
        </div>
      </WorkspaceShell>
    );
  }

  const colors = badgeColorMap[badge.color];

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={badge.title} pageSubtitle={`Community Badge${badge.earned ? ` — Earned ${badge.earnedDate}` : ' — In Progress'}`}
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      {/* Confetti Celebration */}
      {showConfetti && badge.earned && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          {Array.from({ length: 180 }).map((_, i) => {
            const confettiColors = ['bg-accent-400', 'bg-primary-400', 'bg-secondary-400', 'bg-amber-300', 'bg-emerald-400', 'bg-rose-300'];
            const c = confettiColors[i % confettiColors.length];
            const left = Math.random() * 100;
            const delay = Math.random() * 3;
            const duration = 2.5 + Math.random() * 4;
            const size = 5 + Math.random() * 10;
            const shape = Math.random() > 0.5 ? 'rounded-sm' : 'rounded-full';
            return (
              <div
                key={i}
                className={`absolute ${c} ${shape} opacity-80`}
                style={{
                  left: `${left}%`,
                  top: '-5%',
                  width: `${size}px`,
                  height: `${size * (0.5 + Math.random() * 0.8)}px`,
                  animation: `confetti-fall ${duration}s ease-in ${delay}s forwards`,
                  transform: `rotate(${Math.random() * 360}deg)`,
                }}
              />
            );
          })}
          {/* Celebration badge toast */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            <div className="bg-background-50 rounded-2xl px-8 py-6 shadow-xl border border-accent-200/60 animate-in zoom-in-50 bounce-in duration-500">
              <div className="text-center">
                <span className={`w-16 h-16 rounded-2xl ${colors.bg} ${colors.text} flex items-center justify-center mx-auto mb-3 ring-4 ring-background-50`}>
                  <AppIcon className={`${badge.icon} text-2xl`}></AppIcon>
                </span>
                <h3 className="text-lg font-heading font-bold text-foreground-900">Badge Earned!</h3>
                <p className="text-sm text-foreground-500 mt-1">Congratulations! You earned the <strong>{badge.title}</strong> badge</p>
                <p className="text-xs text-foreground-400 mt-1">Earned {badge.earnedDate}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 max-w-4xl mx-auto space-y-6">

        {/* Back link */}
        <button
          onClick={() => navigate('/learner/clubs')}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-500 hover:text-foreground-700 transition-all cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-arrow-left-line"></AppIcon>
          Back to Community
        </button>

        {/* Badge Hero Card */}
        <section className="relative rounded-2xl overflow-hidden border border-background-200/60 animate-in fade-in duration-400">
          <div className={`absolute inset-0 bg-gradient-to-br ${colors.glow}`}></div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-background-100/60 to-transparent rounded-bl-full"></div>
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <span className={`w-20 h-20 rounded-2xl flex items-center justify-center shrink-0 ${colors.bg} ${colors.text} ring-4 ring-background-50`}>
                <AppIcon className={`${badge.icon} text-3xl`}></AppIcon>
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                    Community Badge
                  </span>
                  {badge.earned ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span className="text-xs text-emerald-600 font-medium">Earned</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      <span className="text-xs text-amber-600 font-medium">In Progress</span>
                    </>
                  )}
                </div>
                <h1 className="text-2xl font-heading font-bold text-foreground-900 mt-1">{badge.title}</h1>
                <p className="text-sm text-foreground-500 mt-2 leading-relaxed">{badge.description}</p>
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-background-200/60">
                  {badge.earned ? (
                    <div className="flex items-center gap-1.5">
                      <AppIcon className="ri-calendar-check-line text-foreground-400 text-sm"></AppIcon>
                      <span className="text-sm text-foreground-600">Earned on <strong>{badge.earnedDate}</strong></span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <AppIcon className="ri-timer-line text-foreground-400 text-sm"></AppIcon>
                      <span className="text-sm text-foreground-600">
                        Progress: <strong>{badge.progress}/{badge.progressTarget} {badge.progressLabel}</strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Left: Impact Story + How to Earn */}
          <div className="lg:col-span-3 space-y-6">

            {/* Impact Story */}
            <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-bottom-4 duration-400">
              <div className="flex items-center gap-2 mb-4">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.bg}`}>
                  <AppIcon className={`ri-book-open-line text-sm ${colors.text}`}></AppIcon>
                </span>
                <h2 className="text-sm font-heading font-semibold text-foreground-900">Why This Badge Matters</h2>
              </div>
              <p className="text-sm text-foreground-600 leading-relaxed">{badge.impact}</p>
            </section>

            {/* How to Earn */}
            <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-bottom-4 duration-400" style={{ animationDelay: '100ms' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-100">
                  <AppIcon className="ri-check-double-line text-emerald-600 text-sm"></AppIcon>
                </span>
                <h2 className="text-sm font-heading font-semibold text-foreground-900">How to Earn This Badge</h2>
              </div>
              <div className="space-y-0 relative">
                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-emerald-200/60"></div>
                {badge.unlockCriteria.map((criterion, i) => (
                  <div key={i} className="flex items-start gap-3 py-2.5 relative">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 relative z-10 bg-emerald-100 text-emerald-600 ring-2 ring-background-50">
                      <AppIcon className="ri-check-line text-xs"></AppIcon>
                    </span>
                    <span className="text-sm text-foreground-700 pt-0.5">{criterion}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right: Badge Details Sidebar */}
          <div className="lg:col-span-2 space-y-4">

            {/* Progress Card (if not earned) */}
            {!badge.earned && badge.progress !== undefined && badge.progressTarget !== undefined && (
              <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-right-4 duration-400">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Your Progress</h3>
                <div className="text-center mb-4">
                  <div className="relative w-24 h-24 mx-auto mb-3">
                    <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 96 96">
                      <circle cx="48" cy="48" r="40" fill="none" stroke="oklch(var(--background-200))" strokeWidth="8" />
                      <circle
                        cx="48" cy="48" r="40" fill="none"
                        stroke={`oklch(var(--${badge.color}-500))`}
                        strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={`${(badge.progress / badge.progressTarget) * 251.2} 251.2`}
                        className="transition-all duration-1000"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-xl font-heading font-bold text-foreground-900">
                      {Math.round((badge.progress / badge.progressTarget) * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-foreground-500">{badge.progress} of {badge.progressTarget} {badge.progressLabel} completed</p>
                </div>
              </section>
            )}

            {/* Badge Stats */}
            <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-right-4 duration-400">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Badge Details</h3>
              <div className="space-y-3">
                {badge.earned && badge.earnedDate && (
                  <div className="flex items-center justify-between py-2 border-b border-background-200/40">
                    <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                      <AppIcon className="ri-calendar-line"></AppIcon> Earned Date
                    </span>
                    <span className="text-xs font-semibold text-foreground-900">{badge.earnedDate}</span>
                  </div>
                )}
                <div className="flex items-center justify-between py-2 border-b border-background-200/40">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-price-tag-3-line"></AppIcon> Category
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>Community Badge</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-background-200/40">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-checkbox-circle-line"></AppIcon> Criteria
                  </span>
                  <span className="text-xs font-semibold text-foreground-600">{badge.unlockCriteria.length} requirements</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-shield-check-line"></AppIcon> Status
                  </span>
                  {badge.earned ? (
                    <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Earned
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-amber-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span> In Progress
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* View All Badges link */}
            <Link
              to="/learner/clubs"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-background-200/60 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-all cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-gallery-line"></AppIcon> View All Community Badges
            </Link>
          </div>
        </div>

      </div>
    </WorkspaceShell>
  );
}