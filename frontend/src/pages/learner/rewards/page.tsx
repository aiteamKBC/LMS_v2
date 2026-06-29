import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toPng } from 'html-to-image';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import BadgeShareCard from '@/components/feature/BadgeShareCard';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import {
  RECOGNITION_BADGES,
  ACHIEVEMENT_MILESTONES,
  NEXT_ACHIEVEMENT,
  COHORT_LEADERBOARD,
  REWARDS_SHOP_ITEMS,
  POINTS_ACTIVITY_LOG,
  EARNING_METHODS,
  POINTS_SUMMARY,
  REDEMPTION_HISTORY,
} from '@/mocks/rewards-data';

const learnerNav = roleNavMap.learner;

const badgeColorMap: Record<string, string> = {
  primary: 'bg-primary-100 text-primary-700',
  accent: 'bg-accent-100 text-accent-700',
  secondary: 'bg-secondary-100 text-secondary-700',
};

const badgeColorMapDark: Record<string, { bg: string; text: string; accent: string }> = {
  primary: { bg: 'bg-primary-500/20', text: 'text-primary-300', accent: 'bg-primary-400' },
  accent: { bg: 'bg-accent-500/20', text: 'text-accent-300', accent: 'bg-accent-400' },
  secondary: { bg: 'bg-secondary-500/20', text: 'text-secondary-300', accent: 'bg-secondary-400' },
};

const earnMethodColorMap: Record<string, string> = {
  primary: 'bg-primary-100 text-primary-700',
  accent: 'bg-accent-100 text-accent-700',
  secondary: 'bg-secondary-100 text-secondary-700',
};

const movementIcon = (m: string) => {
  if (m === 'up') return { icon: 'ri-arrow-up-s-line', cls: 'text-emerald-600 bg-emerald-100' };
  if (m === 'down') return { icon: 'ri-arrow-down-s-line', cls: 'text-red-500 bg-red-100' };
  return { icon: 'ri-subtract-line', cls: 'text-foreground-400 bg-foreground-100' };
};

const CONFETTI_COLORS = ['#fbbf24', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#a78bfa', '#f87171', '#2dd4bf'];

function MilestoneConfetti() {
  const particles = useRef(
    Array.from({ length: 48 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.6,
      rotation: Math.random() * 360,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.random() * 6,
      drift: (Math.random() - 0.5) * 60,
    }))
  );

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
      {particles.current.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-sm"
          style={{
            left: `${p.x}%`,
            top: '100%',
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animation: `confetti-burst 1.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${p.delay}s forwards`,
            '--drift': `${p.drift}px`,
            '--rotation': `${p.rotation}deg`,
          } as React.CSSProperties}
        />
      ))}
      <style>{`
        @keyframes confetti-burst {
          0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
          30% { transform: translateY(-140px) translateX(var(--drift)) rotate(calc(var(--rotation) * 0.6)); opacity: 1; }
          100% { transform: translateY(-280px) translateX(calc(var(--drift) * 2)) rotate(var(--rotation)); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function ClaimConfetti() {
  const particles = useRef(
    Array.from({ length: 80 }, (_, i) => ({
      id: i,
      angle: Math.random() * 360 * (Math.PI / 180),
      distance: 80 + Math.random() * 350,
      delay: Math.random() * 0.3,
      size: 4 + Math.random() * 10,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rotation: Math.random() * 720,
      duration: 0.8 + Math.random() * 1.2,
    }))
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-[60] overflow-hidden">
      {particles.current.map((p) => {
        const x = Math.cos(p.angle) * p.distance;
        const y = Math.sin(p.angle) * p.distance;
        return (
          <span
            key={p.id}
            className="absolute rounded-sm"
            style={{
              left: '50%',
              top: '50%',
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              animation: `claim-burst ${p.duration}s ease-out ${p.delay}s forwards`,
              '--x': `${x}px`,
              '--y': `${y}px`,
              '--rot': `${p.rotation}deg`,
            } as React.CSSProperties}
          />
        );
      })}
      <style>{`
        @keyframes claim-burst {
          0% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) scale(0.3) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function playCelebrationSound() {
  try {
    const AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const frequencies = [523.25, 659.25, 783.99, 1046.50];
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const startTime = now + i * 0.08;
      osc.start(startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);
      osc.stop(startTime + 0.6);
    });
  } catch {
    // Audio API not available
  }
}

