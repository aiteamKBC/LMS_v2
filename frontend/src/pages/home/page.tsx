import { useCountUp, useInView } from '@/hooks/useCountUp';
import { BrandLockup } from '@/components/BrandLockup';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

// ── Workspaces shown as launch buttons on the home page ──
// Each maps to a demo account so entering a section signs you in as the
// matching role (no password). Sections without a dedicated demo user reuse
// the closest account — the same mapping the in-app RoleSwitcher uses.
interface WorkspaceSection {
  slug: string;
  label: string;
  icon: string;
  email: string;
  workspacePath: string;
  /** Visually featured on the launcher grid */
  highlighted?: boolean;
}

const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  //{ slug: 'learner', label: 'Learner', icon: 'ri-user-line', email: 'learner@kbc.test', workspacePath: '/workspace/learner', highlighted: true },
  { slug: 'coach', label: 'Coach', icon: 'ri-user-heart-line', email: 'coach@kbc.test', workspacePath: '/workspace/coach', highlighted: true },
  // { slug: 'tutor', label: 'Tutor', icon: 'ri-presentation-line', email: 'tutor@kbc.test', workspacePath: '/workspace/tutor' },
  // { slug: 'employer', label: 'Employer', icon: 'ri-building-2-line', email: 'employer@kbc.test', workspacePath: '/workspace/employer' },
  { slug: 'enrolment', label: 'Enrolment', icon: 'ri-user-add-line', email: 'compliance@kbc.test', workspacePath: '/users', highlighted: true },
  // { slug: 'qa', label: 'QA Officer', icon: 'ri-search-eye-line', email: 'qa@kbc.test', workspacePath: '/workspace/qa' },
  // { slug: 'mis', label: 'MIS User', icon: 'ri-database-2-line', email: 'mis@kbc.test', workspacePath: '/workspace/mis' },
  { slug: 'curriculum', label: 'Curriculum', icon: 'ri-book-open-line', email: 'tutor@kbc.test', workspacePath: '/workspace/curriculum', highlighted: true },
  { slug: 'engagement', label: 'Engagement', icon: 'ri-megaphone-line', email: 'compliance@kbc.test', workspacePath: '/workspace/engagement', highlighted: true },
  { slug: 'audit', label: 'Audit', icon: 'ri-file-search-line', email: 'auditor@kbc.test', workspacePath: '/workspace/auditor', highlighted: true },
  // { slug: 'leadership', label: 'Leadership', icon: 'ri-vip-crown-line', email: 'leadership@kbc.test', workspacePath: '/workspace/leadership' },
  //{ slug: 'admin', label: 'Admin', icon: 'ri-settings-3-line', email: 'admin@kbc.test', workspacePath: '/workspace/admin', highlighted: true },
  // { slug: 'finance', label: 'Finance', icon: 'ri-money-pound-circle-line', email: 'finance@kbc.test', workspacePath: '/workspace/finance' },
  // { slug: 'auditor', label: 'Auditor', icon: 'ri-history-line', email: 'auditor@kbc.test', workspacePath: '/workspace/auditor' },
  // { slug: 'support', label: 'Support', icon: 'ri-customer-service-2-line', email: 'admin@kbc.test', workspacePath: '/workspace/support' },
  // { slug: 'safeguarding', label: 'Safeguarding', icon: 'ri-shield-line', email: 'compliance@kbc.test', workspacePath: '/workspace/safeguarding' },
];

