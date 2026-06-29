import { useEffect, useRef, useState } from 'react';
import { journeyStages, totalSteps } from './data';
import StageCard from './components/StageCard';

const dotColorMap = {
  accent: 'bg-accent-500',
  primary: 'bg-primary-500',
  secondary: 'bg-secondary-500',
};

export default function OnboardingPage() {
  const [visibleCards, setVisibleCards] = useState<Set<number>>(new Set());
  const [activeStage, setActiveStage] = useState(-1);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiFired, setConfettiFired] = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiFrameRef = useRef<number>(0);

  // Intersection Observer for scroll animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute('data-index'));
            setVisibleCards((prev) => new Set(prev).add(idx));
            setActiveStage(idx);
            if (idx === journeyStages.length - 1 && !confettiFired) {
              setShowConfetti(true);
              setConfettiFired(true);
            }
          }
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -80px 0px' },
    );

    cardRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [confettiFired]);

  // Confetti effect
  useEffect(() => {
    if (!showConfetti) return;
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      size: number;
      rotation: number;
      rotationSpeed: number;
      shape: 'rect' | 'circle';
      opacity: number;
      gravity: number;
    }> = [];

    const colorKeys = [
      '--accent-500',
      '--primary-500',
      '--secondary-500',
      '--accent-600',
      '--primary-600',
    ];
    const cs = getComputedStyle(document.documentElement);

    for (let i = 0; i < 180; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 2 + Math.random() * 9;
      particles.push({
        x: canvas.width / 2,
        y: canvas.height - 80,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 5,
        color: cs
          .getPropertyValue(colorKeys[Math.floor(Math.random() * colorKeys.length)])
          .trim(),
        size: 3 + Math.random() * 7,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
        opacity: 1,
        gravity: 0.12 + Math.random() * 0.1,
      });
    }

    const animate = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width;
      canvas.height = r.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = 0;
      particles.forEach((p) => {
        if (p.opacity <= 0) return;
        alive++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.98;
        p.rotation += p.rotationSpeed;
        p.opacity -= 0.007;

        if (p.opacity <= 0) return;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = `oklch(${p.color})`;
        if (p.shape === 'rect')
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      if (alive > 0)
        confettiFrameRef.current = requestAnimationFrame(animate);
      else setShowConfetti(false);
    };

    confettiFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(confettiFrameRef.current);
  }, [showConfetti]);

  return (
    <div className="min-h-screen bg-background-50">
      {/* ============ HERO ============ */}
      <section
        className="relative overflow-hidden"
        style={{
          background:
            'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)',
        }}
      >
        {/* Liquid blobs */}
        <div
          className="absolute animate-liquid-blob-1 opacity-30"
          style={{
            width: '45%',
            height: '60%',
            left: '-5%',
            top: '-10%',
            background:
              'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.5) 0%, oklch(var(--accent-600) / 0.2) 35%, transparent 70%)',
            filter: 'blur(55px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-2 opacity-25"
          style={{
            width: '40%',
            height: '55%',
            right: '-8%',
            top: '-12%',
            background:
              'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.45) 0%, oklch(var(--primary-600) / 0.18) 40%, transparent 70%)',
            filter: 'blur(65px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-3 opacity-20"
          style={{
            width: '35%',
            height: '50%',
            right: '25%',
            top: '15%',
            background:
              'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.35) 0%, oklch(var(--secondary-500) / 0.12) 40%, transparent 70%)',
            filter: 'blur(70px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-4 animate-blob-opacity-pulse"
          style={{
            width: '50%',
            height: '45%',
            left: '10%',
            bottom: '-12%',
            background:
              'radial-gradient(ellipse at center, oklch(var(--accent-300) / 0.35) 0%, oklch(var(--accent-400) / 0.15) 30%, oklch(var(--primary-300) / 0.08) 55%, transparent 75%)',
            filter: 'blur(60px)',
          }}
        />

        <div className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-24 text-center">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl gold-shimmer flex items-center justify-center shadow-lg shadow-accent-500/15">
              <span className="text-foreground-950 font-bold text-xl font-heading">
                K
              </span>
            </div>
            <div className="text-left">
              <p className="text-[14px] font-heading font-semibold text-white tracking-tight">
                KBC LearningOS
              </p>
              <p className="text-[10px] text-white/25 tracking-[0.2em] uppercase">
                Full Learner Journey
              </p>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-[40px] md:text-[56px] font-heading font-semibold text-white mb-5 leading-[1.1] tracking-tight">
            Your Apprenticeship
            <br />
            <span className="text-accent-400">Journey Starts Here</span>
          </h1>

          {/* Subtitle */}
          <p className="text-[15px] md:text-[16px] text-white/40 max-w-xl mx-auto leading-relaxed mb-10">
            From your first day to your EPA — a guided, supported, and inspiring
            path to your professional qualification. 12–18 months of structured
            learning with a dedicated coach at your side.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/login"
              className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary-500 text-white text-[14px] font-semibold hover:bg-primary-600 transition-all duration-300 whitespace-nowrap shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 hover:-translate-y-0.5"
            >
              <i className="ri-rocket-line text-[15px]" />
              Start Your Journey
            </a>
            <a
              href="#journey"
              className="group inline-flex items-center gap-2 px-8 py-3.5 rounded-xl border border-white/10 text-white/80 text-[14px] font-medium hover:bg-white/5 hover:border-white/20 transition-all duration-300 whitespace-nowrap hover:-translate-y-0.5"
            >
              <i className="ri-arrow-down-line text-[15px] text-accent-400" />
              Explore the Stages
            </a>
          </div>

          {/* Quick stats */}
          <div className="flex items-center justify-center gap-6 mt-10 text-[12px] text-white/25 flex-wrap">
            <span className="flex items-center gap-1.5">
              <i className="ri-time-line text-accent-500/60" />
              12–18 months
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-route-line text-accent-500/60" />
              4 major stages
            </span>
            <span className="w-1 h-1 rounded-full bg-white/10" />
            <span className="flex items-center gap-1.5">
              <i className="ri-user-star-line text-accent-500/60" />
              Dedicated coach
            </span>
          </div>

          {/* Phase badges */}
          <div className="flex items-center justify-center gap-4 mt-12 flex-wrap">
            {journeyStages.map((stage, idx) => (
              <div key={stage.number} className="flex items-center gap-2">
                {idx > 0 && (
                  <div className="w-4 h-px bg-white/10 mr-2 hidden md:block" />
                )}
                <div className={`w-2 h-2 rounded-full ${dotColorMap[stage.color]}`} />
                <span className="text-[11px] text-white/40">
                  {stage.title}
                </span>
              </div>
            ))}
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 text-white/20 text-[12px]">
            <span>Scroll to explore</span>
            <i className="ri-arrow-down-line animate-bounce" />
          </div>
        </div>
      </section>

      {/* ============ JOURNEY INTRO ============ */}
      <section
        id="journey"
        className="max-w-4xl mx-auto px-6 py-16 md:py-20 text-center"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 bg-primary-50 px-3 py-1.5 rounded-full border border-primary-200/40 mb-5">
          <i className="ri-route-line text-[10px]" />
          {journeyStages.length} Stages, {totalSteps} Steps, 12–18 Months
        </span>
        <h2 className="text-[28px] md:text-[36px] font-heading font-semibold text-foreground-900 tracking-tight mb-4">
          A clear path to your qualification
        </h2>
        <p className="text-[15px] text-foreground-400 max-w-lg mx-auto leading-relaxed">
          We have structured your apprenticeship into four major stages. Each stage
          builds on the last, with dedicated support at every step.
        </p>
      </section>

      {/* ============ TIMELINE ============ */}
      <section className="max-w-4xl mx-auto px-6 pb-16 md:pb-24">
        <div className="space-y-8 md:space-y-12">
          {journeyStages.map((stage, idx) => (
            <div
              key={stage.number}
              ref={(el) => {
                cardRefs.current[idx] = el;
              }}
              data-index={idx}
            >
              <StageCard
                stage={stage}
                isLast={idx === journeyStages.length - 1}
                isVisible={visibleCards.has(idx)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ============ SUPPORT SECTION ============ */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-20">
        <div className="text-center mb-12">
          <h2 className="text-[28px] md:text-[32px] font-heading font-semibold text-foreground-900 tracking-tight mb-3">
            You are supported every step
          </h2>
          <p className="text-[15px] text-foreground-400 max-w-md mx-auto">
            You are never alone. A dedicated team and smart tools guide you
            throughout your apprenticeship.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Coach Card */}
          <div className="bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5">
            <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-200/40 flex items-center justify-center mb-4">
              <i className="ri-user-star-line text-primary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">
              Dedicated Coach
            </h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Your personal coach meets with you every month, tracks your
              progress, and helps you stay on target throughout your journey.
            </p>
          </div>

          {/* Employer Card */}
          <div className="bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5">
            <div className="w-11 h-11 rounded-xl bg-secondary-50 border border-secondary-200/40 flex items-center justify-center mb-4">
              <i className="ri-building-line text-secondary-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">
              Employer Partner
            </h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Your employer provides real workplace experience, mentorship, and
              confirms your on-the-job learning hours.
            </p>
          </div>

          {/* Platform Card */}
          <div className="bg-background-50 rounded-2xl border border-foreground-200 p-6 transition-all duration-300 hover:border-background-300/80 hover:shadow-lg hover:shadow-foreground-950/5">
            <div className="w-11 h-11 rounded-xl bg-accent-50 border border-accent-200/40 flex items-center justify-center mb-4">
              <i className="ri-dashboard-line text-accent-600 text-[18px]" />
            </div>
            <h3 className="text-[16px] font-heading font-semibold text-foreground-900 mb-2">
              Smart Platform
            </h3>
            <p className="text-[13px] text-foreground-400 leading-relaxed">
              Track progress, upload evidence, complete modules, and see your KSB
              development in real time.
            </p>
          </div>
        </div>
      </section>

      {/* ============ FOOTER CTA ============ */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div
          className="relative overflow-hidden rounded-3xl p-10 md:p-14 text-center"
          style={{
            background:
              'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)',
          }}
        >
          {/* Liquid blobs */}
          <div
            className="absolute animate-liquid-blob-1 opacity-30"
            style={{
              width: '35%',
              height: '45%',
              left: '-5%',
              top: '-10%',
              background:
                'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.4) 0%, oklch(var(--accent-600) / 0.15) 35%, transparent 70%)',
              filter: 'blur(45px)',
            }}
          />
          <div
            className="absolute animate-liquid-blob-2 opacity-25"
            style={{
              width: '30%',
              height: '40%',
              right: '-5%',
              bottom: '-12%',
              background:
                'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.4) 0%, oklch(var(--primary-600) / 0.15) 40%, transparent 70%)',
              filter: 'blur(55px)',
            }}
          />

          <div className="relative z-10">
            <div className="w-14 h-14 rounded-2xl bg-accent-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-accent-500/20">
              <i className="ri-rocket-line text-xl text-foreground-950" />
            </div>
            <h2 className="text-[26px] md:text-[32px] font-heading font-semibold text-white mb-3">
              Ready to begin your journey?
            </h2>
            <p className="text-white/35 text-[14px] max-w-lg mx-auto mb-8 leading-relaxed">
              Join thousands of learners who have achieved their professional
              qualification through KBC LearningOS.
            </p>
            <div className="flex items-center justify-center gap-4">
              <a
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-accent-500 text-foreground-950 text-[13px] font-semibold hover:bg-accent-400 transition-all duration-300 whitespace-nowrap shadow-lg shadow-accent-500/20 hover:-translate-y-0.5"
              >
                <i className="ri-rocket-line text-[14px]" />
                Start Your Journey
              </a>
              <a
                href="/"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-white/10 text-white/55 text-[13px] font-medium hover:bg-white/5 hover:text-white/80 hover:border-white/20 transition-all duration-300 whitespace-nowrap"
              >
                <i className="ri-home-4-line text-[14px]" />
                Back to Home
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ============ CONFETTI ============ */}
      {showConfetti && (
        <canvas
          ref={confettiCanvasRef}
          className="fixed inset-0 z-[100] pointer-events-none"
          style={{ width: '100vw', height: '100vh' }}
        />
      )}
    </div>
  );
}