const parseBadgeDate = (dateStr: string) => {
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const parts = dateStr.split(' ');
  const day = parseInt(parts[0], 10);
  const month = months[parts[1]] ?? 0;
  const year = parseInt(parts[2], 10);
  return new Date(year, month, day);
};

export default function RewardsPage() {
  const p = LEARNER_PROFILE;
  const s = POINTS_SUMMARY;
  const navigate = useNavigate();
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [claimingReward, setClaimingReward] = useState<typeof REWARDS_SHOP_ITEMS[0] | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [earnModalOpen, setEarnModalOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [shareBadge, setShareBadge] = useState<typeof RECOGNITION_BADGES[0] | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [showClaimConfetti, setShowClaimConfetti] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const cardRef = useRef<HTMLDivElement>(null);
  const visibleActivity = activityExpanded ? POINTS_ACTIVITY_LOG : POINTS_ACTIVITY_LOG.slice(0, 6);

  const maxWeeklyPoints = Math.max(...s.weeklyPoints.map(d => d.points), 25);

  const milestoneEntries = Object.entries(ACHIEVEMENT_MILESTONES).map(([key, m]) => {
    const pct = Math.min(Math.round((m.current / m.target) * 100), 100);
    return { key, ...m, pct, done: pct >= 100 };
  });
  const hasCompletedMilestones = milestoneEntries.some(m => m.done);

  const filteredRewards = REWARDS_SHOP_ITEMS.filter((rw) => {
    const matchesSearch = rw.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rw.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeFilter === 'All' || rw.category === activeFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = ['All', ...Array.from(new Set(REWARDS_SHOP_ITEMS.map((rw) => rw.category)))];

  const recentlyUnlocked = [...RECOGNITION_BADGES]
    .sort((a, b) => parseBadgeDate(b.earnedDate).getTime() - parseBadgeDate(a.earnedDate).getTime())
    .slice(0, 3);

  useEffect(() => {
    if (hasCompletedMilestones) {
      const timer = setTimeout(() => setShowConfetti(true), 600);
      const cleanup = setTimeout(() => setShowConfetti(false), 2800);
      return () => { clearTimeout(timer); clearTimeout(cleanup); };
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleClaim = () => {
    if (!claimingReward) return;
    playCelebrationSound();
    setShowClaimConfetti(true);
    setClaimSuccess(true);
    const cleanupTimer = setTimeout(() => setShowClaimConfetti(false), 2200);
    const closeTimer = setTimeout(() => {
      setClaimSuccess(false);
      setClaimingReward(null);
    }, 2800);
    return () => {
      clearTimeout(cleanupTimer);
      clearTimeout(closeTimer);
    };
  };

  const closeModal = () => {
    if (!claimSuccess) {
      setClaimingReward(null);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDownloadCard = async () => {
    if (!cardRef.current || !shareBadge) return;
    setDownloadLoading(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#0a0a0f',
      });
      const link = document.createElement('a');
      link.download = `${shareBadge.title.replace(/\s+/g, '-').toLowerCase()}-kbc-badge.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!shareBadge) return;
    const url = `${window.location.origin}/learner/rewards/badge/${shareBadge.id}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Rewards &amp; Recognition" pageSubtitle="Your achievement hub — track progress, earn recognition, and unlock rewards"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-6 space-y-6">

        {/* ═══════════ 1. REWARDS HERO — clean grid layout ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden animate-in fade-in duration-500" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative p-6 sm:p-8">
            {/* Top row — 3 columns on desktop */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              {/* Left: Title + subtitle */}
              <div className="lg:col-span-2 flex items-center gap-4">
                <span className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                  <i className="ri-trophy-line text-white text-2xl"></i>
                </span>
                <div>
                  <h2 className="text-xl font-heading font-bold text-white">Rewards &amp; Recognition</h2>
                  <p className="text-sm text-white/70 mt-0.5">Track your achievements, climb the leaderboard, and unlock exclusive rewards</p>
                </div>
              </div>

              {/* Right: Points + Club + Earn Button */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-white/12 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-white">{s.currentPoints}</p>
                    <p className="text-xs text-white/60 font-medium uppercase tracking-wider mt-0.5">Points</p>
                  </div>
                  <div className="flex-1 bg-white/12 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1 mb-0.5">
                      <i className="ri-vip-crown-line text-accent-300 text-sm"></i>
                      <p className="text-lg font-bold text-accent-300">{s.clubLevel}</p>
                    </div>
                    <p className="text-xs text-white/60 font-medium uppercase tracking-wider mt-0.5">Club Level</p>
                  </div>
                </div>
                <button
                  onClick={() => setEarnModalOpen(true)}
                  className="w-full bg-white/12 backdrop-blur-sm rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 border border-white/10 hover:bg-white/20 hover:border-white/20 transition-all cursor-pointer group whitespace-nowrap"
                >
                  <i className="ri-coins-line text-accent-300 text-sm"></i>
                  <span className="text-sm font-semibold text-white">How to Earn Points</span>
                  <i className="ri-arrow-right-s-line text-white/40 group-hover:text-white/70 transition-all group-hover:translate-x-0.5 text-sm"></i>
                </button>
              </div>
            </div>

            {/* Bottom row — Stats + Weekly Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <HeroStat icon="ri-calendar-check-line" value={`${s.streakWeeks} wks`} label="Current Streak" color="accent" />
                <HeroStat icon="ri-medal-line" value={`#${s.cohortRank}`} label={`Cohort Rank (of ${s.cohortTotal})`} color="secondary" />
                <HeroStat icon="ri-arrow-up-circle-line" value={`+${s.pointsThisMonth}`} label="Points This Month" color="accent" />
                <HeroStat icon="ri-fire-line" value={s.nextRewardLabel} label={`Next: ${s.progressToNextReward}%`} color="secondary" />
              </div>
              <div className="bg-white/8 backdrop-blur-sm rounded-xl px-4 py-3">
                <p className="text-xs text-white/50 font-medium uppercase tracking-wider mb-2 text-center">This Week</p>
                <div className="flex items-end justify-center gap-1.5 h-12">
                  {s.weeklyPoints.map((d, i) => {
                    const barH = d.points > 0 ? Math.max((d.points / maxWeeklyPoints) * 100, 12) : 4;
                    return (
                      <div key={d.day} className="flex flex-col items-center gap-1">
                        <div
                          className="w-5 rounded-sm animate-bar-grow"
                          style={{
                            '--bar-height': `${barH}%`,
                            animationDelay: `${i * 0.1}s`,
                            backgroundColor: d.points > 0 ? 'oklch(var(--accent-400) / 0.85)' : 'oklch(255 255 255 / 0.15)',
                          } as React.CSSProperties}
                        ></div>
                        <span className="text-xs text-white/40">{d.label}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs font-bold text-accent-300 text-center mt-1.5">+{s.pointsThisWeek} pts</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ═══════════ LEFT COLUMN (2/3) ═══════════ */}
          <div className="lg:col-span-2 space-y-6">

            {/* 2. RECOGNITION BADGES */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-in slide-in-from-bottom-4 duration-400" style={{ animationDelay: '100ms' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Recognition Badges</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Your earned achievements displayed as a professional gallery</p>
                </div>
                <span className="text-xs font-semibold text-accent-600 bg-accent-100 px-2.5 py-1 rounded-full">{RECOGNITION_BADGES.length} Earned</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {RECOGNITION_BADGES.map((badge) => (
                  <div
                    key={badge.id}
                    onClick={() => navigate(`/learner/rewards/badge/${badge.id}`)}
                    className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 cursor-pointer hover:border-primary-300/60 hover:ring-1 hover:ring-primary-300/20 transition-all group relative"
                  >
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 ${badgeColorMap[badge.color]} group-hover:scale-110 transition-transform duration-300`}>
                      <i className={`${badge.icon} text-lg`}></i>
                    </span>
                    <p className="text-xs font-semibold text-foreground-900 text-center leading-snug">{badge.title}</p>
                    <p className="text-xs text-foreground-400 text-center mt-0.5">{badge.earnedDate}</p>
                    <span className={`text-xs inline-block mt-1.5 mx-auto w-full text-center font-medium ${badge.color === 'primary' ? 'text-primary-600' : badge.color === 'accent' ? 'text-accent-600' : 'text-secondary-600'}`}>
                      {badge.category}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShareBadge(badge); }}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-background-100 hover:bg-primary-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      title="Share badge"
                    >
                      <i className="ri-share-forward-line text-foreground-400 text-xs"></i>
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* 2b. RECENTLY UNLOCKED */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-in slide-in-from-bottom-4 duration-400" style={{ animationDelay: '120ms' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Recently Unlocked</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Your newest achievements — earned in the last few days</p>
                </div>
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <i className="ri-fire-line text-emerald-500"></i> {recentlyUnlocked.length} New
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {recentlyUnlocked.map((badge, idx) => (
                  <div
                    key={badge.id}
                    onClick={() => navigate(`/learner/rewards/badge/${badge.id}`)}
                    className="bg-background-100 rounded-xl border border-foreground-200/60 p-3.5 cursor-pointer hover:border-primary-300/50 hover:ring-1 hover:ring-primary-300/15 transition-all group relative"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${badgeColorMap[badge.color]} group-hover:scale-110 transition-transform duration-300`}>
                        <i className={`${badge.icon} text-lg`}></i>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground-900 leading-snug">{badge.title}</p>
                        <p className="text-xs text-foreground-400 mt-0.5">{badge.earnedDate}</p>
                        <span className={`text-xs font-medium mt-1.5 inline-block ${badge.color === 'primary' ? 'text-primary-600' : badge.color === 'accent' ? 'text-accent-600' : 'text-secondary-600'}`}>
                          {badge.category}
                        </span>
                      </div>
                    </div>
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center" title="Newly unlocked">
                        <i className="ri-sparkling-2-line text-emerald-500 text-[10px]"></i>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. ACHIEVEMENT MILESTONES */}
            <section className="relative bg-background-50 rounded-xl border border-foreground-200/60 p-5 overflow-hidden animate-in slide-in-from-bottom-4 duration-400" style={{ animationDelay: '200ms' }}>
              {showConfetti && <MilestoneConfetti />}
              <div className="flex items-center justify-between mb-4 relative" style={{ zIndex: 2 }}>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Achievement Milestones</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Track your progress across all achievement categories</p>
                </div>
              </div>
              <div className="space-y-4 relative" style={{ zIndex: 2 }}>
                {milestoneEntries.map((m) => (
                  <div
                    key={m.key}
                    className={`flex items-center gap-4 p-2 -mx-2 rounded-xl transition-all duration-700 ${
                      m.done
                        ? 'bg-emerald-50/60 ring-1 ring-emerald-200/60 animate-celebrate-glow'
                        : ''
                    }`}
                  >
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-700 ${m.done ? 'bg-emerald-100 text-emerald-600 scale-110' : badgeColorMap[m.color]}`}>
                      <i className={`${m.done ? 'ri-check-double-line' : m.icon} text-lg`}></i>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-semibold ${m.done ? 'text-emerald-700' : 'text-foreground-900'}`}>{m.label}</span>
                        <span className={`text-xs font-semibold ${m.done ? 'text-emerald-600' : 'text-foreground-500'}`}>{m.current}/{m.target}</span>
                      </div>
                      <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${m.done ? 'bg-emerald-500' : m.color === 'primary' ? 'bg-primary-400' : m.color === 'accent' ? 'bg-accent-400' : 'bg-secondary-400'}`}
                          style={{ width: `${m.pct}%` }}
                        ></div>
                      </div>
                    </div>
                    <span className={`text-xs font-semibold shrink-0 w-12 text-right ${m.done ? 'text-emerald-600' : 'text-foreground-400'}`}>
                      {m.done ? (
                        <span className="inline-flex items-center gap-0.5">
                          100% <i className="ri-check-line text-emerald-500"></i>
                        </span>
                      ) : `${m.pct}%`}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* 5. COHORT LEADERBOARD */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-in slide-in-from-bottom-4 duration-400" style={{ animationDelay: '300ms' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Cohort Leaderboard</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">ME-L4 June 2026 &middot; {s.cohortTotal} Apprentices</p>
                </div>
              </div>
              <div className="space-y-1">
                {COHORT_LEADERBOARD.map((entry) => {
                  const mv = movementIcon(entry.movement);
                  return (
                    <div
                      key={entry.position}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${entry.isCurrentUser ? 'bg-primary-50 border border-primary-200/50' : 'hover:bg-background-100'}`}
                    >
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        entry.position === 1 ? 'bg-accent-500 text-white' :
                        entry.position === 2 ? 'bg-foreground-300 text-white' :
                        entry.position === 3 ? 'bg-amber-600 text-white' :
                        'bg-background-200 text-foreground-500'
                      }`}>{entry.position}</span>
                      <span className="w-8 h-8 rounded-full bg-background-200 flex items-center justify-center text-xs font-bold text-foreground-600 shrink-0">{entry.avatar}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground-900 truncate">
                          {entry.name}
                          {entry.isCurrentUser && <span className="text-xs text-primary-600 font-medium ml-1.5">(You)</span>}
                        </p>
                      </div>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${mv.cls}`}>
                        <i className={`${mv.icon} text-xs`}></i>
                      </span>
                      <span className="text-sm font-bold text-foreground-900 w-14 text-right shrink-0">{entry.points}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* ═══════════ RIGHT COLUMN (1/3) ═══════════ */}
          <div className="space-y-6">

            {/* 4. NEXT ACHIEVEMENT */}
            <Link to="/learner/attendance" className="block group">
              <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium transition-all animate-in slide-in-from-right-4 duration-400 cursor-pointer" style={{ animationDelay: '150ms' }}>
                <div className="flex items-start justify-between mb-3">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${badgeColorMap[NEXT_ACHIEVEMENT.color]}`}>
                    <i className={`${NEXT_ACHIEVEMENT.icon} text-lg`}></i>
                  </span>
                  <span className="text-xs text-foreground-300 group-hover:text-primary-500 transition-colors flex items-center gap-1 whitespace-nowrap">
                    View Attendance <i className="ri-arrow-right-line"></i>
                  </span>
                </div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900 group-hover:text-primary-700 transition-colors">Next Achievement</h3>
                <p className="text-xs text-foreground-500 mt-1 leading-relaxed">{NEXT_ACHIEVEMENT.description}</p>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-400">Progress</span>
                    <span className="text-xs font-semibold text-foreground-700">{NEXT_ACHIEVEMENT.progressCurrent}/{NEXT_ACHIEVEMENT.progressTarget} {NEXT_ACHIEVEMENT.progressLabel}</span>
                  </div>
                  <div className="w-full h-2.5 bg-background-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-accent-400 group-hover:bg-accent-500 transition-all duration-700" style={{ width: `${Math.round((NEXT_ACHIEVEMENT.progressCurrent / NEXT_ACHIEVEMENT.progressTarget) * 100)}%` }}></div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-foreground-400">
                    <i className="ri-time-line"></i>
                    <span>{NEXT_ACHIEVEMENT.remaining} &middot; Est. {NEXT_ACHIEVEMENT.estimatedCompletion}</span>
                  </div>
                  <div className="pt-3 border-t border-foreground-200/60">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-foreground-400">Reward</span>
                      <span className="text-xs font-semibold text-accent-600">+{NEXT_ACHIEVEMENT.rewardPoints} pts + Badge</span>
                    </div>
                  </div>
                </div>
              </section>
            </Link>

            {/* 6. REWARDS SHOP */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-in slide-in-from-right-4 duration-400" style={{ animationDelay: '250ms' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Rewards Shop</h3>
                <span className="text-xs font-semibold text-accent-600 bg-accent-100 px-2 py-0.5 rounded-full">{s.currentPoints} pts available</span>
              </div>

              {/* Search + Filter */}
              <div className="mb-3 space-y-2">
                <div className="relative">
                  <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search rewards..."
                    className="w-full bg-background-100 border border-foreground-200/60 rounded-lg pl-9 pr-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-primary-400/40 focus:border-primary-300/50 transition-all"
                  />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveFilter(cat)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        activeFilter === cat
                          ? 'bg-primary-500 text-white'
                          : 'bg-background-100 text-foreground-500 hover:bg-background-200/60 border border-foreground-200/60'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {filteredRewards.length === 0 ? (
                  <div className="text-center py-6">
                    <i className="ri-search-2-line text-foreground-300 text-2xl mb-2"></i>
                    <p className="text-xs text-foreground-400">No rewards match your search</p>
                  </div>
                ) : (
                  filteredRewards.map((rw) => {
                    const canClaim = s.currentPoints >= rw.points;
                    return (
                      <div
                        key={rw.id}
                        className={`rounded-xl border transition-all group p-4 ${
                          canClaim
                            ? 'bg-background-100 border-foreground-200/60 hover:bg-background-100 hover:border-background-300/60 hover:shadow-sm'
                            : 'bg-background-100/60 border-background-200/30 opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${canClaim ? 'bg-background-200' : 'bg-background-200'}`}>
                            <i className={`${rw.icon} text-lg ${canClaim ? 'text-foreground-500' : 'text-foreground-300'}`}></i>
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold leading-tight ${canClaim ? 'text-foreground-900' : 'text-foreground-400'}`}>{rw.title}</p>
                            <p className="text-xs text-foreground-400 mt-0.5 leading-relaxed">{rw.description}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${canClaim ? 'bg-accent-100 text-accent-600' : 'bg-background-200 text-foreground-300'}`}>
                                {rw.category}
                              </span>
                              <span className={`text-xs font-bold ${canClaim ? 'text-foreground-600' : 'text-foreground-300'}`}>{rw.points} pts</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {canClaim ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setClaimingReward(rw); }}
                                className="text-xs font-semibold bg-primary-500 text-white px-4 py-1.5 rounded-lg hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap"
                              >
                                Claim
                              </button>
                            ) : (
                              <div className="text-right">
                                <span className="text-xs text-foreground-300 block whitespace-nowrap">{rw.points} pts</span>
                                <span className="text-xs text-foreground-300 mt-0.5 block whitespace-nowrap">Need {rw.points - s.currentPoints} more</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {filteredRewards.length > 0 && (
                <div className="mt-3 pt-3 border-t border-foreground-200/60 flex items-center justify-between text-xs">
                  <span className="text-foreground-400">
                    {filteredRewards.length} of {REWARDS_SHOP_ITEMS.length} rewards
                  </span>
                  <span className="font-medium text-foreground-500">
                    {filteredRewards.filter(rw => s.currentPoints >= rw.points).length} available to claim
                  </span>
                </div>
              )}
            </section>

            {/* 6b. REDEMPTION HISTORY */}
            <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-in slide-in-from-right-4 duration-400" style={{ animationDelay: '300ms' }}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Redemption History</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Your claimed rewards and their status</p>
                </div>
                <span className="text-xs font-semibold text-foreground-500 bg-background-100 px-2 py-0.5 rounded-full">{REDEMPTION_HISTORY.length} claimed</span>
              </div>
              <div className="space-y-1.5">
                {REDEMPTION_HISTORY.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-background-100 transition-all bg-background-100 border border-background-200/30">
                    <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-background-200`}>
                      <i className={`${entry.icon} text-lg text-foreground-500`}></i>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground-900 truncate">{entry.rewardTitle}</p>
                      <p className="text-xs text-foreground-400 truncate">{entry.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-foreground-500">-{entry.pointsSpent} pts</p>
                      <span className={`text-xs font-medium ${
                        entry.status === 'Fulfilled' ? 'text-emerald-600' : 'text-amber-600'
                      }`}>{entry.status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-foreground-200/60 flex items-center justify-between text-xs">
                <span className="text-foreground-400">Total spent</span>
                <span className="font-bold text-foreground-700">{REDEMPTION_HISTORY.reduce((sum, e) => sum + e.pointsSpent, 0)} pts</span>
              </div>
            </section>
          </div>
        </div>

        {/* Bottom row — full width Recent Points Activity */}
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 animate-in slide-in-from-bottom-4 duration-400" style={{ animationDelay: '350ms' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Recent Points Activity</h3>
              <p className="text-xs text-foreground-400 mt-0.5">Every point earned contributes to your recognition</p>
            </div>
            <button
              onClick={() => setEarnModalOpen(true)}
              className="text-xs font-semibold text-accent-600 hover:text-accent-700 bg-accent-50 hover:bg-accent-100 px-3 py-1.5 rounded-full transition-all cursor-pointer whitespace-nowrap flex items-center gap-1"
            >
              <i className="ri-coins-line"></i> How to Earn Points
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-0">
            {visibleActivity.map((entry, i) => (
              <div key={entry.id} className={`flex items-center gap-3 py-2.5 ${i < visibleActivity.length - 1 ? 'border-b border-foreground-200/60' : ''}`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  entry.type === 'Evidence' ? 'bg-primary-100 text-primary-600' :
                  entry.type === 'Quiz' ? 'bg-accent-100 text-accent-600' :
                  entry.type === 'Bonus' ? 'bg-emerald-100 text-emerald-600' :
                  entry.type === 'Coaching' ? 'bg-secondary-100 text-secondary-600' :
                  entry.type === 'Review' ? 'bg-amber-100 text-amber-600' :
                  entry.type === 'Onboarding' ? 'bg-primary-100 text-primary-600' :
                  'bg-background-200 text-foreground-500'
                }`}>
                  <i className={`${
                    entry.type === 'Evidence' ? 'ri-folder-upload-line' :
                    entry.type === 'Quiz' ? 'ri-questionnaire-line' :
                    entry.type === 'Bonus' ? 'ri-gift-line' :
                    entry.type === 'Coaching' ? 'ri-user-star-line' :
                    entry.type === 'Review' ? 'ri-task-line' :
                    entry.type === 'Onboarding' ? 'ri-flag-line' :
                    'ri-calendar-check-line'
                  } text-sm`}></i>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground-800 truncate">{entry.action}</p>
                  <p className="text-xs text-foreground-400">{entry.date}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-emerald-600">+{entry.points}</p>
                  <p className="text-xs text-foreground-400">{entry.runningTotal} total</p>
                </div>
              </div>
            ))}
          </div>
          {POINTS_ACTIVITY_LOG.length > 6 && (
            <button
              onClick={() => setActivityExpanded(!activityExpanded)}
              className="mt-3 w-full text-xs font-semibold text-primary-600 hover:text-primary-700 py-2 rounded-lg hover:bg-primary-50 transition-all cursor-pointer whitespace-nowrap"
            >
              {activityExpanded ? 'Show Less' : `View All ${POINTS_ACTIVITY_LOG.length} Activities`}
            </button>
          )}
        </section>

      </div>

      {/* Back to Top Button */}
      <button
        onClick={scrollToTop}
        className={`fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full bg-primary-500 text-white shadow-lg flex items-center justify-center transition-all duration-300 hover:bg-primary-600 hover:scale-110 cursor-pointer ${
          showBackToTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label="Back to top"
      >
        <i className="ri-arrow-up-line text-lg"></i>
      </button>

      {/* Claim Celebration Confetti Overlay */}
      {showClaimConfetti && <ClaimConfetti />}

      {/* ═══════════ CLAIM REWARD MODAL ═══════════ */}
      {claimingReward && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200"></div>
          <div
            className="relative bg-background-50 rounded-2xl border border-foreground-200/60 w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {claimSuccess ? (
              <div className="p-8 text-center">
                <div className="relative w-full h-32 mb-4 rounded-xl overflow-hidden">
                  <img
                    src={claimingReward.image}
                    alt={claimingReward.title}
                    className="w-full h-full object-cover object-top"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                  <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <i className={`${claimingReward.icon} text-white text-sm`}></i>
                    </span>
                    <span className="text-sm font-semibold text-white">{claimingReward.title}</span>
                  </div>
                </div>
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4 animate-in slide-in-from-bottom-2 duration-200">
                  <i className="ri-check-line text-emerald-600 text-3xl"></i>
                </div>
                <h3 className="text-lg font-heading font-bold text-foreground-900 mb-1">Reward Claimed!</h3>
                <p className="text-sm text-foreground-500 mb-1">{claimingReward.title}</p>
                <p className="text-xs text-foreground-400">Your coach will be notified. Enjoy your reward!</p>
                <div className="mt-4 flex items-center justify-center gap-2 text-sm">
                  <span className="text-foreground-400 line-through">{s.currentPoints} pts</span>
                  <i className="ri-arrow-right-line text-foreground-300"></i>
                  <span className="font-bold text-primary-700">{s.currentPoints - claimingReward.points} pts</span>
                </div>
              </div>
            ) : (
              <>
                <div className="relative w-full h-40 overflow-hidden">
                  <img
                    src={claimingReward.image}
                    alt={claimingReward.title}
                    className="w-full h-full object-cover object-top"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent"></div>
                  <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                    <div>
                      <span className="px-2 py-0.5 rounded-md bg-white/20 backdrop-blur-sm text-xs font-semibold text-white mb-1.5 inline-block">
                        {claimingReward.category}
                      </span>
                      <h3 className="text-lg font-heading font-bold text-white">{claimingReward.title}</h3>
                    </div>
                    <span className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                      <i className={`${claimingReward.icon} text-white text-xl`}></i>
                    </span>
                  </div>
                </div>
                <div className="p-6">
                  <div className="space-y-3 bg-background-100 rounded-xl p-4 mb-5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground-500">Reward</span>
                      <span className="text-sm font-semibold text-foreground-900">{claimingReward.title}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground-500">Category</span>
                      <span className="text-sm text-foreground-700">{claimingReward.category}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground-500">Points Cost</span>
                      <span className="text-sm font-bold text-accent-600">{claimingReward.points} pts</span>
                    </div>
                    <div className="border-t border-foreground-200/60 pt-3 flex items-center justify-between">
                      <span className="text-sm text-foreground-500">Balance After Claim</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground-400 line-through">{s.currentPoints}</span>
                        <i className="ri-arrow-right-line text-foreground-300 text-xs"></i>
                        <span className="text-sm font-bold text-primary-700">{s.currentPoints - claimingReward.points}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={closeModal}
                      className="flex-1 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-all cursor-pointer whitespace-nowrap"
                    >Cancel</button>
                    <button
                      onClick={handleClaim}
                      className="flex-1 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap"
                    >Confirm Claim</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ EARN POINTS MODAL ═══════════ */}
      {earnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEarnModalOpen(false)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200"></div>
          <div
            className="relative bg-background-50 rounded-2xl border border-foreground-200/60 w-full max-w-lg max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom-4 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-foreground-200/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center">
                  <i className="ri-coins-line text-accent-600 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">How to Earn Points</h3>
                  <p className="text-xs text-foreground-400">Every apprenticeship activity earns recognition</p>
                </div>
              </div>
              <button
                onClick={() => setEarnModalOpen(false)}
                className="w-7 h-7 rounded-full bg-background-100 hover:bg-background-200 flex items-center justify-center cursor-pointer transition-all"
              >
                <i className="ri-close-line text-foreground-500 text-sm"></i>
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(85vh-70px)]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {EARNING_METHODS.map((method) => (
                  <div key={method.id} className="bg-background-50 rounded-lg border border-foreground-200/60 p-3 hover:border-background-300/60 transition-all">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${earnMethodColorMap[method.color]}`}>
                        <i className={`${method.icon} text-sm`}></i>
                      </span>
                      <span className="text-sm font-semibold text-foreground-900">{method.title}</span>
                    </div>
                    <p className="text-xs text-foreground-400 leading-relaxed">{method.description}</p>
                    <p className="text-xs font-bold text-accent-600 mt-2">+{method.points} points</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ BADGE SHARE CARD MODAL ═══════════ */}
      {shareBadge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShareBadge(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200"></div>
          <div
            className="relative bg-background-50 rounded-2xl border border-foreground-200/60 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-foreground-200/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                  <i className="ri-share-forward-line text-primary-600 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Share Badge</h3>
                  <p className="text-xs text-foreground-400">Download and share your achievement</p>
                </div>
              </div>
              <button
                onClick={() => setShareBadge(null)}
                className="w-7 h-7 rounded-full bg-background-100 hover:bg-background-200 flex items-center justify-center cursor-pointer transition-all"
              >
                <i className="ri-close-line text-foreground-500 text-sm"></i>
              </button>
            </div>
            <div className="p-5">
              {/* Hidden render target for html-to-image (off-screen) */}
              <div className="absolute left-[-9999px] top-0">
                <BadgeShareCard
                  ref={cardRef}
                  badge={shareBadge}
                  userName={p.fullName}
                  userRole={`${p.programme} Apprentice`}
                />
              </div>

              {/* Visible preview (scaled down to fit modal) */}
              <div className="rounded-xl overflow-hidden border border-foreground-200 mb-5 mx-auto" style={{ maxWidth: '360px' }}>
                <div style={{ transform: 'scale(0.45)', transformOrigin: 'top left', width: '800px', height: '800px' }}>
                  <BadgeShareCard
                    badge={shareBadge}
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
                  <i className="ri-linkedin-box-line text-sm"></i> LinkedIn
                </button>
                <button
                  onClick={handleDownloadCard}
                  disabled={downloadLoading}
                  className="py-2.5 rounded-xl bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {downloadLoading ? (
                    <i className="ri-loader-4-line text-sm animate-spin"></i>
                  ) : (
                    <i className="ri-download-line text-sm"></i>
                  )}
                  {downloadLoading ? 'Exporting...' : 'Download'}
                </button>
                <button
                  onClick={handleCopyLink}
                  className="py-2.5 rounded-xl bg-background-100 border border-foreground-200 text-xs font-semibold text-foreground-700 hover:bg-background-200/60 transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1"
                >
                  <i className="ri-link text-sm"></i> Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </WorkspaceShell>
  );
}

function HeroStat({ icon, value, label, color }: { icon: string; value: string; label: string; color: 'accent' | 'secondary' }) {
  const accentCls = color === 'accent'
    ? { bg: 'bg-accent-500/25', icon: 'text-accent-300', value: 'text-accent-300', label: 'text-white/50' }
    : { bg: 'bg-secondary-400/25', icon: 'text-secondary-300', value: 'text-secondary-200', label: 'text-white/50' };
  return (
    <div className="bg-white/8 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5 ${accentCls.bg}`}>
        <i className={`${icon} text-base ${accentCls.icon}`}></i>
      </span>
      <p className={`text-base font-bold ${accentCls.value}`}>{value}</p>
      <p className={`text-xs ${accentCls.label} mt-0.5`}>{label}</p>
    </div>
  );
}