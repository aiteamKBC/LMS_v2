import { useState, useEffect, useCallback, useRef } from 'react';
import { AI_PRESENTATION } from '@/mocks/monthly-coaching';
import { DonutRing, HBar, ProgressGrid, DonutSplit, BarGroup } from './CinematicCharts';

interface PresentationPreviewProps {
  open: boolean;
  onClose: () => void;
}

export default function PresentationPreview({ open, onClose }: PresentationPreviewProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideMode, setSlideMode] = useState<'overview' | 'present'>('overview');
  const [animState, setAnimState] = useState<{ from: number; to: number; direction: 'forward' | 'backward' } | null>(null);
  const [mounted, setMounted] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slides = AI_PRESENTATION.slides;
  const totalSlides = slides.length;

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setMounted(true), 100);
      return () => clearTimeout(t);
    }
    setMounted(false);
  }, [open]);

  const goNext = useCallback(() => {
    if (currentSlide >= totalSlides - 1 || animState) return;
    const next = currentSlide + 1;
    setAnimState({ from: currentSlide, to: next, direction: 'forward' });
    animTimerRef.current = setTimeout(() => {
      setCurrentSlide(next);
      setAnimState(null);
    }, 350);
  }, [currentSlide, totalSlides, animState]);

  const goPrev = useCallback(() => {
    if (currentSlide <= 0 || animState) return;
    const prev = currentSlide - 1;
    setAnimState({ from: currentSlide, to: prev, direction: 'backward' });
    animTimerRef.current = setTimeout(() => {
      setCurrentSlide(prev);
      setAnimState(null);
    }, 350);
  }, [currentSlide, animState]);

  useEffect(() => {
    return () => { if (animTimerRef.current) clearTimeout(animTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        if (slideMode === 'present') goNext();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (slideMode === 'present') goPrev();
      }
      if (e.key === 'Escape') {
        if (slideMode === 'present') setSlideMode('overview');
        else handleClose();
      }
      if (e.key === 'f' || e.key === 'F') {
        setSlideMode(slideMode === 'present' ? 'overview' : 'present');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, goNext, goPrev, slideMode]);

  const handleClose = () => {
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    setMounted(false);
    setTimeout(() => {
      setCurrentSlide(0);
      setSlideMode('overview');
      setAnimState(null);
      onClose();
    }, 300);
  };

  if (!open) return null;

  const slide = slides[currentSlide];

  const renderPresentSlide = (s: typeof slides[0]) => (
    <div className="w-full max-w-[900px] mx-auto flex flex-col" style={{ minHeight: '460px' }}>
      <div className="flex items-center gap-3 mb-8">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold ${
          s.type === 'cover' ? 'bg-foreground-950 text-background-50' : 'bg-primary-500/20 text-primary-300 border border-primary-500/20'
        }`}>
          {slides.findIndex(ss => ss.id === s.id) + 1}
        </span>
        <span className="text-xs font-semibold text-foreground-400 uppercase tracking-wider">{s.title}</span>
        {s.editable && <span className="text-xs text-primary-300/50 bg-primary-500/8 px-1.5 py-0.5 rounded">Editable</span>}
      </div>

      {s.type === 'cover' ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="mb-6 relative">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center relative z-10 shadow-[0_0_60px_-10px_var(--glow-purple)]">
              <AppIcon className="ri-presentation-line text-3xl text-foreground-950" />
            </div>
          </div>
          <h1 className="text-4xl font-heading font-bold text-foreground-950 mb-3 tracking-tight">{s.content.heading}</h1>
          <p className="text-base text-foreground-500 mb-10">{s.content.subheading}</p>
          <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-left">
            {(s.content.details as any[]).map((d: any, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground-400 w-24 whitespace-nowrap">{d.label}</span>
                <span className="text-base font-semibold text-foreground-900">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : s.id === 'slide-2' ? (
        <div className="space-y-7">
          <div>
            <h3 className="text-xl font-heading font-semibold text-foreground-950">{s.content.heading}</h3>
            <p className="text-sm text-foreground-500 mt-1">{s.content.subheading}</p>
          </div>
          <div className="flex items-center justify-center gap-12">
            <DonutRing value={42} max={100} size={110} strokeWidth={9} label="KSB" sublabel="42%" />
            <DonutRing value={35} max={100} size={110} strokeWidth={9} color="var(--accent-500)" label="OTJH" sublabel="35%" />
            <DonutRing value={80} max={100} size={110} strokeWidth={9} color="0.62 0.18 160" label="Quiz" sublabel="80%" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(s.content.metrics as any[]).slice(0, 6).map((m: any, i: number) => {
              const statusDot: Record<string, string> = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400' };
              return (
                <div key={i} className="rounded-xl bg-foreground-100/30 border border-foreground-200/50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${statusDot[m.status]}`} />
                    <span className="text-xs text-foreground-500">{m.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-bold text-foreground-950">{m.value}</span>
                    <span className="text-xs text-foreground-400">/ {m.target}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : s.id === 'slide-3' ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-heading font-semibold text-foreground-950">{s.content.heading}</h3>
            <p className="text-sm text-foreground-500 mt-1">{s.content.subheading}</p>
          </div>
          <div className="flex justify-center">
            <DonutSplit segments={[{ value: 5, color: 'green', label: 'Done' }, { value: 1, color: 'amber', label: 'Progress' }, { value: 2, color: 'slate', label: 'Pending' }]} size={120} strokeWidth={12} centerValue="5/8" centerLabel="Completed" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(s.content.weeklyComponents as any[]).slice(0, 6).map((c: any, i: number) => {
              const dotColors: Record<string, string> = { 'Completed': 'bg-emerald-400', 'In Progress': 'bg-amber-400', 'Evidence Submitted': 'bg-primary-400', 'Not Started': 'bg-foreground-400' };
              return (
                <div key={i} className="flex items-center gap-2.5 rounded-lg bg-foreground-100/30 px-3 py-2.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${dotColors[c.status] || 'bg-foreground-400'}`} />
                  <span className="text-xs text-foreground-700 truncate flex-1">{c.title}</span>
                  <span className="text-xs text-foreground-400 flex-shrink-0">{c.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : s.id === 'slide-4' ? (
        <div className="space-y-5">
          <div>
            <h3 className="text-xl font-heading font-semibold text-foreground-950">{s.content.heading}</h3>
            <p className="text-sm text-foreground-500 mt-1">{s.content.subheading}</p>
          </div>
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {(s.content.examples as any[]).map((ex: any, i: number) => (
              <div key={i} className="rounded-xl bg-foreground-100/30 border border-foreground-200/50 p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-foreground-900">{ex.title}</span>
                  <div className="flex gap-1">
                    {ex.ksbCodes.map((code: string) => (
                      <span key={code} className="text-xs bg-primary-500/15 text-primary-300 px-1.5 py-0.5 rounded">{code}</span>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-foreground-600 leading-relaxed">{ex.employerImpact}</p>
              </div>
            ))}
          </div>
        </div>
      ) : s.id === 'slide-5' ? (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-heading font-semibold text-foreground-950">{s.content.heading}</h3>
            <p className="text-sm text-foreground-500 mt-1">{s.content.subheading}</p>
          </div>
          <div className="flex items-center justify-center gap-10">
            <DonutSplit segments={[{ value: 9, color: 'green', label: 'Approved' }, { value: 2, color: 'amber', label: 'Pending' }, { value: 1, color: 'slate', label: 'Draft' }]} size={120} strokeWidth={12} centerValue="12" centerLabel="Total" />
            <div className="space-y-3 flex-1 max-w-[300px]">
              <HBar label="K5 — Segmentation" value={85} max={100} color="green" detail="Good Coverage" showPct={false} />
              <HBar label="K6 — Planning" value={75} max={100} color="green" detail="Good Coverage" showPct={false} />
              <HBar label="S7 — Personas" value={40} max={100} color="amber" detail="Needs More" showPct={false} />
              <HBar label="S8 — Campaigns" value={45} max={100} color="amber" detail="Needs More" showPct={false} />
              <HBar label="B1 — Application" value={35} max={100} color="red" detail="Needs More" showPct={false} />
            </div>
          </div>
        </div>
      ) : s.id === 'slide-6' ? (
        <div className="space-y-5">
          <div>
            <h3 className="text-xl font-heading font-semibold text-foreground-950">{s.content.heading}</h3>
            <p className="text-sm text-foreground-500 mt-1">{s.content.subheading}</p>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-medium text-foreground-400 uppercase tracking-wider mb-2">Achievements</p>
              {(s.content.achievements as string[]).slice(0, 4).map((a: string, i: number) => (
                <div key={i} className="flex items-start gap-2 py-1.5">
                  <AppIcon className="ri-check-line text-emerald-400 mt-px" />
                  <span className="text-sm text-foreground-700">{a}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-xs font-medium text-foreground-400 uppercase tracking-wider mb-2">Improvements</p>
              {(s.content.improvements as string[]).slice(0, 3).map((imp: string, i: number) => (
                <div key={i} className="flex items-start gap-2 py-1.5">
                  <AppIcon className="ri-arrow-up-line text-primary-400 mt-px" />
                  <span className="text-sm text-foreground-700">{imp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : s.id === 'slide-7' ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-xl font-heading font-semibold text-foreground-950">{s.content.heading}</h3>
            <p className="text-sm text-foreground-500 mt-1">{s.content.subheading}</p>
          </div>
          <div className="space-y-3">
            {(s.content.challenges as any[]).map((ch: any, i: number) => (
              <div key={i} className={`rounded-xl border p-4 ${ch.impact === 'High' ? 'border-red-500/15 bg-red-500/3' : 'border-amber-500/10 bg-amber-500/2'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-foreground-900">{ch.title}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ch.impact === 'High' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{ch.impact} Impact</span>
                </div>
                <p className="text-xs text-foreground-600">{ch.supportNeeded}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="text-xl font-heading font-semibold text-foreground-950">{s.content.heading}</h3>
            <p className="text-sm text-foreground-500 mt-1">{s.content.subheading}</p>
          </div>
          <div className="space-y-2.5">
            {(s.content.actions as any[]).slice(0, 4).map((act: any, i: number) => {
              const prioColors: Record<string, string> = { Critical: 'border-red-500/15 bg-red-500/3 text-red-300', High: 'border-amber-500/15 bg-amber-500/3 text-amber-300', Normal: 'border-foreground-200/50 bg-foreground-100/30 text-foreground-600' };
              return (
                <div key={i} className="rounded-xl border border-foreground-200/50 bg-foreground-100/30 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-foreground-900">{act.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${prioColors[act.priority]}`}>{act.priority}</span>
                  </div>
                  <p className="text-xs text-foreground-500">{act.target}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const renderOverview = () => (
    <div className="absolute inset-0 flex flex-col bg-background-50 transition-opacity duration-500" style={{ opacity: mounted ? 1 : 0 }}>
      <div className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center shadow-[0_0_16px_-4px_var(--glow-purple)]">
            <AppIcon className="ri-presentation-line text-sm text-foreground-950" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground-950">Monthly Coaching Presentation</p>
            <p className="text-xs text-foreground-400">{AI_PRESENTATION.learner.fullName} · {AI_PRESENTATION.meeting.cycle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSlideMode('present')} className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-foreground-950 text-background-50 rounded-xl text-sm font-semibold hover:bg-foreground-900 cursor-pointer transition-all duration-300 whitespace-nowrap shadow-[0_0_30px_-8px_rgba(0,0,0,0.15)]">
            <AppIcon className="ri-play-circle-fill text-base" /> Start Presentation
          </button>
          <button onClick={handleClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-900 hover:bg-foreground-100/50 cursor-pointer transition-all duration-300">
            <AppIcon className="ri-close-line" />
          </button>
        </div>
      </div>
      <div className="relative z-10 flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[960px] mx-auto">
          <div className="mb-8">
            <h2 className="text-2xl font-heading font-bold text-foreground-950 mb-1">Slide Overview</h2>
            <p className="text-sm text-foreground-400">Click any slide to start presenting from that point</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {slides.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => { setCurrentSlide(idx); setSlideMode('present'); }}
                className="group text-left rounded-2xl border border-foreground-200/50 bg-background-100 backdrop-blur-sm p-5 hover:border-primary-500/20 hover:bg-background-100 transition-all duration-400 cursor-pointer"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                    s.type === 'cover' ? 'bg-foreground-950 text-background-50' : 'bg-primary-500/15 text-primary-300 group-hover:bg-primary-500 group-hover:text-foreground-950'
                  }`}>{idx + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{s.title}</p>
                    <p className="text-xs text-foreground-400">{s.type === 'cover' ? 'Cover Slide' : 'Content Slide'}{s.editable ? ' · Editable' : ''}</p>
                  </div>
                </div>
                <div className="h-24 rounded-xl bg-background-100 border border-foreground-200/50 flex items-center justify-center overflow-hidden group-hover:border-foreground-300 transition-all duration-300">
                  {s.type === 'cover' ? (
                    <AppIcon className="ri-presentation-line text-2xl text-foreground-300" />
                  ) : s.id === 'slide-2' ? (
                    <div className="flex items-end gap-1.5 h-12">
                      {[55, 35, 80, 42, 65, 30].map((h, i) => (
                        <div key={i} className={`w-3 rounded-t-md transition-all duration-500 ${i === 0 ? 'bg-primary-400 h-10' : i === 1 ? 'bg-accent-400 h-6' : i === 2 ? 'bg-emerald-400 h-12' : 'bg-foreground-200'}`} style={{ height: `${h * 0.18}px` }} />
                      ))}
                    </div>
                  ) : s.id === 'slide-5' ? (
                    <div className="flex items-center gap-1.5">
                      {[85, 75, 40, 45, 35].map((w, i) => (
                        <div key={i} className={`h-1.5 rounded-full ${i < 2 ? 'bg-emerald-400/60' : i < 4 ? 'bg-amber-400/60' : 'bg-red-400/60'}`} style={{ width: `${w * 0.5}px` }} />
                      ))}
                    </div>
                  ) : (
                    <AppIcon className={`text-2xl text-foreground-300 ${s.id === 'slide-3' ? 'ri-book-open-line' : s.id === 'slide-4' ? 'ri-building-2-line' : s.id === 'slide-6' ? 'ri-arrow-up-circle-line' : s.id === 'slide-7' ? 'ri-error-warning-line' : 'ri-flag-line'}`} />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative z-10 border-t border-foreground-200/50 px-8 py-3 flex items-center justify-between">
        <p className="text-xs text-foreground-400">
          Press <kbd className="px-1.5 py-0.5 bg-foreground-100 rounded text-xs font-mono text-foreground-500">Space</kbd> or <kbd className="px-1.5 py-0.5 bg-foreground-100 rounded text-xs font-mono text-foreground-500">→</kbd> to present · <kbd className="px-1.5 py-0.5 bg-foreground-100 rounded text-xs font-mono text-foreground-500">Esc</kbd> to exit
        </p>
        <span className="text-xs text-foreground-400">{totalSlides} slides · Auto-generated {AI_PRESENTATION.generatedAt}</span>
      </div>
    </div>
  );

  const renderPresentMode = () => {
    const displaySlide = animState ? slides[animState.from] : slide;
    const enteringSlide = animState ? slides[animState.to] : null;
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden bg-background-50">
        <div className="flex-1 flex items-center justify-center px-12 relative overflow-hidden">
          <div
            key={`exit-${displaySlide.id}`}
            className="absolute inset-0 flex items-center justify-center px-12 transition-all duration-350 ease-out"
            style={{
              opacity: animState ? 0 : 1,
              transform: animState ? (animState.direction === 'forward' ? 'translateX(-60px) scale(0.96)' : 'translateX(60px) scale(0.96)') : 'translateX(0) scale(1)',
              filter: animState ? 'blur(4px)' : 'blur(0px)',
            }}
          >
            {renderPresentSlide(displaySlide)}
          </div>
          {animState && enteringSlide && (
            <div
              key={`enter-${enteringSlide.id}`}
              className="absolute inset-0 flex items-center justify-center px-12 animate-slide-enter"
              style={{
                animation: animState.direction === 'forward' ? 'slide-enter-from-right 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards' : 'slide-enter-from-left 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards',
              }}
            >
              {renderPresentSlide(enteringSlide)}
            </div>
          )}
        </div>
        <div className="relative z-10 flex items-center justify-between px-8 pb-6 pt-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSlideMode('overview')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground-500 hover:text-foreground-900 hover:bg-foreground-100/50 cursor-pointer transition-all duration-300 whitespace-nowrap">
              <AppIcon className="ri-layout-grid-line" /> Overview
            </button>
            <div className="h-5 w-px bg-foreground-200/50" />
            <span className="text-xs text-foreground-400 font-mono">
              <strong className="text-foreground-900">{animState ? animState.to + 1 : currentSlide + 1}</strong>
              <span className="text-foreground-400"> / {totalSlides}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (idx === currentSlide || animState) return;
                  const dir = idx > currentSlide ? 'forward' : 'backward';
                  setAnimState({ from: currentSlide, to: idx, direction: dir as 'forward' | 'backward' });
                  animTimerRef.current = setTimeout(() => { setCurrentSlide(idx); setAnimState(null); }, 350);
                }}
                className={`rounded-full transition-all duration-300 cursor-pointer ${idx === currentSlide ? 'w-6 h-1.5 bg-foreground-950' : 'w-1.5 h-1.5 bg-foreground-300 hover:bg-foreground-500'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={goPrev} disabled={currentSlide === 0 || !!animState} className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-500 hover:text-foreground-900 hover:bg-foreground-100/50 disabled:opacity-15 disabled:cursor-not-allowed cursor-pointer transition-all duration-300">
              <AppIcon className="ri-arrow-left-s-line text-lg" />
            </button>
            <button onClick={goNext} disabled={currentSlide === totalSlides - 1 || !!animState} className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-500 hover:text-foreground-900 hover:bg-foreground-100/50 disabled:opacity-15 disabled:cursor-not-allowed cursor-pointer transition-all duration-300">
              <AppIcon className="ri-arrow-right-s-line text-lg" />
            </button>
            <div className="h-5 w-px bg-foreground-200/50 ml-1" />
            <button onClick={() => setSlideMode('overview')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground-500 hover:text-foreground-900 hover:bg-foreground-100/50 cursor-pointer transition-all duration-300 whitespace-nowrap">
              <AppIcon className="ri-fullscreen-exit-line" /> Exit
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background-50">
      {slideMode === 'overview' ? renderOverview() : renderPresentMode()}
    </div>
  );
}