function CountUpStat({ end, suffix = '', prefix = '', duration = 1200, label }: { end: number; suffix?: string; prefix?: string; duration?: number; label: string }) {
  const { ref, isInView } = useInView();
  const { count } = useCountUp({ end, duration, startOnMount: false });
  const [displayValue, setDisplayValue] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (isInView && !hasStarted) {
      setHasStarted(true);
    }
  }, [isInView, hasStarted]);

  useEffect(() => {
    if (!hasStarted) return;
    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
    const startTime = performance.now();
    let frameId: number;

    const animate = (timestamp: number) => {
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = easeOutQuart(progress);
      setDisplayValue(Math.floor(eased * end));
      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [hasStarted, end, duration]);

  return (
    <div ref={ref}>
      <p className="text-[26px] font-heading font-semibold text-foreground-900 leading-none">
        {prefix}{displayValue}{suffix}
      </p>
      <p className="text-[12px] text-foreground-400 mt-1">{label}</p>
    </div>
  );
}

// Separate chart cards stay positioned around the learner, matching the original hero composition.
const HERO_CARD_BASE = 'cursor-pointer rounded-2xl border border-white/15 bg-[#0f0b20]/65 text-white shadow-2xl shadow-black/30 backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-2 hover:scale-[1.03] hover:border-accent-300/70 hover:bg-[#15102a]/85 hover:shadow-[0_18px_45px_rgba(124,58,237,0.32)]';

const HERO_KSB_PROGRESS = [
  { label: 'Knowledge', value: 80, colour: 'from-accent-300 to-accent-500' },
  { label: 'Skills', value: 75, colour: 'from-primary-400 to-primary-600' },
  { label: 'Behaviours', value: 78, colour: 'from-secondary-300 to-secondary-500' },
];

function MyProgressCard() {
  return (
    <div className={`${HERO_CARD_BASE} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-white/75">My progress</p>
        <i className="ri-line-chart-line text-accent-300" />
      </div>
      <div className="my-4 flex justify-center">
        <div
          className="relative h-32 w-32 rounded-full p-2.5 shadow-[0_0_35px_rgba(168,85,247,0.25)]"
          style={{ background: 'conic-gradient(#f5c84b 0deg 172deg, #8b5cf6 172deg 280deg, rgba(255,255,255,0.12) 280deg 360deg)' }}
        >
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#15102a]">
            <span className="text-3xl font-heading font-semibold tracking-tight text-white">78%</span>
            <span className="mt-1 text-[10px] text-white/50">overall progress</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 text-[10px] text-white/55">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent-400" /> Complete</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-primary-400" /> In progress</span>
      </div>
    </div>
  );
}

function KsbProgressCard() {
  return (
    <div className={`${HERO_CARD_BASE} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-white/75">KSBs progress</p>
        <span className="text-[10px] text-white/45">This month</span>
      </div>
      <div className="mt-5 space-y-4">
        {HERO_KSB_PROGRESS.map((item) => (
          <div key={item.label}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="text-white/70">{item.label}</span>
              <span className="font-semibold text-white">{item.value}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${item.colour} shadow-[0_0_12px_rgba(168,85,247,0.35)]`}
                style={{ width: `${item.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-accent-300/15 bg-accent-300/5 px-3 py-2 text-[10px] text-accent-100/80">
        <i className="ri-arrow-up-line text-accent-300" />
        <span>+8% since last review</span>
      </div>
    </div>
  );
}

function CurrentModuleCard() {
  return (
    <div className={`${HERO_CARD_BASE} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary-300/20 bg-primary-500/20 text-primary-200">
            <i className="ri-book-open-line" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">Current module</p>
            <p className="mt-1 truncate text-xs font-semibold text-white">Marketing Planning &amp; Strategy</p>
          </div>
        </div>
        <span className="shrink-0 text-base font-heading font-semibold text-accent-300">67%</span>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-[67%] rounded-full bg-gradient-to-r from-primary-500 via-primary-400 to-accent-300 shadow-[0_0_16px_rgba(139,92,246,0.45)]" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-white/45">
        <span>8 of 12 lessons</span>
        <span>2 tasks left</span>
      </div>
    </div>
  );
}

function LearnerJourneyCard() {
  return (
    <div className={`${HERO_CARD_BASE} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-white/75">Learner journey</p>
        <span className="text-[10px] text-white/45">Phase 2 of 4</span>
      </div>
      <div className="relative mt-5 grid grid-cols-4 gap-2">
        <div className="absolute left-[10%] right-[10%] top-2.5 h-0.5 bg-white/10" />
        <div className="absolute left-[10%] top-2.5 h-0.5 w-[27%] bg-gradient-to-r from-accent-400 to-primary-400" />
        {[
          { label: 'Pre-active', state: 'done' },
          { label: 'Active learning', state: 'current' },
          { label: 'Gateway', state: 'next' },
          { label: 'EPA', state: 'next' },
        ].map((stage) => (
          <div key={stage.label} className="relative z-10 flex flex-col items-center gap-2 text-center">
            <span className={`h-5 w-5 rounded-full border-4 border-[#17112e] ${
              stage.state === 'done' ? 'bg-accent-300' : stage.state === 'current' ? 'bg-primary-400 ring-4 ring-primary-400/20' : 'bg-white/20'
            }`} />
            <span className={`text-[9px] leading-tight ${stage.state === 'next' ? 'text-white/35' : 'text-white/70'}`}>{stage.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NextMilestoneCard() {
  return (
    <div className={`${HERO_CARD_BASE} border-accent-300/15 bg-accent-300/[0.08] p-4`}>
      <p className="text-[10px] uppercase tracking-[0.16em] text-accent-200/60">Next milestone</p>
      <div className="mt-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/30 text-primary-200"><i className="ri-shield-check-line" /></span>
        <div>
          <p className="text-xs font-semibold text-white">Submit campaign plan</p>
          <p className="mt-0.5 text-[10px] text-accent-200">Due in 5 days</p>
        </div>
      </div>
    </div>
  );
}

function RecentActivityCard() {
  return (
    <div className={`${HERO_CARD_BASE} p-4`}>
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Recent activity</p>
      <div className="mt-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-primary-300/30 bg-primary-500/15 text-primary-200"><i className="ri-check-line text-xs" /></span>
        <div>
          <p className="text-xs font-medium text-white/80">Evidence uploaded</p>
          <p className="mt-0.5 text-[10px] text-white/40">2 hours ago</p>
        </div>
      </div>
    </div>
  );
}

function HeroProgressDesktop() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 hidden lg:block">
      <div className="pointer-events-auto absolute left-[50%] top-[14%] w-[12%] min-w-[180px] max-w-[215px] animate-hero-fade-in-up delay-500"><MyProgressCard /></div>
      <div className="pointer-events-auto absolute right-0 top-[14%] w-[15%] min-w-[210px] max-w-[270px] animate-hero-fade-in-up delay-700"><KsbProgressCard /></div>
      <div className="pointer-events-auto absolute left-[46%] top-[52%] w-[14%] min-w-[200px] max-w-[250px] animate-hero-fade-in-up delay-700"><CurrentModuleCard /></div>
      <div className="pointer-events-auto absolute right-0 top-[51%] w-[15%] min-w-[210px] max-w-[270px] animate-hero-fade-in-up delay-900"><NextMilestoneCard /></div>
      <div className="pointer-events-auto absolute right-[1%] top-[72%] w-[13%] min-w-[190px] max-w-[240px] animate-hero-fade-in-up delay-900"><RecentActivityCard /></div>
      <div className="pointer-events-auto absolute left-1/2 top-[69%] w-[20%] min-w-[280px] max-w-[340px] -translate-x-1/2 animate-hero-fade-in-up delay-900"><LearnerJourneyCard /></div>
    </div>
  );
}

function HeroProgressMobile() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <MyProgressCard />
      <KsbProgressCard />
      <div className="sm:col-span-2"><CurrentModuleCard /></div>
      <div className="sm:col-span-2"><LearnerJourneyCard /></div>
      <NextMilestoneCard />
      <RecentActivityCard />
    </div>
  );
}

export default function Home() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { ref: portalCardsRef, isInView: portalCardsInView } = useInView();

  // Enter a section directly — sign in as its demo account, then route in.
  const [enrolmentChoiceOpen, setEnrolmentChoiceOpen] = useState(false);
  const [portalWave, setPortalWave] = useState(false);

  // Enter a section directly — sign in as its demo account, then route in.
  const enterWorkspace = (section: WorkspaceSection) => {
    if (section.slug === 'enrolment') {
      setEnrolmentChoiceOpen(true);
      return;
    }
    login(section.email);
    navigate(section.workspacePath);
  };

  const chooseApprenticeshipEnrolment = () => {
    setEnrolmentChoiceOpen(false);
    login('compliance@kbc.test');
    navigate('/users');
  };

  const choosedelivery = () => {
    setEnrolmentChoiceOpen(false);
    login('compliance@kbc.test');
    navigate('/delivery');
  };

  const scrollToWorkspaces = () => {
    // Reset and replay the card wave on every CTA click.
    setPortalWave(false);
    document.getElementById('portal-cards')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.requestAnimationFrame(() => setPortalWave(true));
  };

  return (
    <div className="min-h-screen bg-background-200">
      {/* ============ HERO SECTION ============ */}
      <section className="relative overflow-hidden h-[650px] md:h-[800px]">
        {/* Background image — London skyline with learner dashboard overlays */}
        <div className="absolute inset-0">
          <img
            src="/hero-clean.png"
            alt=""
            className="w-full h-full object-cover object-center"
            style={{ filter: 'brightness(1.08) contrast(1.04) saturate(1.06)' }}
          />
        </div>

        {/* Dark gradient overlays — left-heavy for text readability, right-transparent to show image */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
        <div
          className="pointer-events-none absolute right-[7%] top-[5%] h-[90%] w-[56%]"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.18) 0%, rgba(157,112,255,0.10) 34%, transparent 70%)',
            mixBlendMode: 'screen',
          }}
        />

        {/* Very subtle liquid blobs on top of image */}
        <div
          className="absolute animate-liquid-blob-1 opacity-20"
          style={{
            width: '40%',
            height: '60%',
            left: '-5%',
            top: '-10%',
            background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.35) 0%, oklch(var(--accent-600) / 0.15) 35%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-2 opacity-15"
          style={{
            width: '35%',
            height: '55%',
            right: '-5%',
            top: '-15%',
            background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.3) 0%, oklch(var(--primary-600) / 0.12) 40%, transparent 70%)',
            filter: 'blur(70px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-3 opacity-15"
          style={{
            width: '30%',
            height: '50%',
            right: '20%',
            bottom: '-10%',
            background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.25) 0%, oklch(var(--secondary-500) / 0.1) 40%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />

        <div className="relative z-10 h-full flex flex-col justify-center max-w-6xl mx-auto px-6 lg:pr-[46%]">
          {/* Logo */}
          <BrandLockup size="hero" theme="dark" className="mb-8 animate-hero-scale-in" />

          {/* Main Heading */}
          <h1 className="text-[40px] md:text-[56px] font-heading font-semibold text-white mb-5 tracking-tight leading-[1.1] max-w-2xl animate-hero-fade-in-up delay-200">
            The Complete Learning
            <br />
            <span className="text-gradient-shimmer">Operating System</span>
          </h1>

          {/* Subtitle */}
          <p className="text-[15px] md:text-[16px] text-white/40 max-w-xl leading-relaxed mb-12 animate-hero-fade-in-up-small delay-500">
            One unified platform for learning, evidence, monitoring, coaching, compliance, QA and end-to-end apprenticeship management.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-start gap-4 animate-hero-fade-in-up delay-700">
            <button
              onClick={scrollToWorkspaces}
              className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary-500 text-white text-[14px] font-semibold hover:bg-primary-600 transition-all duration-300 whitespace-nowrap shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 hover:-translate-y-0.5 cursor-pointer"
            >
              <i className="ri-grid-line text-[15px]" />
              Explore your portal
            </button>
          </div>

          {/* Quick trust badges */}
          <div className="flex items-center gap-6 mt-14 text-[11px] text-white/25 flex-wrap animate-hero-fade-in-up-small delay-900">
            <span className="flex items-center gap-1.5">
              <i className="ri-shield-check-line text-primary-300/80" />
              ISO 27001
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-lock-2-line text-primary-300/80" />
              UK GDPR Compliant
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-award-line text-primary-300/80" />
              ESFA Aligned
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-graduation-cap-line text-primary-300/80" />
              Ofsted Ready
            </span>
          </div>
        </div>

        {/* Individual chart cards, kept in the original spaced positions around the learner. */}
        <HeroProgressDesktop />

      </section>

      <section className="bg-[#0b0814] px-4 py-8 lg:hidden">
        <HeroProgressMobile />
      </section>

      {/* ============ STATS BAR ============ */}
      <section className="relative z-10 mt-8 max-w-5xl mx-auto px-6 animate-stats-bar-enter">
        <div className="group cursor-pointer bg-background-50 rounded-2xl border border-foreground-200 shadow-lg shadow-foreground-950/5 p-6 md:p-8 transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.01] hover:border-primary-300/70 hover:shadow-xl hover:shadow-primary-500/10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center mx-auto mb-3">
                <i className="ri-route-line text-accent-600 text-[16px]" />
              </div>
              <CountUpStat end={31} label="Journey Stages" />
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mx-auto mb-3">
                <i className="ri-stack-line text-primary-600 text-[16px]" />
              </div>
              <CountUpStat end={4} label="Phases" />
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mx-auto mb-3">
                <i className="ri-time-line text-secondary-600 text-[16px]" />
              </div>
              <CountUpStat end={12} suffix="-18" label="Months" />
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center mx-auto mb-3">
                <i className="ri-verified-badge-line text-accent-600 text-[16px]" />
              </div>
              <CountUpStat end={100} suffix="%" label="Compliance" />
            </div>
          </div>
        </div>
      </section>

      {/* ============ WORKSPACE LAUNCHER ============ */}
      <section id="portal-section" className="max-w-6xl mx-auto px-6 pt-20 md:pt-24 scroll-mt-6">
        <div className="text-center mb-12 animate-fade-in-up">
          <h2 className="text-[32px] md:text-[40px] font-heading font-semibold text-foreground-900 tracking-tight mb-4">
            Explore your portal
          </h2>
        </div>

        <div
          id="portal-cards"
          ref={portalCardsRef}
          className={`portal-cards-grid scroll-mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 ${portalCardsInView ? 'is-visible' : ''} ${portalWave ? 'portal-wave' : ''}`}
        >
          {WORKSPACE_SECTIONS.map((section) => (
            <button
              key={section.slug}
              onClick={() => enterWorkspace(section)}
              aria-label={`Open ${section.label} portal`}
              className={`portal-card group relative flex flex-col items-center text-center gap-3 rounded-2xl border p-5 transition-all duration-300 ease-out hover:-translate-y-2 hover:scale-[1.03] hover:shadow-xl hover:shadow-primary-500/15 hover:border-primary-300 cursor-pointer card-premium ${
                section.highlighted
                  ? 'bg-primary-50/60 border-primary-300/70 ring-1 ring-primary-300/50 shadow-lg shadow-primary-500/10 hover:border-primary-400 hover:shadow-primary-500/20'
                  : 'bg-background-50 border-foreground-200 hover:border-primary-300/70 hover:shadow-lg hover:shadow-primary-500/5'
              }`}
            >
              {section.highlighted && (
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[9px] font-semibold text-primary-700 bg-primary-100 border border-primary-300/50 px-1.5 py-0.5 rounded-full">
                  <i className="ri-star-fill text-[8px]" />
                  Available
                </span>
              )}
              <span className={`portal-card-icon w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                section.highlighted
                  ? 'bg-primary-100 border-primary-300/50 group-hover:bg-primary-200'
                  : 'bg-primary-50 border-primary-200/40 group-hover:bg-primary-100'
              }`}>
                <i className={`${section.icon} text-[20px] ${section.highlighted ? 'text-primary-700' : 'text-primary-600'}`} />
              </span>
              <span className={`text-[13px] font-heading font-semibold ${section.highlighted ? 'text-primary-900' : 'text-foreground-800'}`}>{section.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ============ FEATURES GRID ============ */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="text-center mb-14 animate-fade-in-up">
          <h2 className="text-[32px] md:text-[40px] font-heading font-semibold text-foreground-900 tracking-tight mb-4">
            Designed for every learner journey
          </h2>
          <p className="text-[15px] text-foreground-400 max-w-lg mx-auto leading-relaxed">
            A unified ecosystem designed for learners, coaches, employers, compliance officers, and administrators.
          </p>
        </div>

        <div className="feature-cards-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-section">
          {/* Feature 1 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/40 flex items-center justify-center mb-5 group-hover:bg-emerald-100 transition-colors duration-300">
              <i className="ri-shield-check-line text-emerald-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Pre-Active Compliance</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              End-to-end onboarding with eligibility, assessment, RPL, compliance packs, and digital signatures.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mb-5 group-hover:bg-primary-100 transition-colors duration-300">
              <i className="ri-lightbulb-line text-primary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Active Learning</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Module-based curriculum, evidence portfolios, KSB tracking, OTJH monitoring, and progress reviews.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mb-5 group-hover:bg-secondary-100 transition-colors duration-300">
              <i className="ri-checkbox-circle-line text-secondary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Gateway Readiness</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Mock assessments, employer sign-off, QA gateway reviews, and EPA readiness verification.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mb-5 group-hover:bg-primary-100 transition-colors duration-300">
              <i className="ri-trophy-line text-primary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">End Point Assessment</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              EPA registration, preparation, assessment scheduling, and results management with full audit trails.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200/40 flex items-center justify-center mb-5 group-hover:bg-indigo-100 transition-colors duration-300">
              <i className="ri-sparkling-2-line text-indigo-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">AI-Powered Tools</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Smart marking, evidence validation, risk prediction, automated reporting, and intelligent coaching insights.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mb-5 group-hover:bg-secondary-100 transition-colors duration-300">
              <i className="ri-line-chart-line text-secondary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Real-Time Analytics</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Live dashboards, engagement metrics, compliance tracking, and leadership-ready reporting for every role.
            </p>
          </div>
        </div>
      </section>


      {/* ============ FOOTER ============ */}
      <footer className="border-t border-foreground-200 bg-background-100">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <BrandLockup size="compact" />
            <div className="flex items-center gap-6 text-[11px] text-foreground-400 flex-wrap justify-center">
              <span className="flex items-center gap-1.5">
                <i className="ri-shield-check-line text-primary-500" />
                ISO 27001
              </span>
              <span className="flex items-center gap-1.5">
                <i className="ri-lock-2-line text-primary-500" />
                UK GDPR
              </span>
              <span className="flex items-center gap-1.5">
                <i className="ri-award-line text-primary-500" />
                ESFA Aligned
              </span>
              <span className="flex items-center gap-1.5">
                <i className="ri-graduation-cap-line text-primary-500" />
                Ofsted Ready
              </span>
            </div>
            <p className="text-[11px] text-foreground-300">
              v1.0 &middot; 2026
            </p>
          </div>
        </div>
      </footer>

      {/* ============ ENROLMENT TYPE CHOICE MODAL ============ */}
      {enrolmentChoiceOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEnrolmentChoiceOpen(false)} aria-hidden="true" />
          <div className="relative w-full max-w-lg bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-[16px] font-heading font-semibold text-foreground-900">Choose enrolment type</h2>
                <p className="text-[13px] text-foreground-400 mt-1">Select the pathway you'd like to enrol into.</p>
              </div>
              <button
                onClick={() => setEnrolmentChoiceOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 hover:text-foreground-700 transition-smooth cursor-pointer shrink-0"
              >
                <i className="ri-close-line text-[18px]" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={chooseApprenticeshipEnrolment}
                className="group flex flex-col items-start text-left gap-3 rounded-2xl border border-foreground-200 p-5 hover:border-primary-300/70 hover:shadow-lg hover:shadow-primary-500/5 transition-all duration-300 cursor-pointer"
              >
                <span className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center group-hover:bg-primary-100 transition-colors duration-300">
                  <i className="ri-graduation-cap-line text-primary-600 text-[18px]" />
                </span>
                <span className="text-[14px] font-heading font-semibold text-foreground-900">Onboarding</span>
                <span className="text-[12px] text-foreground-400 leading-relaxed">Full apprenticeship journey — users, wizard and compliance board.</span>
              </button>
              <button
                onClick={choosedelivery}
                className="group flex flex-col items-start text-left gap-3 rounded-2xl border border-emerald-200/70 p-5 bg-emerald-50/35 hover:border-emerald-300 hover:bg-emerald-50/70 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-300 cursor-pointer"
              >
                <span className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-center justify-center group-hover:bg-emerald-100 transition-colors duration-300">
                  <i className="ri-briefcase-4-line text-emerald-600 text-[18px]" />
                </span>
                <span className="text-[14px] font-heading font-semibold text-foreground-900">Delivery</span>
                <span className="text-[12px] text-foreground-400 leading-relaxed">Enrol a commercial learner with their programme details.</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
