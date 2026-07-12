import { useCountUp, useInView } from '@/hooks/useCountUp';
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
  { slug: 'learner', label: 'Learner', icon: 'ri-user-line', email: 'learner@kbc.test', workspacePath: '/workspace/learner', highlighted: true },
  { slug: 'coach', label: 'Coach', icon: 'ri-user-heart-line', email: 'coach@kbc.test', workspacePath: '/workspace/coach', highlighted: true },
  { slug: 'tutor', label: 'Tutor', icon: 'ri-presentation-line', email: 'tutor@kbc.test', workspacePath: '/workspace/tutor' },
  { slug: 'employer', label: 'Employer', icon: 'ri-building-2-line', email: 'employer@kbc.test', workspacePath: '/workspace/employer' },
  { slug: 'enrolment', label: 'Enrolment', icon: 'ri-user-add-line', email: 'compliance@kbc.test', workspacePath: '/users', highlighted: true },
  { slug: 'qa', label: 'QA Officer', icon: 'ri-search-eye-line', email: 'qa@kbc.test', workspacePath: '/workspace/qa' },
  { slug: 'mis', label: 'MIS User', icon: 'ri-database-2-line', email: 'mis@kbc.test', workspacePath: '/workspace/mis' },
  { slug: 'curriculum', label: 'Curriculum', icon: 'ri-book-2-line', email: 'tutor@kbc.test', workspacePath: '/workspace/curriculum', highlighted: true },
  { slug: 'engagement', label: 'Engagement', icon: 'ri-megaphone-line', email: 'compliance@kbc.test', workspacePath: '/workspace/engagement' },
  { slug: 'leadership', label: 'Leadership', icon: 'ri-vip-crown-line', email: 'leadership@kbc.test', workspacePath: '/workspace/leadership' },
  { slug: 'admin', label: 'Admin', icon: 'ri-settings-3-line', email: 'admin@kbc.test', workspacePath: '/workspace/admin', highlighted: true },
  { slug: 'finance', label: 'Finance', icon: 'ri-money-pound-circle-line', email: 'finance@kbc.test', workspacePath: '/workspace/finance' },
  { slug: 'auditor', label: 'Auditor', icon: 'ri-history-line', email: 'auditor@kbc.test', workspacePath: '/workspace/auditor' },
  { slug: 'support', label: 'Support', icon: 'ri-customer-service-2-line', email: 'admin@kbc.test', workspacePath: '/workspace/support' },
  { slug: 'safeguarding', label: 'Safeguarding', icon: 'ri-shield-line', email: 'compliance@kbc.test', workspacePath: '/workspace/safeguarding' },
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
  const { login } = useAuth();
  const navigate = useNavigate();
  const [enrolmentChoiceOpen, setEnrolmentChoiceOpen] = useState(false);

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
    document.getElementById('workspaces')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background-200">
      {/* ============ HERO SECTION ============ */}
      <section className="relative overflow-hidden h-[650px] md:h-[800px]">
        {/* Background image — London skyline with learner dashboard overlays */}
        <div className="absolute inset-0">
          <img
            src="https://storage.readdy-site.link/project_files/618bc44b-5728-4a0b-8f4f-ee80cff7baf6/468c7b89-7ca3-4a2e-a544-794459931883_ChatGPT-Image-Jun-12-2026-11_08_18-PM.png"
            alt=""
            className="w-full h-full object-cover object-center"
          />
        </div>

        {/* Dark gradient overlays — left-heavy for text readability, right-transparent to show image */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

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

        <div className="relative z-10 h-full flex flex-col justify-center max-w-6xl mx-auto px-6">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8 animate-hero-scale-in">
            <div className="w-14 h-14 rounded-2xl gold-shimmer flex items-center justify-center shadow-lg shadow-accent-500/10 animate-hero-border-glow">
              <span className="text-foreground-950 font-bold text-2xl font-heading">K</span>
            </div>
            <div className="text-left animate-hero-fade-in-up-small delay-100">
              <p className="text-[15px] font-heading font-semibold text-white tracking-tight">KBC LearningOS</p>
              <p className="text-[10px] text-white/30 tracking-[0.2em] uppercase font-medium">UK Apprenticeship Platform</p>
            </div>
          </div>

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
              Choose your workspace
            </button>
            <a
              href="/onboarding"
              className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl border border-white/10 text-white/80 text-[14px] font-medium hover:bg-white/5 hover:border-white/20 transition-all duration-300 whitespace-nowrap hover:-translate-y-0.5"
            >
              <i className="ri-map-2-line text-[15px] text-accent-400" />
              View Learner Journey
            </a>
          </div>

          {/* Quick trust badges */}
          <div className="flex items-center gap-6 mt-14 text-[11px] text-white/25 flex-wrap animate-hero-fade-in-up-small delay-900">
            <span className="flex items-center gap-1.5">
              <i className="ri-shield-check-line text-accent-500/60" />
              ISO 27001
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-lock-2-line text-accent-500/60" />
              UK GDPR Compliant
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-award-line text-accent-500/60" />
              ESFA Aligned
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-graduation-cap-line text-accent-500/60" />
              Ofsted Ready
            </span>
          </div>
        </div>
      </section>

      {/* ============ STATS BAR ============ */}
      <section className="relative z-10 -mt-10 max-w-5xl mx-auto px-6 animate-stats-bar-enter">
        <div className="bg-background-50 rounded-2xl border border-foreground-200 shadow-lg shadow-foreground-950/5 p-6 md:p-8">
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
      <section id="workspaces" className="max-w-6xl mx-auto px-6 pt-20 md:pt-24 scroll-mt-6">
        <div className="text-center mb-12 animate-fade-in-up">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-full border border-primary-200/40 mb-5">
            <i className="ri-grid-line text-[10px]" />
            Workspaces
          </span>
          <h2 className="text-[32px] md:text-[40px] font-heading font-semibold text-foreground-900 tracking-tight mb-4">
            Choose a workspace
          </h2>
          <p className="text-[15px] text-foreground-400 max-w-lg mx-auto leading-relaxed">
            Jump straight into any section — no sign-in required.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 stagger-section">
          {WORKSPACE_SECTIONS.map((section) => (
            <button
              key={section.slug}
              onClick={() => enterWorkspace(section)}
              className={`group relative flex flex-col items-center text-center gap-3 rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-0.5 cursor-pointer card-premium ${
                section.highlighted
                  ? 'bg-accent-50/60 border-accent-300/70 ring-1 ring-accent-300/50 shadow-lg shadow-accent-500/10 hover:border-accent-400 hover:shadow-accent-500/20'
                  : 'bg-background-50 border-foreground-200 hover:border-primary-300/70 hover:shadow-lg hover:shadow-primary-500/5'
              }`}
            >
              {section.highlighted && (
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[9px] font-semibold text-accent-700 bg-accent-100 border border-accent-300/50 px-1.5 py-0.5 rounded-full">
                  <i className="ri-star-fill text-[8px]" />
                  Featured
                </span>
              )}
              <span className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-colors duration-300 ${
                section.highlighted
                  ? 'bg-accent-100 border-accent-300/50 group-hover:bg-accent-200'
                  : 'bg-primary-50 border-primary-200/40 group-hover:bg-primary-100'
              }`}>
                <i className={`${section.icon} text-[20px] ${section.highlighted ? 'text-accent-700' : 'text-primary-600'}`} />
              </span>
              <span className={`text-[13px] font-heading font-semibold ${section.highlighted ? 'text-accent-900' : 'text-foreground-800'}`}>{section.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ============ FEATURES GRID ============ */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <div className="text-center mb-14 animate-fade-in-up">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-full border border-primary-200/40 mb-5">
            <i className="ri-sparkling-2-line text-[10px]" />
            Platform Overview
          </span>
          <h2 className="text-[32px] md:text-[40px] font-heading font-semibold text-foreground-900 tracking-tight mb-4">
            Built for every stakeholder
          </h2>
          <p className="text-[15px] text-foreground-400 max-w-lg mx-auto leading-relaxed">
            A unified ecosystem designed for learners, coaches, employers, compliance officers, and administrators.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-section">
          {/* Feature 1 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center mb-5 group-hover:bg-accent-100 transition-colors duration-300">
              <i className="ri-user-follow-line text-accent-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Pre-Active Compliance</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              End-to-end onboarding with eligibility, assessment, RPL, compliance packs, and digital signatures.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mb-5 group-hover:bg-primary-100 transition-colors duration-300">
              <i className="ri-book-open-line text-primary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Active Learning</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Module-based curriculum, evidence portfolios, KSB tracking, OTJH monitoring, and progress reviews.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mb-5 group-hover:bg-secondary-100 transition-colors duration-300">
              <i className="ri-door-open-line text-secondary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Gateway Readiness</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Mock assessments, employer sign-off, QA gateway reviews, and EPA readiness verification.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mb-5 group-hover:bg-primary-100 transition-colors duration-300">
              <i className="ri-award-line text-primary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">End Point Assessment</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              EPA registration, preparation, assessment scheduling, and results management with full audit trails.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center mb-5 group-hover:bg-accent-100 transition-colors duration-300">
              <i className="ri-robot-2-line text-accent-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">AI-Powered Tools</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Smart marking, evidence validation, risk prediction, automated reporting, and intelligent coaching insights.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="group bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5 card-premium">
            <div className="w-11 h-11 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mb-5 group-hover:bg-secondary-100 transition-colors duration-300">
              <i className="ri-bar-chart-box-line text-secondary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">Real-Time Analytics</h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Live dashboards, engagement metrics, compliance tracking, and leadership-ready reporting for every role.
            </p>
          </div>
        </div>
      </section>

      {/* ============ JOURNEY PREVIEW CTA ============ */}
      <section className="max-w-6xl mx-auto px-6 pb-20 md:pb-24 animate-fade-in-up">
        <div
          className="relative overflow-hidden rounded-3xl p-10 md:p-16 text-center"
          style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
        >
          {/* Liquid blob decorations — same style as sidebar */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div
              className="absolute animate-liquid-blob-1 opacity-30"
              style={{
                width: '80%',
                height: '35%',
                left: '-20%',
                top: '-5%',
                background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.35) 0%, oklch(var(--accent-600) / 0.12) 40%, transparent 70%)',
                filter: 'blur(45px)',
              }}
            />
            <div
              className="absolute animate-liquid-blob-2 opacity-20"
              style={{
                width: '70%',
                height: '30%',
                right: '-15%',
                bottom: '25%',
                background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.3) 0%, oklch(var(--primary-600) / 0.1) 40%, transparent 70%)',
                filter: 'blur(50px)',
              }}
            />
            <div
              className="absolute animate-liquid-blob-3 opacity-15"
              style={{
                width: '60%',
                height: '25%',
                left: '5%',
                bottom: '-5%',
                background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.25) 0%, oklch(var(--secondary-500) / 0.08) 40%, transparent 70%)',
                filter: 'blur(55px)',
              }}
            />
          </div>

          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-6 animate-gentle-float">
              <div className="w-12 h-12 rounded-2xl bg-accent-500 flex items-center justify-center shadow-lg shadow-accent-500/20">
                <i className="ri-map-2-line text-xl text-foreground-950" />
              </div>
            </div>
            <h2 className="text-[28px] md:text-[36px] font-heading font-semibold text-white mb-4 tracking-tight">
              Explore the complete learner journey
            </h2>
            <p className="text-[15px] text-white/40 max-w-md mx-auto leading-relaxed mb-10">
              From induction to EPA results — 31 stages, 4 phases, and 12-18 months of guided apprenticeship excellence.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="/onboarding"
                className="inline-flex items-center gap-2 px-7 py-3 rounded-xl bg-accent-500 text-foreground-950 text-[14px] font-semibold hover:bg-accent-400 transition-all duration-300 whitespace-nowrap shadow-lg shadow-accent-500/20 hover:shadow-accent-500/30 hover:-translate-y-0.5"
              >
                <i className="ri-compass-3-line text-[15px]" />
                View the Roadmap
              </a>
              <button
                onClick={scrollToWorkspaces}
                className="inline-flex items-center gap-2 px-7 py-3 rounded-xl border border-white/10 text-white/60 text-[14px] font-medium hover:bg-white/5 hover:text-white/80 hover:border-white/20 transition-all duration-300 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-grid-line text-[15px]" />
                Choose a workspace
              </button>
            </div>

            {/* Phase dots preview */}
            <div className="flex items-center justify-center gap-3 mt-12">
              <div className="flex items-center gap-2 text-[11px] text-white/25">
                <div className="w-2 h-2 rounded-full bg-accent-500" />
                <span>Pre-Active</span>
              </div>
              <div className="w-4 h-px bg-white/10" />
              <div className="flex items-center gap-2 text-[11px] text-white/25">
                <div className="w-2 h-2 rounded-full bg-primary-400" />
                <span>Active</span>
              </div>
              <div className="w-4 h-px bg-white/10" />
              <div className="flex items-center gap-2 text-[11px] text-white/25">
                <div className="w-2 h-2 rounded-full bg-secondary-400" />
                <span>Gateway</span>
              </div>
              <div className="w-4 h-px bg-white/10" />
              <div className="flex items-center gap-2 text-[11px] text-white/25">
                <div className="w-2 h-2 rounded-full bg-accent-400" />
                <span>EPA</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-foreground-200 bg-background-100">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl gold-shimmer flex items-center justify-center">
                <span className="text-foreground-950 font-bold text-base font-heading">K</span>
              </div>
              <div>
                <p className="text-[13px] font-heading font-semibold text-foreground-900">KBC LearningOS</p>
                <p className="text-[10px] text-foreground-400">Kent Business College</p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-[11px] text-foreground-400 flex-wrap justify-center">
              <span className="flex items-center gap-1.5">
                <i className="ri-shield-check-line text-accent-500" />
                ISO 27001
              </span>
              <span className="flex items-center gap-1.5">
                <i className="ri-lock-2-line text-accent-500" />
                UK GDPR
              </span>
              <span className="flex items-center gap-1.5">
                <i className="ri-award-line text-accent-500" />
                ESFA Aligned
              </span>
              <span className="flex items-center gap-1.5">
                <i className="ri-graduation-cap-line text-accent-500" />
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
                className="group flex flex-col items-start text-left gap-3 rounded-2xl border border-foreground-200 p-5 hover:border-accent-300/70 hover:shadow-lg hover:shadow-accent-500/5 transition-all duration-300 cursor-pointer"
              >
                <span className="w-11 h-11 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center group-hover:bg-accent-100 transition-colors duration-300">
                  <i className="ri-briefcase-4-line text-accent-600 text-[18px]" />
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