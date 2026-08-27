import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RealThisWeekView } from '@/components/feature/RealThisWeekView';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { VideoPlayerModal } from '@/pages/learner/this-week/components/VideoPlayerModal';
import { QuizModal } from '@/pages/learner/this-week/components/QuizModal';
import { ReadingModal } from '@/pages/learner/this-week/components/ReadingModal';
import { ReadingPodcastModal } from '@/pages/learner/this-week/components/ReadingPodcastModal';
import { EvidenceLoggingModal } from '@/pages/learner/this-week/components/EvidenceLoggingModal';
import { roleNavMap } from '@/mocks/navigation';
import {
  LEARNER_PROFILE,
  WEEKLY_LEARNING_COMPONENTS,
  WEEKLY_KSBS,
  WEEKLY_RESOURCES,
  WEEKLY_TUTOR_GUIDANCE,
  WEEKLY_COACH_GUIDANCE,
  QUIZ_1_DATA,
  QUIZ_2_DATA,
  READING_1_DATA,
  READING_2_DATA,
  PODCAST_1_DATA,
  PODCAST_2_DATA,
} from '@/mocks/learner-profile';

const learnerNav = roleNavMap.learner;

/* ─────────────────────────────────────────────
   Scroll-reveal wrapper
   ───────────────────────────────────────────── */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setVisible(true), delay);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-[500ms] ease-out ${className} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Small Donut Ring
   ───────────────────────────────────────────── */
function DonutRing({ progress, color, size = 44, stroke = 4.5 }: { progress: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(progress, 100) / 100) * circumference;
  const colorMap: Record<string, string> = { emerald: '#10b981', amber: '#f59e0b', red: '#ef4444', primary: 'oklch(var(--primary-500))' };
  const strokeColor = colorMap[color] || '#10b981';

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-foreground-200" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={strokeColor} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-700 ease-out" />
    </svg>
  );
}

