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
  { slug: 'audit-copy', label: 'AUDIT', icon: 'ri-file-search-line', email: 'auditor@kbc.test', workspacePath: '/workspace/auditor-copy', highlighted: true },
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

export default function Home() {
  const { previewAs } = useAuth();
  const navigate = useNavigate();
  const { ref: portalCardsRef, isInView: portalCardsInView } = useInView();

  // Enter a section directly — sign in as its demo account, then route in.
  const [enrolmentChoiceOpen, setEnrolmentChoiceOpen] = useState(false);
  const [portalWave, setPortalWave] = useState(false);

  // Enter a section directly — sign in as its demo account, then route in.
  const enterWorkspace = (section: WorkspaceSection) => {
    previewAs(section.email);
    navigate(section.workspacePath);
  };

  // Enrolment-type choices from the modal — both sign in as the compliance
  // demo account (the enrolment section's account) before routing in.
  const chooseApprenticeshipEnrolment = () => {
    setEnrolmentChoiceOpen(false);
    previewAs('compliance@kbc.test');
    navigate('/users');
  };

  const choosedelivery = () => {
    setEnrolmentChoiceOpen(false);
    previewAs('compliance@kbc.test');
    navigate('/users');
  };

  const scrollToWorkspaces = () => {
    // Reset and replay the card wave on every CTA click.
    setPortalWave(false);
    document.getElementById('portal-cards')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.requestAnimationFrame(() => setPortalWave(true));
  };

  return (
    <div className="public-home min-h-screen bg-background-200">
      {/* ============ HERO SECTION ============ */}
      <section className="relative min-h-[680px] overflow-hidden sm:min-h-[700px] xl:h-[clamp(700px,100svh,840px)]">
        {/* Background image — London skyline with learner dashboard overlays */}
        <div className="absolute inset-0">
          <img
            src="/hero-clean.png"
            alt=""
            className="h-full w-full object-cover object-[62%_center] sm:object-[58%_center] xl:object-center"
            style={{ filter: 'brightness(1.08) contrast(1.04) saturate(1.06)' }}
          />
        </div>

        {/* Dark gradient overlays — left-heavy for text readability, right-transparent to show image */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/5 xl:from-black/85 xl:via-black/30 xl:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
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

        <div className="relative z-10 mx-auto flex h-full w-full max-w-[1920px] items-center px-6 sm:px-10 lg:px-[6vw]">
          <div className="w-full max-w-[620px] xl:w-[40%] xl:max-w-[650px]">
            {/* Logo */}
            <BrandLockup size="hero" theme="dark" className="mb-6 animate-hero-scale-in sm:mb-8" />

            {/* Main Heading */}
            <h1 className="mb-5 max-w-[650px] font-heading text-[clamp(42px,4vw,64px)] font-semibold leading-[1.04] tracking-[-0.04em] text-white animate-hero-fade-in-up delay-200">
              The Complete Learning
              <br />
              <span className="text-gradient-shimmer">Operating System</span>
            </h1>

            {/* Subtitle */}
            <p className="mb-9 max-w-[560px] text-[15px] leading-7 text-white/65 animate-hero-fade-in-up-small delay-500 sm:text-[16px] xl:mb-10">
              One unified platform for learning, evidence, monitoring, coaching, compliance, QA and end-to-end apprenticeship management.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col items-start gap-4 animate-hero-fade-in-up delay-700 sm:flex-row">
              <button
                onClick={scrollToWorkspaces}
                className="group inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl bg-primary-500 px-8 py-3.5 text-[14px] font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-600 hover:shadow-primary-500/30"
              >
                <AppIcon className="ri-grid-line text-[15px]" />
                Explore your portal
              </button>
            </div>

            {/* Quick trust badges */}
            <div className="mt-10 flex max-w-[590px] flex-wrap items-center gap-x-5 gap-y-3 text-[11px] text-white/45 animate-hero-fade-in-up-small delay-900 xl:mt-12">
              <span className="flex items-center gap-1.5">
                <AppIcon className="ri-shield-check-line text-primary-300/80" />
                ISO 27001
              </span>
              <span className="flex items-center gap-1.5">
                <AppIcon className="ri-lock-2-line text-primary-300/80" />
                UK GDPR Compliant
              </span>
              <span className="flex items-center gap-1.5">
                <AppIcon className="ri-award-line text-primary-300/80" />
                ESFA Aligned
              </span>
              <span className="flex items-center gap-1.5">
                <AppIcon className="ri-graduation-cap-line text-primary-300/80" />
                Ofsted Ready
              </span>
            </div>
          </div>
        </div>

      </section>

      {/* ============ STATS BAR ============ */}
      <section className="relative z-20 -mt-20 mx-auto max-w-5xl px-6 animate-stats-bar-enter sm:-mt-24">
        <div className="group cursor-pointer bg-background-50 rounded-2xl border border-foreground-200 shadow-lg shadow-foreground-950/5 p-6 md:p-8 transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.01] hover:border-primary-300/70 hover:shadow-xl hover:shadow-primary-500/10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center mx-auto mb-3">
                <AppIcon className="ri-route-line text-accent-600 text-[16px]" />
              </div>
              <CountUpStat end={31} label="Journey Stages" />
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mx-auto mb-3">
                <AppIcon className="ri-stack-line text-primary-600 text-[16px]" />
              </div>
              <CountUpStat end={4} label="Phases" />
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mx-auto mb-3">
                <AppIcon className="ri-time-line text-secondary-600 text-[16px]" />
              </div>
              <CountUpStat end={12} suffix="-18" label="Months" />
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center mx-auto mb-3">
                <AppIcon className="ri-verified-badge-line text-accent-600 text-[16px]" />
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
                  <AppIcon className="ri-star-fill text-[8px]" />
                  Available
                </span>
              )}
              <span className={`portal-card-icon w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                section.highlighted
                  ? 'bg-primary-100 border-primary-300/50 group-hover:bg-primary-200'
                  : 'bg-primary-50 border-primary-200/40 group-hover:bg-primary-100'
              }`}>
                <AppIcon className={`${section.icon} text-[20px] ${section.highlighted ? 'text-primary-700' : 'text-primary-600'}`} />
              </span>
              <span className={`text-[13px] font-heading font-semibold ${section.highlighted ? 'text-primary-900' : 'text-foreground-800'}`}>{section.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ============ FEATURES GRID ============ */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="public-home-section-heading text-center mb-14 animate-fade-in-up">
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
              <AppIcon className="ri-shield-check-line text-emerald-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Pre-Active Compliance</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              End-to-end onboarding with eligibility, assessment, RPL, compliance packs, and digital signatures.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mb-5 group-hover:bg-primary-100 transition-colors duration-300">
              <AppIcon className="ri-lightbulb-line text-primary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Active Learning</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Module-based curriculum, evidence portfolios, KSB tracking, OTJH monitoring, and progress reviews.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mb-5 group-hover:bg-secondary-100 transition-colors duration-300">
              <AppIcon className="ri-checkbox-circle-line text-secondary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Gateway Readiness</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Mock assessments, employer sign-off, QA gateway reviews, and EPA readiness verification.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mb-5 group-hover:bg-primary-100 transition-colors duration-300">
              <AppIcon className="ri-trophy-line text-primary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">End Point Assessment</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              EPA registration, preparation, assessment scheduling, and results management with full audit trails.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200/40 flex items-center justify-center mb-5 group-hover:bg-indigo-100 transition-colors duration-300">
              <AppIcon className="ri-sparkling-2-line text-indigo-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">AI-Powered Tools</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Smart marking, evidence validation, risk prediction, automated reporting, and intelligent coaching insights.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mb-5 group-hover:bg-secondary-100 transition-colors duration-300">
              <AppIcon className="ri-line-chart-line text-secondary-600 text-[18px]" />
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
                <AppIcon className="ri-shield-check-line text-primary-500" />
                ISO 27001
              </span>
              <span className="flex items-center gap-1.5">
                <AppIcon className="ri-lock-2-line text-primary-500" />
                UK GDPR
              </span>
              <span className="flex items-center gap-1.5">
                <AppIcon className="ri-award-line text-primary-500" />
                ESFA Aligned
              </span>
              <span className="flex items-center gap-1.5">
                <AppIcon className="ri-graduation-cap-line text-primary-500" />
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
                <AppIcon className="ri-close-line text-[18px]" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={chooseApprenticeshipEnrolment}
                className="group flex flex-col items-start text-left gap-3 rounded-2xl border border-foreground-200 p-5 hover:border-primary-300/70 hover:shadow-lg hover:shadow-primary-500/5 transition-all duration-300 cursor-pointer"
              >
                <span className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center group-hover:bg-primary-100 transition-colors duration-300">
                  <AppIcon className="ri-graduation-cap-line text-primary-600 text-[18px]" />
                </span>
                <span className="text-[14px] font-heading font-semibold text-foreground-900">Onboarding</span>
                <span className="text-[12px] text-foreground-400 leading-relaxed">Full apprenticeship journey — users, wizard and compliance board.</span>
              </button>
              <button
                onClick={choosedelivery}
                className="group flex flex-col items-start text-left gap-3 rounded-2xl border border-emerald-200/70 p-5 bg-emerald-50/35 hover:border-emerald-300 hover:bg-emerald-50/70 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-300 cursor-pointer"
              >
                <span className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-center justify-center group-hover:bg-emerald-100 transition-colors duration-300">
                  <AppIcon className="ri-briefcase-4-line text-emerald-600 text-[18px]" />
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
