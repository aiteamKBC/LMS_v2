import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toPng } from 'html-to-image';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import BadgeShareCard from '@/components/feature/BadgeShareCard';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { RECOGNITION_BADGES } from '@/mocks/rewards-data';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

const badgeColorMap: Record<string, { bg: string; text: string; border: string; glow: string; dot: string; bar: string }> = {
  primary: {
    bg: 'bg-primary-100', text: 'text-primary-700', border: 'border-primary-200/60',
    glow: 'from-primary-500/10 via-primary-400/5 to-transparent', dot: 'bg-primary-500', bar: 'bg-primary-400',
  },
  accent: {
    bg: 'bg-accent-100', text: 'text-accent-700', border: 'border-accent-200/60',
    glow: 'from-accent-500/10 via-accent-400/5 to-transparent', dot: 'bg-accent-500', bar: 'bg-accent-400',
  },
  secondary: {
    bg: 'bg-secondary-100', text: 'text-secondary-700', border: 'border-secondary-200/60',
    glow: 'from-secondary-500/10 via-secondary-400/5 to-transparent', dot: 'bg-secondary-500', bar: 'bg-secondary-400',
  },
};

export default function BadgeDetailPage() {
  const { badgeId } = useParams<{ badgeId: string }>();
  const navigate = useNavigate();
  const [shareModal, setShareModal] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const badge = RECOGNITION_BADGES.find(b => b.id === badgeId);

  if (!badge) {
    return (
      <WorkspaceShell
        role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Badge Not Found" pageSubtitle="The badge you are looking for does not exist"
        userName={p.fullName} userRole={`${p.programme} Apprentice`}
      >
        <div className="p-6 flex flex-col items-center justify-center py-24">
          <span className="w-20 h-20 rounded-3xl bg-foreground-100 flex items-center justify-center mb-6">
            <AppIcon className="ri-emotion-sad-line text-foreground-300 text-3xl"></AppIcon>
          </span>
          <h2 className="text-xl font-heading font-bold text-foreground-900 mb-2">Badge Not Found</h2>
          <p className="text-sm text-foreground-500 mb-6">We couldn&apos;t find a badge with that identifier.</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-5 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all whitespace-nowrap"
          >
            <AppIcon className="ri-arrow-left-line mr-1.5"></AppIcon> Back to Rewards
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const colors = badgeColorMap[badge.color];

  const handleDownloadCard = async () => {
    if (!cardRef.current || !badge) return;
    setDownloadLoading(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#0a0a0f',
      });
      const link = document.createElement('a');
      link.download = `${badge.title.replace(/\s+/g, '-').toLowerCase()}-kbc-badge.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!badge) return;
    const url = `${window.location.origin}/learner/rewards/badge/${badge.id}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={badge.title} pageSubtitle={`${badge.category} Badge \u2014 Earned ${badge.earnedDate}`}
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-6 max-w-4xl mx-auto space-y-6">

        {/* Back link */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-500 hover:text-foreground-700 transition-all cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-arrow-left-line"></AppIcon>
          Back to Rewards
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
                    {badge.category}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span className="text-xs text-emerald-600 font-medium">Earned</span>
                </div>
                <h1 className="text-2xl font-heading font-bold text-foreground-900 mt-1">{badge.title}</h1>
                <p className="text-sm text-foreground-500 mt-2 leading-relaxed">{badge.description}</p>
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-background-200/60">
                  <div className="flex items-center gap-1.5">
                    <AppIcon className="ri-calendar-check-line text-foreground-400 text-sm"></AppIcon>
                    <span className="text-sm text-foreground-600">Earned on <strong>{badge.earnedDate}</strong></span>
                  </div>
                  <span className="text-foreground-200">|</span>
                  <div className="flex items-center gap-1.5">
                    <AppIcon className="ri-medal-line text-foreground-400 text-sm"></AppIcon>
                    <span className="text-sm text-foreground-600">Category: <strong>{badge.category}</strong></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Two-column detail section */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Left: Achievement Story + Impact */}
          <div className="lg:col-span-3 space-y-6">

            {/* Achievement Story */}
            <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-bottom-4 duration-400">
              <div className="flex items-center gap-2 mb-4">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.bg}`}>
                  <AppIcon className="ri-book-open-line text-sm ${colors.text}"></AppIcon>
                </span>
                <h2 className="text-sm font-heading font-semibold text-foreground-900">Achievement Story</h2>
              </div>
              <p className="text-sm text-foreground-600 leading-relaxed">{badge.impact}</p>
            </section>

            {/* How You Earned It (timeline-style) */}
            <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-bottom-4 duration-400" style={{ animationDelay: '100ms' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-100">
                  <AppIcon className="ri-check-double-line text-emerald-600"></AppIcon>
                </span>
                <h2 className="text-sm font-heading font-semibold text-foreground-900">How You Earned This Badge</h2>
              </div>
              <div className="space-y-0 relative">
                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-emerald-200/60"></div>
                {badge.unlockCriteria.map((criterion, i) => (
                  <div key={i} className="flex items-start gap-3 py-2.5 relative">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 relative z-10 ${
                      i < badge.unlockCriteria.length ? 'bg-emerald-100 text-emerald-600 ring-2 ring-background-50' : 'bg-background-200 text-foreground-400'
                    }`}>
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

            {/* Badge Stats */}
            <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-right-4 duration-400">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Badge Details</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-background-200/40">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-calendar-line"></AppIcon> Earned Date
                  </span>
                  <span className="text-xs font-semibold text-foreground-900">{badge.earnedDate}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-background-200/40">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-price-tag-3-line"></AppIcon> Category
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>{badge.category}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-background-200/40">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-checkbox-circle-line"></AppIcon> Criteria Met
                  </span>
                  <span className="text-xs font-semibold text-emerald-600">{badge.unlockCriteria.length}/{badge.unlockCriteria.length}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-background-200/40">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-shield-check-line"></AppIcon> Status
                  </span>
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Earned
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-xs text-foreground-500 flex items-center gap-1.5">
                    <AppIcon className="ri-medal-2-line"></AppIcon> Badge ID
                  </span>
                  <span className="text-xs font-mono text-foreground-400">#{badge.id}</span>
                </div>
              </div>
            </section>

            {/* Share / Actions */}
            <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 animate-in slide-in-from-right-4 duration-400" style={{ animationDelay: '100ms' }}>
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Share Your Achievement</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShareModal(true)}
                  className="flex-1 py-2 rounded-lg bg-primary-100 text-primary-700 text-xs font-semibold hover:bg-primary-200 transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1"
                >
                  <AppIcon className="ri-share-forward-line text-sm"></AppIcon> Share Card
                </button>
                <button
                  onClick={handleDownloadCard}
                  disabled={downloadLoading}
                  className="flex-1 py-2 rounded-lg bg-background-100 border border-background-200/60 text-xs font-semibold text-foreground-600 hover:bg-background-200/60 transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloadLoading ? (
                    <AppIcon className="ri-loader-4-line text-sm animate-spin"></AppIcon>
                  ) : (
                    <AppIcon className="ri-download-line text-sm"></AppIcon>
                  )}
                  {downloadLoading ? 'Exporting...' : 'Download'}
                </button>
              </div>
            </section>

            {/* View All Badges link */}
            <Link
              to="/learner/rewards"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-background-200/60 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-all cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-gallery-line"></AppIcon> View All Badges
            </Link>
          </div>
        </div>

      </div>

      {/* ═══════════ BADGE SHARE CARD MODAL ═══════════ */}
      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShareModal(false)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200"></div>
          <div
            className="relative bg-background-50 rounded-2xl border border-background-200/50 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-background-200/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                  <AppIcon className="ri-share-forward-line text-primary-600 text-sm"></AppIcon>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Share Badge</h3>
                  <p className="text-xs text-foreground-400">Download and share your achievement</p>
                </div>
              </div>
              <button
                onClick={() => setShareModal(false)}
                className="w-7 h-7 rounded-full bg-background-100 hover:bg-background-200 flex items-center justify-center cursor-pointer transition-all"
              >
                <AppIcon className="ri-close-line text-foreground-500 text-sm"></AppIcon>
              </button>
            </div>
            <div className="p-5">
              {/* Hidden render target for html-to-image (off-screen) */}
              <div className="absolute left-[-9999px] top-0">
                <BadgeShareCard
                  ref={cardRef}
                  badge={badge}
                  userName={p.fullName}
                  userRole={`${p.programme} Apprentice`}
                />
              </div>

              {/* Visible preview (scaled down to fit modal) */}
              <div className="rounded-xl overflow-hidden border border-background-200/60 mb-5 mx-auto" style={{ maxWidth: '360px' }}>
                <div style={{ transform: 'scale(0.45)', transformOrigin: 'top left', width: '800px', height: '800px' }}>
                  <BadgeShareCard
                    badge={badge}
                    userName={p.fullName}
                    userRole={`${p.programme} Apprentice`}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  className="py-2.5 rounded-xl bg-[#0077b5] text-white text-xs font-semibold hover:bg-[#006396] transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1"
                >
                  <AppIcon className="ri-linkedin-box-line text-sm"></AppIcon> LinkedIn
                </button>
                <button
                  onClick={handleDownloadCard}
                  disabled={downloadLoading}
                  className="py-2.5 rounded-xl bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloadLoading ? (
                    <AppIcon className="ri-loader-4-line text-sm animate-spin"></AppIcon>
                  ) : (
                    <AppIcon className="ri-download-line text-sm"></AppIcon>
                  )}
                  {downloadLoading ? 'Exporting...' : 'Download'}
                </button>
                <button
                  onClick={handleCopyLink}
                  className="py-2.5 rounded-xl bg-background-100 border border-background-200/60 text-xs font-semibold text-foreground-700 hover:bg-background-200/60 transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1"
                >
                  <AppIcon className="ri-link text-sm"></AppIcon> Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