/* ── Type → colour mapping ── */
const typeStyle: Record<string, { bg: string; iconBg: string; iconText: string; chip: string }> = {
  'Live Session': { bg: 'bg-emerald-50/80', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', chip: 'bg-emerald-100 text-emerald-700' },
  'Video': { bg: 'bg-accent-50/80', iconBg: 'bg-accent-100', iconText: 'text-accent-600', chip: 'bg-accent-100 text-accent-700' },
  'Reading': { bg: 'bg-primary-50/80', iconBg: 'bg-primary-100', iconText: 'text-primary-600', chip: 'bg-primary-100 text-primary-700' },
  'Podcast': { bg: 'bg-secondary-50/80', iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', chip: 'bg-secondary-100 text-secondary-700' },
  'Quiz': { bg: 'bg-amber-50/80', iconBg: 'bg-amber-100', iconText: 'text-amber-600', chip: 'bg-amber-100 text-amber-700' },
  'Activity': { bg: 'bg-accent-50/80', iconBg: 'bg-accent-100', iconText: 'text-accent-700', chip: 'bg-accent-100 text-accent-700' },
  'Reflection': { bg: 'bg-primary-50/80', iconBg: 'bg-primary-100', iconText: 'text-primary-600', chip: 'bg-primary-100 text-primary-700' },
  'Evidence': { bg: 'bg-secondary-50/80', iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', chip: 'bg-secondary-100 text-secondary-700' },
};

const statusStyle: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  'Not Started': { bg: 'bg-background-50', text: 'text-foreground-500', dot: 'bg-foreground-300', border: 'border-foreground-200/50' },
  'In Progress': { bg: 'bg-accent-50/40', text: 'text-accent-800', dot: 'bg-accent-500', border: 'border-accent-300/50' },
  'Evidence Required': { bg: 'bg-amber-50/40', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200/60' },
  'Evidence Submitted': { bg: 'bg-primary-50/40', text: 'text-primary-700', dot: 'bg-primary-500', border: 'border-primary-200/60' },
  'Referred': { bg: 'bg-red-50/40', text: 'text-red-700', dot: 'bg-red-500', border: 'border-red-200/60' },
  'Completed': { bg: 'bg-emerald-50/40', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200/60' },
};

/* ═══════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function ThisWeekPage() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  // Sidebar self-view has no :kind/:id — resolve the active learner's real id.
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { isRealMode, real, loading, loadError } = useLearnerDetailParam(kind, id);
  const p = LEARNER_PROFILE;
  const [searchParams, setSearchParams] = useSearchParams();
  const [components, setComponents] = useState<any[]>([...WEEKLY_LEARNING_COMPONENTS]);
  const [selectedComp, setSelectedComp] = useState<typeof WEEKLY_LEARNING_COMPONENTS[number] | null>(null);

  /* ── Auto-open panel from query param ── */
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) {
      const comp = WEEKLY_LEARNING_COMPONENTS.find(c => c.id === openId);
      if (comp) {
        setSelectedComp(comp);
        // Clean the param so a refresh doesn't re-open
        const next = new URLSearchParams(searchParams);
        next.delete('open');
        setSearchParams(next, { replace: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [videoComp, setVideoComp] = useState<typeof WEEKLY_LEARNING_COMPONENTS[number] | null>(null);
  const [quizComp, setQuizComp] = useState<typeof WEEKLY_LEARNING_COMPONENTS[number] | null>(null);
  const [readingComp, setReadingComp] = useState<typeof WEEKLY_LEARNING_COMPONENTS[number] | null>(null);
  const [podcastComp, setPodcastComp] = useState<typeof WEEKLY_LEARNING_COMPONENTS[number] | null>(null);
  const [evidenceComp, setEvidenceComp] = useState<typeof WEEKLY_LEARNING_COMPONENTS[number] | null>(null);

  const getQuizData = (compId: string) => compId === 'w4-c5' ? QUIZ_1_DATA : QUIZ_2_DATA;
  const getReadingData = (compId: string) => compId === 'w4-c4' ? READING_1_DATA : READING_2_DATA;
  const getPodcastData = (compId: string) => compId === 'w4-c3' ? PODCAST_1_DATA : PODCAST_2_DATA;

  const stats = useMemo(() => {
    const completed = components.filter(c => c.status === 'Completed').length;
    const total = components.length;
    const pct = Math.round((completed / total) * 100);
    const totalPlanned = components.reduce((s, c) => s + c.plannedOTJH, 0);
    const totalClaimed = components.reduce((s, c) => s + c.actualOTJH, 0);
    const totalPoints = components.reduce((s, c) => s + c.points, 0);
    const earnedPoints = components.filter(c => c.status === 'Completed').reduce((s, c) => s + c.points, 0);
    const dueCount = components.filter(c => c.status === 'Not Started' || c.status === 'In Progress' || c.status === 'Evidence Required').length;
    const ksbCount = WEEKLY_KSBS.length;
    return { completed, total, pct, totalPlanned, totalClaimed, totalPoints, earnedPoints, dueCount, ksbCount };
  }, [components]);

  const priority = components.find(c => c.status === 'In Progress') || components[0];

  const handleCtaClick = (comp: typeof WEEKLY_LEARNING_COMPONENTS[number]) => {
    const isActive = comp.status === 'Not Started' || comp.status === 'In Progress';

    if (comp.type === 'Video' && isActive) {
      setVideoComp(comp);
    } else if (comp.type === 'Quiz' && isActive) {
      setQuizComp(comp);
    } else if (comp.type === 'Reading' && isActive) {
      setReadingComp(comp);
    } else if (comp.type === 'Podcast' && isActive) {
      setPodcastComp(comp);
    } else if ((comp.type === 'Evidence' || comp.type === 'Reflection' || comp.type === 'Activity') && (comp.status === 'Evidence Required' || comp.status === 'Referred' || comp.status === 'In Progress' || comp.status === 'Not Started')) {
      setEvidenceComp(comp);
    } else {
      setSelectedComp(null);
    }
  };

  const handleVideoComplete = () => {
    if (!videoComp) return;
    setComponents(prev =>
      prev.map(c =>
        c.id === videoComp.id
          ? {
              ...c,
              status: 'Completed' as const,
              primaryAction: 'View Summary',
              primaryIcon: 'ri-file-list-line',
              actualOTJH: c.plannedOTJH,
              pointsEarned: c.points,
              completedDate: '12 Jun 2026',
              evidenceSubmittedDate: '12 Jun 2026',
              assessmentMethod: 'ai-assisted' as const,
              ksbsAchieved: c.ksbCodes,
            }
          : c,
      ),
    );
    setVideoComp(null);
  };

  const handleVideoSaveProgress = () => {
    if (!videoComp) return;
    setComponents(prev =>
      prev.map(c =>
        c.id === videoComp.id
          ? { ...c, status: 'In Progress' as const, primaryAction: 'Continue Watching', primaryIcon: 'ri-play-circle-line' }
          : c,
      ),
    );
    setVideoComp(null);
  };

  const handleQuizComplete = (score: number, passed: boolean) => {
    if (!quizComp) return;
    if (passed) {
      setComponents(prev =>
        prev.map(c =>
          c.id === quizComp.id
            ? { ...c, status: 'Completed' as const, primaryAction: 'View Summary', primaryIcon: 'ri-file-list-line', actualOTJH: c.plannedOTJH, pointsEarned: c.points, completedDate: '12 Jun 2026', evidenceSubmittedDate: '12 Jun 2026', assessmentMethod: 'ai-assisted' as const, score }
            : c
        )
      );
    } else {
      setComponents(prev =>
        prev.map(c =>
          c.id === quizComp.id
            ? { ...c, score }
            : c
        )
      );
    }
    // Modal stays open in results phase — onClose handles unmounting
  };

  const handleReadingSaveProgress = () => {
    if (readingComp) {
      setComponents(prev =>
        prev.map(c =>
          c.id === readingComp.id
            ? { ...c, status: 'In Progress' as const, primaryAction: 'Continue Reading', primaryIcon: 'ri-book-open-line' }
            : c
        )
      );
      setReadingComp(null);
    }
  };

  const handleReadingComplete = () => {
    if (readingComp) {
      setComponents(prev =>
        prev.map(c =>
          c.id === readingComp.id
            ? {
                ...c,
                status: 'Completed' as const,
                primaryAction: 'View Summary',
                primaryIcon: 'ri-file-list-line',
                actualOTJH: c.plannedOTJH,
                pointsEarned: c.points,
                completedDate: '12 Jun 2026',
                evidenceSubmittedDate: '12 Jun 2026',
                assessmentMethod: 'ai-assisted' as const,
                ksbsAchieved: c.ksbCodes,
              }
            : c
        )
      );
      setReadingComp(null);
    }
  };

  const handlePodcastSaveProgress = () => {
    if (podcastComp) {
      setComponents(prev =>
        prev.map(c =>
          c.id === podcastComp.id
            ? { ...c, status: 'In Progress' as const, primaryAction: 'Continue Listening', primaryIcon: 'ri-headphone-line' }
            : c
        )
      );
      setPodcastComp(null);
    }
  };

  const handlePodcastComplete = () => {
    if (podcastComp) {
      setComponents(prev =>
        prev.map(c =>
          c.id === podcastComp.id
            ? {
                ...c,
                status: 'Completed' as const,
                primaryAction: 'View Summary',
                primaryIcon: 'ri-file-list-line',
                actualOTJH: c.plannedOTJH,
                pointsEarned: c.points,
                completedDate: '12 Jun 2026',
                evidenceSubmittedDate: '12 Jun 2026',
                assessmentMethod: 'ai-assisted' as const,
                ksbsAchieved: c.ksbCodes,
              }
            : c
        )
      );
      setPodcastComp(null);
    }
  };

  const handleEvidenceSubmit = (_data: unknown) => {
    if (!evidenceComp) return;
    setComponents(prev =>
      prev.map(c =>
        c.id === evidenceComp.id
          ? { ...c, status: 'Evidence Submitted' as const, primaryAction: 'View Submission', primaryIcon: 'ri-file-list-line', actualOTJH: c.plannedOTJH, evidenceSubmittedDate: '12 Jun 2026' }
          : c
      )
    );
    setEvidenceComp(null);
  };

  if (isRealMode) {
    return (
      <RealThisWeekView
        real={real}
        loading={loading}
        loadError={loadError}
        kind={kind}
        learnerId={id}
      />
    );
  }

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="This Week"
      pageSubtitle={`Week ${p.currentWeek} · ${p.currentModule}`}
      userName={p.fullName}
      userRole={`${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* ═══════════════════════════════════════════════════
            SECTION 1 — WEEK HERO
            ═══════════════════════════════════════════════════ */}
        <section className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>

          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[170px]">
            <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md border border-accent-400/15">Week 4</span>
                <span className="text-sm text-white/40">9–15 Jun 2026</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stats.pct >= 75 ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/25' : stats.pct >= 40 ? 'bg-accent-400/20 text-accent-300 border border-accent-400/25' : 'bg-amber-400/20 text-amber-300 border border-amber-400/25'}`}>
                  {stats.pct}% Complete
                </span>
              </div>
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">Understanding Customer Segmentation and Campaign Targeting</h1>
              <p className="text-sm text-white/40">Module: Marketing Planning and Campaign Delivery</p>
            </div>

            <div className="lg:w-[320px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex flex-col justify-center">
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-2.5 shrink-0">
                  <DonutRing progress={stats.pct} color="primary" size={54} stroke={4.5} />
                  <div>
                    <p className="text-lg font-heading font-bold text-white leading-none">{stats.pct}%</p>
                    <p className="text-xs text-white/40 mt-0.5">{stats.completed} of {stats.total} done</p>
                  </div>
                </div>
                <div className="w-px h-12 bg-accent-400/10 shrink-0" />
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-primary-400/30 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-semibold text-primary-200">{p.tutor.avatar}</span>
                    </span>
                    <span className="text-xs text-white/50 truncate">{p.tutor.name}</span>
                    <span className="text-[9px] text-white/25">Tutor</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-accent-400/30 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-semibold text-accent-200">{p.coach.avatar}</span>
                    </span>
                    <span className="text-xs text-white/50 truncate">{p.coach.name}</span>
                    <span className="text-[9px] text-white/25">Coach</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <AppIcon className="ri-presentation-line text-white/30 text-xs w-5 h-5 flex items-center justify-center shrink-0"></AppIcon>
                    <span className="text-xs text-white/50 truncate">Live: {p.nextLiveSession.day} {p.nextLiveSession.time}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            SECTION 2 — WEEKLY SNAPSHOT (status badges removed)
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={60}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <SnapshotCard icon="ri-stack-line" label="Weekly Components" value={`${stats.total}`} detail="Learning items" color="primary" />
            <SnapshotCard icon="ri-award-line" label="KSBs Covered" value={`${stats.ksbCount}`} detail="Knowledge, Skills & Behaviours" color="accent" />
            <SnapshotCard icon="ri-time-line" label="Planned OTJH" value={`${stats.totalPlanned}h`} detail="On-the-job training hours" color="secondary" />
            <SnapshotCard icon="ri-calendar-check-line" label="Due This Week" value={`${stats.dueCount} Items`} detail={`${stats.completed} completed · ${stats.earnedPoints}/${stats.totalPoints} pts`} color="amber" />
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 3 — CURRENT PRIORITY
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={100}>
          <section className="relative rounded-2xl overflow-hidden bg-background-50 border border-foreground-200/50 card-premium">
            <div className="absolute inset-0 bg-gradient-to-r from-background-100/60 via-transparent to-transparent pointer-events-none" />
            <div className="relative p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-accent-500 flex items-center justify-center">
                  <AppIcon className="ri-flashlight-line text-foreground-950 text-xs"></AppIcon>
                </span>
                <span className="text-xs font-semibold text-accent-700 uppercase tracking-widest font-label">Current Priority</span>
                {priority.isLive && (
                  <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
                )}
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center gap-5">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg md:text-xl font-heading font-bold text-foreground-900 tracking-tight mb-2">{priority.title}</h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-500">
                    <span className="flex items-center gap-1.5">
                      <AppIcon className="ri-calendar-line text-accent-500"></AppIcon> Wednesday, 11 Jun 2026
                    </span>
                    <span className="text-foreground-300">&middot;</span>
                    <span className="flex items-center gap-1.5">
                      <AppIcon className="ri-time-line text-accent-500"></AppIcon> 10:00–12:00
                    </span>
                    <span className="text-foreground-300">&middot;</span>
                    <span className="flex items-center gap-1.5">
                      <AppIcon className="ri-user-line text-accent-500"></AppIcon> Tutor: {p.tutor.name}
                    </span>
                    <span className="text-foreground-300">&middot;</span>
                    <span className="flex items-center gap-1.5">
                      <AppIcon className="ri-hourglass-line text-accent-500"></AppIcon> {priority.plannedOTJH} OTJH
                    </span>
                  </div>
                  <p className="text-sm text-foreground-400 mt-2">KSBs Developed: {priority.ksbCodes.join(', ')}</p>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <a
                    href={priority.teamsMeetingUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="meeting-join-action px-5 py-3 rounded-xl text-sm font-semibold font-label transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 shadow-sm"
                  >
                    <AppIcon className="ri-microsoft-line"></AppIcon> Join Teams Session
                  </a>
                  <a
                    href="#"
                    className="px-5 py-3 rounded-xl border border-foreground-200 text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2"
                  >
                    <AppIcon className="ri-play-circle-line"></AppIcon> Recording
                  </a>
                </div>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 4 — WEEKLY LEARNING COMPONENTS (compact)
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={140}>
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-heading font-semibold text-foreground-900">Weekly Learning Components</h2>
              <p className="text-sm text-foreground-500 mt-1">All components are due by the end of the week. Every component concludes with Learning Evidence &amp; Reflection.</p>
            </div>

            {/* Journey flow indicator */}
            <div className="flex items-center gap-2 px-4 py-3 bg-background-50 rounded-xl border border-foreground-300/50 overflow-x-auto">
              {['Learn', 'Apply', 'Reflect', 'Evidence', 'Complete'].map((step, i) => (
                <div key={step} className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold whitespace-nowrap ${i <= 1 ? 'text-foreground-700' : 'text-foreground-400'}`}>{step}</span>
                  {i < 4 && <AppIcon className="ri-arrow-right-s-line text-foreground-300 text-xs"></AppIcon>}
                </div>
              ))}
            </div>

            {/* Compact component cards */}
            <div className="space-y-3">
              {components.map(comp => (
                <CompactComponentCard
                  key={comp.id}
                  component={comp}
                  onClick={() => setSelectedComp(comp)}
                />
              ))}
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 5 — WEEKLY PROGRESS & OTJH
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={180}>
          <section className="bg-background-50 rounded-xl border border-foreground-300/50 p-5 md:p-6">
            <h2 className="text-base font-heading font-semibold text-foreground-900 mb-4">Weekly Progress &amp; OTJH</h2>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-5">
              <OTJHStatCard label="Planned" value={`${stats.totalPlanned}h`} icon="ri-calendar-line" color="primary" />
              <OTJHStatCard label="Claimed" value={`${stats.totalClaimed}h`} icon="ri-time-line" color="accent" />
              <OTJHStatCard label="Validated" value={`${(stats.totalClaimed * 0.75).toFixed(1)}h`} icon="ri-check-double-line" color="emerald" />
              <OTJHStatCard label="Remaining" value={`${(stats.totalPlanned - stats.totalClaimed).toFixed(1)}h`} icon="ri-hourglass-line" color={stats.totalPlanned - stats.totalClaimed > 2 ? 'amber' : 'emerald'} />
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-foreground-600">Weekly OTJH Progress</span>
                <span className="text-sm font-semibold text-foreground-700">{Math.round((stats.totalClaimed / stats.totalPlanned) * 100)}%</span>
              </div>
              <div className="h-2 rounded-full bg-background-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${(stats.totalClaimed / stats.totalPlanned) >= 0.7 ? 'bg-emerald-500' : (stats.totalClaimed / stats.totalPlanned) >= 0.4 ? 'bg-accent-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min((stats.totalClaimed / stats.totalPlanned) * 100, 100)}%` }}
                />
              </div>
            </div>

            {stats.totalPlanned - stats.totalClaimed > 2 && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-amber-50/60 border border-amber-200/50">
                <AppIcon className="ri-alert-line text-amber-500 mt-0.5 shrink-0"></AppIcon>
                <div>
                  <p className="text-sm font-semibold text-amber-800 mb-0.5">You are currently {(stats.totalPlanned - stats.totalClaimed).toFixed(1)} hours behind this week&apos;s planned OTJH.</p>
                  <p className="text-xs text-amber-600">Please complete the remaining learning components or speak to your coach.</p>
                </div>
              </div>
            )}

            <div className="mt-5 border-t border-foreground-200/50 pt-4">
              <h3 className="text-sm font-semibold text-foreground-700 mb-3">Off-the-job hours builder</h3>
              <p className="text-xs text-foreground-400 mb-3">Hours build automatically as you complete weekly components. Week of 09/06/2026 – 15/06/2026.</p>
              <div className="overflow-x-auto rounded-xl border border-foreground-300/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-background-100/80 border-b border-foreground-400/50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">Component</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">Date Due</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">Planned</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">Actual</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.filter(c => c.plannedOTJH > 0).map((comp, i) => {
                      const statusBadge = getComponentStatusBadge(comp.status);
                      return (
                        <tr
                          key={comp.id}
                          className={`border-b border-background-100/80 hover:bg-background-50 transition-smooth cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-background-50/40'}`}
                          onClick={() => setSelectedComp(comp)}
                        >
                          <td className="px-4 py-3 text-foreground-700 font-medium max-w-[300px] truncate">{comp.title}</td>
                          <td className="px-4 py-3 text-foreground-500">{comp.dateDueFormatted || comp.dueDate}</td>
                          <td className="px-4 py-3 text-right text-foreground-500">{comp.plannedOTJH}h</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {comp.actualOTJH > 0 ? (
                              <span className="text-emerald-600">{comp.actualOTJH}h</span>
                            ) : (
                              <span className="text-foreground-300">0h</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${statusBadge.bg} ${statusBadge.text}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusBadge.dot}`}></span>
                              {statusBadge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-background-100/80 border-t border-foreground-200/50 font-medium">
                      <td className="px-4 py-3 text-foreground-700">Totals</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right text-foreground-700">{stats.totalPlanned}h</td>
                      <td className="px-4 py-3 text-right text-emerald-600 font-semibold">{stats.totalClaimed.toFixed(2)}h</td>
                      <td className="px-4 py-3 text-xs text-foreground-500">
                        Validated {components.filter(c => c.status === 'Completed').reduce((s, c) => s + c.actualOTJH, 0).toFixed(1)}h
                        {components.filter(c => c.status === 'Evidence Submitted').reduce((s, c) => s + c.actualOTJH, 0) > 0 && (
                          <span> · Pending {components.filter(c => c.status === 'Evidence Submitted').reduce((s, c) => s + c.actualOTJH, 0).toFixed(1)}h</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 6 — KSB DEVELOPMENT
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={220}>
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-heading font-semibold text-foreground-900">KSB Development</h2>
              <Link to="/learner/ksbs" className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap transition-smooth">
                View all KSBs <AppIcon className="ri-arrow-right-line ml-0.5"></AppIcon>
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {WEEKLY_KSBS.map(ksb => (
                <KSBCard key={ksb.code} ksb={ksb} />
              ))}
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 7 — LEARNING RESOURCES
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={300}>
          <section className="bg-background-50 rounded-xl border border-foreground-300/50 p-5 md:p-6">
            <h2 className="text-base font-heading font-semibold text-foreground-900 mb-4">Learning Resources</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {WEEKLY_RESOURCES.map((res, i) => (
                <ResourceCard key={i} resource={res} />
              ))}
            </div>
          </section>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SECTION 9 — COACH & TUTOR GUIDANCE
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={340}>
          <section className="space-y-4">
            <h2 className="text-base font-heading font-semibold text-foreground-900">Coach &amp; Tutor Guidance</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <GuidanceCard role="Tutor" name={p.tutor.name} initials={p.tutor.avatar} color="primary" guidance={WEEKLY_TUTOR_GUIDANCE} />
              <GuidanceCard role="Coach" name={p.coach.name} initials={p.coach.avatar} color="accent" guidance={WEEKLY_COACH_GUIDANCE} />
            </div>
          </section>
        </SectionReveal>

      </div>

      {/* ═══════════════════════════════════════════════════
          COMPONENT DETAIL SIDE PANEL
          ═══════════════════════════════════════════════════ */}
      <RightSlidePanel
        isOpen={!!selectedComp}
        onClose={() => setSelectedComp(null)}
        title="Component Details"
        width="w-[460px]"
      >
        {selectedComp && (
          <ComponentDetailPanel
            component={selectedComp}
            onCtaClick={() => handleCtaClick(selectedComp)}
          />
        )}
      </RightSlidePanel>

      {/* Video Player Modal */}
      {videoComp && (
        <VideoPlayerModal
          isOpen={!!videoComp}
          onClose={() => setVideoComp(null)}
          onComplete={handleVideoComplete}
          onSaveProgress={handleVideoSaveProgress}
          title={videoComp.title}
          type={videoComp.type}
          typeIcon={videoComp.typeIcon}
          duration={videoComp.duration}
          ksbCodes={videoComp.ksbCodes}
          ksbLabels={videoComp.ksbLabels}
          plannedOTJH={videoComp.plannedOTJH}
          points={videoComp.points}
        />
      )}

      {/* Quiz Modal */}
      {quizComp && (
        <QuizModal
          isOpen={!!quizComp}
          onClose={() => setQuizComp(null)}
          onComplete={handleQuizComplete}
          quizData={getQuizData(quizComp.id)}
        />
      )}

      {/* Reading Modal */}
      {readingComp && (
        <ReadingModal
          isOpen={!!readingComp}
          onClose={() => setReadingComp(null)}
          readingData={getReadingData(readingComp.id)}
          title={readingComp.title}
          duration={readingComp.duration}
          points={readingComp.points}
          plannedOTJH={readingComp.plannedOTJH}
          ksbCodes={readingComp.ksbCodes}
          ksbLabels={readingComp.ksbLabels}
          onComplete={handleReadingComplete}
          onSaveProgress={handleReadingSaveProgress}
        />
      )}

      {/* Podcast Modal */}
      {podcastComp && (
        <ReadingPodcastModal
          isOpen={!!podcastComp}
          onClose={() => setPodcastComp(null)}
          mode="podcast"
          podcastData={getPodcastData(podcastComp.id)}
          title={podcastComp.title}
          duration={podcastComp.duration}
          points={podcastComp.points}
          plannedOTJH={podcastComp.plannedOTJH}
          ksbCodes={podcastComp.ksbCodes}
          ksbLabels={podcastComp.ksbLabels}
          onComplete={handlePodcastComplete}
          onSaveProgress={handlePodcastSaveProgress}
        />
      )}

      {/* Evidence Logging Modal */}
      {evidenceComp && (
        <EvidenceLoggingModal
          isOpen={!!evidenceComp}
          onClose={() => setEvidenceComp(null)}
          onSubmit={handleEvidenceSubmit}
          title={evidenceComp.title}
          componentType={evidenceComp.type}
          weekNumber={4}
          moduleName="Marketing Planning and Campaign Delivery"
          ksbCodes={evidenceComp.ksbCodes}
          ksbLabels={evidenceComp.ksbLabels}
          plannedOTJH={evidenceComp.plannedOTJH}
          points={evidenceComp.points}
          isReferred={evidenceComp.status === 'Referred'}
          referralReason={evidenceComp.referralReason}
          requiredActions={evidenceComp.requiredActions}
        />
      )}
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════════════
   COMPACT COMPONENT CARD
   ═══════════════════════════════════════════════════════════════ */
function CompactComponentCard({
  component: c,
  onClick,
}: {
  component: typeof WEEKLY_LEARNING_COMPONENTS[number];
  onClick: () => void;
}) {
  const ts = typeStyle[c.type] || typeStyle['Evidence'];
  const ss = statusStyle[c.status] || statusStyle['Not Started'];
  const isCompleted = c.status === 'Completed';
  const isInProgress = c.status === 'In Progress';
  const isReferred = c.status === 'Referred';

  return (
    <div
      className={`relative rounded-xl border p-4 transition-smooth card-premium cursor-pointer ${isReferred ? 'border-foreground-200/50 bg-background-50' : isInProgress ? 'border-foreground-200/50 bg-background-50' : isCompleted ? 'border-foreground-200/50 bg-background-50' : 'border-foreground-200/50 bg-background-50'}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {/* Type icon */}
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${ts.iconBg} ${ts.iconText}`}>
          <AppIcon className={`${c.typeIcon} text-lg`}></AppIcon>
        </div>

        <div className="flex-1 min-w-0">
          {/* Top row: type chip + status */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${ts.chip}`}>{c.type}</span>
            {c.isLive && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
            )}
            {isInProgress && !c.isLive && (
              <span className="text-xs font-semibold text-accent-600 bg-accent-50 px-2 py-0.5 rounded-full">Active</span>
            )}
            {isCompleted && (
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                <AppIcon className="ri-check-line"></AppIcon> Done
              </span>
            )}
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ml-auto ${ss.bg} ${ss.text}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${ss.dot} mr-1 align-middle`}></span>
              {c.status}
            </span>
          </div>

          {/* Title */}
          <p className={`text-sm font-semibold mb-2 ${isCompleted ? 'text-foreground-400 line-through' : 'text-foreground-900'}`}>{c.title}</p>

          {/* Compact meta row */}
          <div className="flex items-center gap-x-4 gap-y-1 text-xs text-foreground-400 flex-wrap">
            <span className="flex items-center gap-1"><AppIcon className="ri-timer-line"></AppIcon> {c.duration}</span>
            <span className="flex items-center gap-1"><AppIcon className="ri-time-line"></AppIcon> {c.plannedOTJH}h OTJH</span>
            {c.actualOTJH > 0 && (
              <span className="flex items-center gap-1 text-emerald-600">
                <AppIcon className="ri-check-line"></AppIcon> {c.actualOTJH}h logged
              </span>
            )}
            <span className="flex items-center gap-1"><AppIcon className="ri-calendar-line"></AppIcon> {c.dueDate}</span>
            <span className="flex items-center gap-1 text-amber-600"><AppIcon className="ri-coin-line"></AppIcon> {c.points} pts</span>
          </div>
        </div>

        {/* Share button — right side */}
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth shrink-0 mt-0.5"
          onClick={(e) => {
            e.stopPropagation();
            if (navigator.share) {
              navigator.share({
                title: c.title,
                text: `${c.type} — ${c.title} (${c.plannedOTJH}h OTJH)`,
                url: window.location.href,
              });
            } else {
              navigator.clipboard.writeText(`${c.title} — ${c.type} (${c.plannedOTJH}h OTJH)`);
            }
          }}
          title="Share"
        >
          <AppIcon className="ri-share-forward-line text-sm"></AppIcon>
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENT DETAIL PANEL (inside RightSlidePanel)
   ═══════════════════════════════════════════════════════════════ */
function ComponentDetailPanel({ component: c, onCtaClick }: { component: typeof WEEKLY_LEARNING_COMPONENTS[number]; onCtaClick: () => void }) {
  const ts = typeStyle[c.type] || typeStyle['Evidence'];
  const ss = statusStyle[c.status] || statusStyle['Not Started'];
  const isCompleted = c.status === 'Completed';
  const isReferred = c.status === 'Referred';
  const isEvidenceSubmitted = c.status === 'Evidence Submitted';
  const hasAnyFeedback = !!(c.coachFeedback || c.qaFeedback || c.aiFeedback);
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null);

  const ctaConfig: Record<string, { bg: string; hoverBg: string; border?: string; textColor?: string }> = {
    'Not Started': { bg: 'bg-primary-500', hoverBg: 'hover:bg-primary-600', textColor: 'text-background-50 dark:text-foreground-950' },
    'In Progress': { bg: 'bg-accent-500', hoverBg: 'hover:bg-accent-600', textColor: 'text-foreground-950' },
    'Evidence Required': { bg: 'bg-amber-500', hoverBg: 'hover:bg-amber-600', textColor: 'text-foreground-950' },
    'Evidence Submitted': { bg: 'bg-primary-500', hoverBg: 'hover:bg-primary-600', textColor: 'text-background-50 dark:text-foreground-950' },
    'Referred': { bg: 'bg-red-500', hoverBg: 'hover:bg-red-600', textColor: 'text-white' },
    'Completed': { bg: 'bg-background-50', hoverBg: 'hover:bg-background-100', border: 'border border-foreground-200', textColor: 'text-foreground-600' },
  };
  const cta = ctaConfig[c.status] || ctaConfig['Not Started'];
  const ctaInfo = getCtaLabelAndIcon(c.type, c.status);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${ts.chip}`}>
            <AppIcon className={`${c.typeIcon} text-xs`}></AppIcon>
            {c.type}
          </span>
          {c.isLive && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ss.bg} ${ss.text}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${ss.dot} mr-1 align-middle`}></span>
            {c.status}
          </span>
        </div>
        <h2 className={`text-[16px] font-heading font-bold leading-snug ${isCompleted ? 'text-foreground-500' : 'text-foreground-900'}`}>
          {c.title}
        </h2>
      </div>

      {/* Key Info Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-background-100/60 rounded-xl p-3">
          <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Duration</p>
          <p className="text-sm font-semibold text-foreground-900">{c.duration}</p>
        </div>
        <div className="bg-background-100/60 rounded-xl p-3">
          <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Due Date</p>
          <p className="text-sm font-semibold text-foreground-900">{c.dueDate}</p>
        </div>
        <div className="bg-background-100/60 rounded-xl p-3">
          <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Planned OTJH</p>
          <p className="text-sm font-semibold text-foreground-900">{c.plannedOTJH} hrs</p>
        </div>
        <div className="bg-background-100/60 rounded-xl p-3">
          <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Points</p>
          <p className="text-sm font-semibold text-amber-600">{c.points} pts</p>
        </div>
        <div className="bg-background-100/60 rounded-xl p-3">
          <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Actual OTJH</p>
          <p className={`text-sm font-semibold ${c.actualOTJH > 0 ? 'text-emerald-600' : 'text-foreground-400'}`}>
            {c.actualOTJH > 0 ? `${c.actualOTJH} hrs` : 'Not logged yet'}
          </p>
        </div>
        <div className="bg-background-100/60 rounded-xl p-3">
          <p className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-1">Assessment</p>
          <p className="text-sm font-semibold text-foreground-900">
            {c.assessmentMethod === 'ai-assisted' ? 'AI Assisted' : c.assessmentMethod === 'tutor-assessed' ? 'Tutor Assessed' : 'Standard'}
          </p>
        </div>
      </div>

      {/* KSBs Section */}
      <div>
        <h3 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-2">KSBs Developed</h3>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {c.ksbCodes.map(code => (
            <span
              key={code}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                code.startsWith('K') ? 'bg-primary-100 text-primary-700 border-primary-200' :
                code.startsWith('S') ? 'bg-accent-100 text-accent-700 border-accent-200' :
                code === 'Multiple' ? 'bg-foreground-100 text-foreground-600 border-foreground-200' :
                'bg-secondary-100 text-secondary-700 border-secondary-200'
              }`}
            >
              {code}
            </span>
          ))}
        </div>
        <p className="text-sm text-foreground-500 leading-relaxed">{c.ksbLabels}</p>
      </div>

      {/* ── FEEDBACK PANELS (Evidence Submitted & Referred) ── */}
      {(isEvidenceSubmitted || isReferred) && hasAnyFeedback && (
        <div className="space-y-2">
          <h3 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold">Assessment Feedback</h3>

          {c.aiFeedback && (
            <FeedbackPanel
              label="AI Assessment Feedback"
              icon="ri-robot-line"
              color="primary"
              from="AI Marking System"
              date={c.aiFeedback.date}
              text={c.aiFeedback.summary}
              score={c.aiFeedback.score}
              isExpanded={expandedFeedback === 'ai'}
              onToggle={() => setExpandedFeedback(expandedFeedback === 'ai' ? null : 'ai')}
            />
          )}

          {c.coachFeedback && (
            <FeedbackPanel
              label="Coach Feedback"
              icon="ri-user-star-line"
              color="accent"
              from={c.coachFeedback.from}
              date={c.coachFeedback.date}
              text={c.coachFeedback.text}
              isExpanded={expandedFeedback === 'coach'}
              onToggle={() => setExpandedFeedback(expandedFeedback === 'coach' ? null : 'coach')}
            />
          )}

          {c.qaFeedback && (
            <FeedbackPanel
              label="Quality Assurance Feedback"
              icon="ri-shield-check-line"
              color={isReferred ? 'red' : 'emerald'}
              from={c.qaFeedback.from}
              date={c.qaFeedback.date}
              text={c.qaFeedback.text}
              isExpanded={expandedFeedback === 'qa'}
              onToggle={() => setExpandedFeedback(expandedFeedback === 'qa' ? null : 'qa')}
            />
          )}
        </div>
      )}

      {/* ── REFERRAL DETAILS ── */}
      {isReferred && (
        <div className="bg-red-50/60 border border-red-200/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <AppIcon className="ri-arrow-go-back-line text-red-600 text-sm"></AppIcon>
            </span>
            <h3 className="text-sm font-semibold text-red-800">Submission Referred</h3>
          </div>

          <div>
            <p className="text-xs text-red-500 uppercase tracking-wider font-semibold mb-1">Reason for Referral</p>
            <p className="text-sm text-red-700 leading-relaxed">{c.referralReason}</p>
          </div>

          <div>
            <p className="text-xs text-red-500 uppercase tracking-wider font-semibold mb-1">Feedback Source</p>
            <p className="text-sm text-red-700">{c.referralSource}</p>
          </div>

          <div>
            <p className="text-xs text-red-500 uppercase tracking-wider font-semibold mb-1">Required Actions</p>
            <p className="text-sm text-red-700 leading-relaxed whitespace-pre-line">{c.requiredActions}</p>
          </div>
        </div>
      )}

      {/* ── COMPLETED COMPONENT SUMMARY ── */}
      {isCompleted && (
        <div className="bg-background-50 border border-foreground-200/50 rounded-xl p-4">
          <h3 className="text-xs text-foreground-400 uppercase tracking-wider font-semibold mb-3">Completed Component Summary</h3>
          <div className="space-y-2.5">
            <SummaryRow label="Completed Date" value={c.completedDate || '—'} />
            <SummaryRow label="Evidence Submitted" value={c.evidenceSubmittedDate || '—'} />
            <SummaryRow label="Coach Approval Date" value={c.coachApprovedDate || '—'} />
            <SummaryRow label="QA Approval Date" value={c.qaApprovedDate || '—'} />
            <SummaryRow label="Assessment Method" value={c.assessmentMethod === 'ai-assisted' ? 'AI Assisted Assessment' : c.assessmentMethod === 'tutor-assessed' ? 'Tutor Assessed' : 'Standard'} />
            <SummaryRow label="OTJH Awarded" value={`${c.otjhAwarded} hours`} />
            <SummaryRow label="Points Earned" value={`${c.pointsEarned} pts`} />
            {c.score !== null && c.score !== undefined && (
              <div className="flex items-center justify-between text-sm py-1 px-2 rounded-lg bg-emerald-100/50">
                <span className="text-emerald-700 font-semibold">Quiz Score</span>
                <span className="font-bold text-emerald-800 text-base">{c.score}%</span>
              </div>
            )}
            <div>
              <p className="text-xs text-foreground-400 font-semibold mb-1.5">KSBs Achieved</p>
              <div className="flex flex-wrap gap-1">
                {c.ksbsAchieved.length > 0 ? c.ksbsAchieved.map(k => (
                  <span key={k} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">{k}</span>
                )) : (
                  <span className="text-xs text-foreground-400">—</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SINGLE STATUS-DRIVEN CTA (bottom of panel) ── */}
      <button
        type="button"
        onClick={onCtaClick}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${cta.bg} ${cta.hoverBg} ${cta.textColor || ''} ${cta.border || ''}`}
      >
        <AppIcon className={`${ctaInfo.icon} text-sm`}></AppIcon>
        {ctaInfo.label}
      </button>
    </div>
  );
}

/* ── Expandable Feedback Panel ── */
function FeedbackPanel({
  label, icon, color, from, date, text, score, isExpanded, onToggle,
}: {
  label: string;
  icon: string;
  color: 'primary' | 'accent' | 'red' | 'emerald';
  from: string;
  date: string;
  text: string;
  score?: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const clr = {
    primary: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-primary-100', iconText: 'text-primary-600', badge: 'bg-primary-100 text-primary-700' },
    accent: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-accent-100', iconText: 'text-accent-600', badge: 'bg-accent-100 text-accent-700' },
    red: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-red-100', iconText: 'text-red-600', badge: 'bg-red-100 text-red-700' },
    emerald: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
  }[color];
  const arrowIcon = isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line';

  return (
    <div className={`rounded-xl border ${clr.border} ${clr.bg} overflow-hidden`}>
      <button
        className="w-full flex items-center justify-between p-3.5 text-left hover:bg-foreground-50/30 transition-smooth cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${clr.iconBg} ${clr.iconText}`}>
            <AppIcon className={`${icon} text-sm`}></AppIcon>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground-900 truncate">{label}</p>
            <p className="text-xs text-foreground-400">{from} · {date}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {score !== undefined && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${clr.badge}`}>{score}%</span>
          )}
          <AppIcon className={`${arrowIcon} text-foreground-400 text-sm`}></AppIcon>
        </div>
      </button>
      {isExpanded && (
        <div className="px-3.5 pb-3.5 pt-0 border-t border-foreground-100/50 mx-3.5">
          <p className="text-sm text-foreground-600 leading-relaxed pt-3">{text}</p>
        </div>
      )}
    </div>
  );
}

/* ── Completed Summary Row ── */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground-400">{label}</span>
      <span className="font-medium text-foreground-700 text-right">{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function SnapshotCard({ icon, label, value, detail, color }: { icon: string; label: string; value: string; detail: string; color: 'primary' | 'accent' | 'secondary' | 'amber' }) {
  const colorMap = {
    primary: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-primary-100', iconText: 'text-primary-600', accent: 'text-primary-700' },
    accent: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-accent-100', iconText: 'text-accent-600', accent: 'text-accent-700' },
    secondary: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-secondary-100', iconText: 'text-secondary-600', accent: 'text-secondary-700' },
    amber: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-amber-100', iconText: 'text-amber-600', accent: 'text-amber-700' },
  };
  const c = colorMap[color];

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-4 card-premium`}>
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconBg} ${c.iconText} mb-3`}>
        <AppIcon className={`${icon} text-sm`}></AppIcon>
      </span>
      <p className="text-xs text-foreground-400 mb-1">{label}</p>
      <p className={`text-xl font-heading font-bold ${c.accent} leading-tight`}>{value}</p>
      <p className="text-xs text-foreground-400 mt-1">{detail}</p>
    </div>
  );
}

function OTJHStatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const c = {
    primary: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-primary-100', iconText: 'text-primary-600', accent: 'text-primary-700' },
    accent: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-accent-100', iconText: 'text-accent-600', accent: 'text-accent-700' },
    emerald: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', accent: 'text-emerald-700' },
    amber: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-amber-100', iconText: 'text-amber-600', accent: 'text-amber-700' },
  }[color] || { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-background-100', iconText: 'text-foreground-500', accent: 'text-foreground-700' };

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconBg} ${c.iconText}`}>
          <AppIcon className={`${icon} text-sm`}></AppIcon>
        </span>
        <span className="text-xs text-foreground-400">{label}</span>
      </div>
      <p className={`text-xl font-heading font-bold ${c.accent}`}>{value}</p>
    </div>
  );
}

function KSBCard({ ksb }: { ksb: typeof WEEKLY_KSBS[number] }) {
  const typeStyle2 = {
    Knowledge: { bg: 'bg-primary-100', text: 'text-primary-700', bar: 'bg-primary-500' },
    Skill: { bg: 'bg-accent-100', text: 'text-accent-700', bar: 'bg-accent-500' },
    Behaviour: { bg: 'bg-secondary-100', text: 'text-secondary-700', bar: 'bg-secondary-500' },
  }[ksb.type];

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-300/50 p-4 card-premium">
      <div className="flex items-center justify-between mb-3">
        <span className="text-lg font-heading font-bold text-foreground-900">{ksb.code}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeStyle2.bg} ${typeStyle2.text}`}>{ksb.type}</span>
      </div>
      <p className="text-sm text-foreground-600 mb-3 leading-relaxed">{ksb.desc}</p>
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-foreground-400">Weekly Progress</span>
          <span className="text-xs font-semibold text-foreground-600">{ksb.progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-background-100 overflow-hidden">
          <div className={`h-full rounded-full ${typeStyle2.bar} transition-all duration-500`} style={{ width: `${ksb.progress}%` }} />
        </div>
      </div>
      <div>
        <span className="text-xs text-foreground-400 block mb-1.5">Mapped components:</span>
        <div className="flex flex-wrap gap-1">
          {ksb.components.map((comp, i) => (
            <span key={i} className="text-xs text-foreground-500 bg-background-100 px-2 py-0.5 rounded">{comp}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResourceCard({ resource }: { resource: typeof WEEKLY_RESOURCES[number] }) {
  return (
    <a
      href={resource.href}
      className="flex items-start gap-3 p-3.5 rounded-xl border border-foreground-200/50 bg-background-50 hover:border-foreground-300/50 transition-smooth cursor-pointer card-premium group"
    >
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
        resource.type === 'Recording' || resource.type === 'Video' ? 'bg-accent-100 text-accent-600' :
        resource.type === 'Reading' ? 'bg-primary-100 text-primary-600' :
        resource.type === 'Template' ? 'bg-secondary-100 text-secondary-600' :
        resource.type === 'Download' ? 'bg-emerald-100 text-emerald-600' :
        'bg-background-100 text-foreground-500'
      }`}>
        <AppIcon className={`${resource.icon} text-sm`}></AppIcon>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground-900 group-hover:text-primary-700 transition-smooth leading-snug mb-0.5">{resource.title}</p>
        <span className="text-xs text-foreground-400 bg-background-100 px-1.5 py-0.5 rounded">{resource.type}</span>
        <p className="text-xs text-foreground-400 mt-1 leading-relaxed">{resource.description}</p>
      </div>
    </a>
  );
}

