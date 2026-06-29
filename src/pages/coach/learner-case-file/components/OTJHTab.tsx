import { useState, useEffect, useRef } from 'react';
import { LEARNER_PROFILE, OTJH_WEEKLY_BREAKDOWN, OTJH_CUMULATIVE } from '@/mocks/learner-profile';

const p = LEARNER_PROFILE;

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function AnimatedSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useScrollReveal();
  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export default function OTJHTab() {
  return (
    <div className="space-y-5">
      {/* OTJH Overview Cards */}
      <AnimatedSection delay={0}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Completed', value: `${p.otjhCompleted}h`, sub: `of ${p.otjhTarget}h target`, icon: 'ri-time-line', color: 'primary' as const },
            { label: 'Validated', value: `${p.otjhValidated}h`, sub: 'Coach approved', icon: 'ri-shield-check-line', color: 'emerald' as const },
            { label: 'Pending', value: `${p.otjhPending}h`, sub: 'Awaiting review', icon: 'ri-hourglass-line', color: 'amber' as const },
            { label: 'Behind Pace', value: '-5.5h', sub: 'vs cumulative target', icon: 'ri-alert-line', color: 'red' as const },
          ].map((stat, i) => (
            <div key={i} className="bg-background-50 rounded-xl border border-background-200/50 p-4 hover:border-background-300/60 transition-all cursor-default" style={{ animation: `fadeInUp 0.5s ease-out ${i * 0.08}s both` }}>
              <div className={`w-9 h-9 rounded-lg bg-${stat.color}-100 text-${stat.color}-600 flex items-center justify-center mb-3`}>
                <i className={`${stat.icon} text-base`}></i>
              </div>
              <p className="text-xl font-heading font-bold text-foreground-900">{stat.value}</p>
              <p className="text-[11px] font-medium text-foreground-600">{stat.label}</p>
              <p className="text-[10px] text-foreground-400 mt-0.5">{stat.sub}</p>
            </div>
          ))}
        </div>
      </AnimatedSection>

      {/* Cumulative Tracker */}
      <AnimatedSection delay={80}>
        <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-5 md:p-6">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
              <i className="ri-line-chart-line text-primary-500"></i> Cumulative OTJH Tracker
            </h2>
            <div className="overflow-x-auto">
              <div className="min-w-[500px]">
                {/* Chart area */}
                <div className="relative h-44 mb-2">
                  {/* Grid lines */}
                  {[80, 60, 40, 20, 0].map((pct, i) => (
                    <div key={i} className="absolute left-0 right-0 border-t border-background-200 border-dashed" style={{ bottom: `${pct}%` }}>
                      <span className="absolute -left-5 -top-2 text-[9px] text-foreground-400">{Math.round(41 * pct / 100)}h</span>
                    </div>
                  ))}
                  {/* Target line (dashed) */}
                  <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="6,3"
                      className="text-foreground-300"
                      points={OTJH_CUMULATIVE.map((d, i) => `${(i / (OTJH_CUMULATIVE.length - 1)) * 100}%,${100 - (d.target / 41) * 100}%`).join(' ')}
                    />
                  </svg>
                  {/* Actual line */}
                  <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="text-primary-500"
                      points={OTJH_CUMULATIVE.filter(d => d.actual !== null).map((d, i) => {
                        const idx = OTJH_CUMULATIVE.indexOf(d);
                        return `${(idx / (OTJH_CUMULATIVE.length - 1)) * 100}%,${100 - (d.actual! / 41) * 100}%`;
                      }).join(' ')}
                    />
                    {OTJH_CUMULATIVE.filter(d => d.actual !== null).map((d, i) => {
                      const idx = OTJH_CUMULATIVE.indexOf(d);
                      return (
                        <circle key={i} cx={`${(idx / (OTJH_CUMULATIVE.length - 1)) * 100}%`} cy={`${100 - (d.actual! / 41) * 100}%`} r="4" className="fill-primary-500 stroke-background-50" strokeWidth="2" />
                      );
                    })}
                  </svg>
                </div>
                {/* X-axis labels */}
                <div className="flex justify-between">
                  {OTJH_CUMULATIVE.map((d, i) => (
                    <span key={i} className="text-[9px] text-foreground-400">{d.week}</span>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-3 text-[10px]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-primary-500 inline-block"></span> Actual</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-foreground-300 inline-block" style={{ borderTop: '2px dashed' }}></span> Target</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Weekly Breakdown */}
      <AnimatedSection delay={140}>
        <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-5 md:p-6">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
              <i className="ri-calendar-schedule-line text-accent-500"></i> Weekly OTJH Breakdown
            </h2>
            <div className="space-y-3">
              {OTJH_WEEKLY_BREAKDOWN.map((wk, wi) => (
                <div key={wi} className="rounded-xl border border-foreground-200/60 bg-background-100/60 overflow-hidden">
                  <div className="flex items-center justify-between p-3 border-b border-background-200/30">
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-semibold text-foreground-900">{wk.week}</span>
                      <span className="text-[11px] text-foreground-400">Planned: {wk.planned}h</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-bold text-foreground-900">{wk.actual}h / {wk.planned}h</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${wk.status === 'On Track' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{wk.status}</span>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      {wk.sessions.map((s, si) => (
                        <div
                          key={si}
                          className="flex-1 h-2 rounded-full overflow-hidden bg-background-200"
                          title={`${s.type}: ${s.hours}h — ${s.status}`}
                        >
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${s.status === 'completed' ? 'bg-primary-500' : s.status === 'missed' ? 'bg-red-400' : 'bg-background-300'}`}
                            style={{ width: `${(s.hours / wk.planned) * 100}%` }}
                          ></div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      {wk.sessions.map((s, si) => (
                        <span key={si} className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-full ${s.status === 'completed' ? 'bg-primary-500' : s.status === 'missed' ? 'bg-red-400' : 'bg-background-300'}`}></span>
                          {s.type} ({s.hours}h)
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* OTJH Validation Status */}
      <AnimatedSection delay={200}>
        <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-5 md:p-6">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
              <i className="ri-donut-chart-line text-secondary-500"></i> Validation Breakdown
            </h2>
            <div className="flex items-center gap-6">
              <div className="relative w-24 h-24">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-200" strokeDasharray={`${(p.otjhValidated / p.otjhTarget) * 94} 94`} strokeLinecap="round" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-amber-300" strokeDasharray={`${(p.otjhPending / p.otjhTarget) * 94} 94`} strokeDashoffset={`${-((p.otjhValidated / p.otjhTarget) * 94)}`} strokeLinecap="round" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-background-200" strokeDasharray={`${((p.otjhTarget - p.otjhCompleted) / p.otjhTarget) * 94} 94`} strokeDashoffset={`${-(((p.otjhValidated + p.otjhPending) / p.otjhTarget) * 94)}`} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-heading font-bold text-foreground-900">{Math.round((p.otjhCompleted / p.otjhTarget) * 100)}%</span>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                {[
                  { label: 'Validated', value: `${p.otjhValidated}h`, color: 'bg-emerald-500' },
                  { label: 'Pending Review', value: `${p.otjhPending}h`, color: 'bg-amber-400' },
                  { label: 'Remaining', value: `${p.otjhTarget - p.otjhCompleted}h`, color: 'bg-background-300' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${item.color}`}></span>
                    <span className="text-[12px] text-foreground-600">{item.label}</span>
                    <span className="text-[12px] font-semibold text-foreground-900 ml-auto">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  );
}