function GuidanceCard({ role, name, initials, color, guidance }: { role: string; name: string; initials: string; color: 'primary' | 'accent'; guidance: { notes: string; suggestedFocus: string; supportAvailable: string } }) {
  const c = {
    primary: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-primary-200', iconText: 'text-primary-800', heading: 'text-primary-800', chip: 'bg-primary-100 text-primary-700' },
    accent: { bg: 'bg-background-50', border: 'border-foreground-200/50', iconBg: 'bg-accent-200', iconText: 'text-accent-800', heading: 'text-accent-800', chip: 'bg-accent-100 text-accent-700' },
  }[color];

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-5 md:p-6`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-full ${c.iconBg} flex items-center justify-center shrink-0`}>
          <span className={`text-xs font-semibold ${c.iconText}`}>{initials}</span>
        </div>
        <div>
          <p className={`text-sm font-heading font-semibold ${c.heading}`}>{role} Guidance</p>
          <p className="text-xs text-foreground-400">{name}</p>
        </div>
      </div>
      <div className="space-y-4">
        <div>
          <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${c.chip} mb-2 inline-block`}>Notes</span>
          <p className="text-sm text-foreground-600 leading-relaxed">{guidance.notes}</p>
        </div>
        <div>
          <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${c.chip} mb-2 inline-block`}>Suggested Focus</span>
          <p className="text-sm text-foreground-600 leading-relaxed">{guidance.suggestedFocus}</p>
        </div>
        <div>
          <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${c.chip} mb-2 inline-block`}>Support Available</span>
          <p className="text-sm text-foreground-600 leading-relaxed">{guidance.supportAvailable}</p>
        </div>
      </div>
    </div>
  );
}

/* ── CTA label + icon based on type + status ── */
function getCtaLabelAndIcon(type: string, status: string) {
  const icons: Record<string, Record<string, { label: string; icon: string }>> = {
    'Not Started': {
      Quiz: { label: 'Take Quiz', icon: 'ri-questionnaire-line' },
      Reading: { label: 'Read', icon: 'ri-book-open-line' },
      Podcast: { label: 'Listen', icon: 'ri-headphone-line' },
      Video: { label: 'Watch Video', icon: 'ri-play-circle-line' },
      'Live Session': { label: 'Join Session', icon: 'ri-presentation-line' },
      Activity: { label: 'Start Activity', icon: 'ri-task-line' },
      Reflection: { label: 'Start Reflection', icon: 'ri-chat-quote-line' },
      Evidence: { label: 'Log Evidence', icon: 'ri-file-add-line' },
    },
    'In Progress': {
      Quiz: { label: 'Continue Quiz', icon: 'ri-questionnaire-line' },
      Reading: { label: 'Continue Reading', icon: 'ri-book-open-line' },
      Podcast: { label: 'Continue Listening', icon: 'ri-headphone-line' },
      Video: { label: 'Continue Watching', icon: 'ri-play-circle-line' },
      'Live Session': { label: 'Continue Learning', icon: 'ri-presentation-line' },
      Activity: { label: 'Continue Activity', icon: 'ri-task-line' },
      Reflection: { label: 'Continue Reflection', icon: 'ri-chat-quote-line' },
      Evidence: { label: 'Continue Logging', icon: 'ri-file-add-line' },
    },
    'Evidence Required': { default: { label: 'Log Evidence', icon: 'ri-file-add-line' } },
    'Evidence Submitted': { default: { label: 'View Submission', icon: 'ri-file-list-line' } },
    Referred: { default: { label: 'Update Submission', icon: 'ri-edit-line' } },
    Completed: { default: { label: 'View Summary', icon: 'ri-file-list-line' } },
  };

  const statusMap = icons[status] || icons['Completed'];
  const entry = statusMap[type] || statusMap.default || { label: 'Start Learning', icon: 'ri-play-circle-line' };
  return entry;
}

function getComponentStatusBadge(status: string) {
  const map: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    'Completed': { label: 'Validated', bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    'Evidence Submitted': { label: 'Pending tutor', bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
    'In Progress': { label: 'In progress', bg: 'bg-accent-100', text: 'text-accent-700', dot: 'bg-accent-500' },
    'Not Started': { label: 'Not started', bg: 'bg-background-100', text: 'text-foreground-500', dot: 'bg-foreground-300' },
    'Referred': { label: 'Referred', bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
    'Evidence Required': { label: 'Evidence Required', bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  };
  return map[status] || map['Not Started'];
}
