import { useState, useEffect, useRef } from 'react';

const TIMELINE_EVENTS = [
  { date: '8 Jun 2026', event: 'Evidence Submitted', detail: 'Customer Persona for Tim Hortons Breakfast Campaign', icon: 'ri-folder-upload-line', color: 'primary' },
  { date: '6 Jun 2026', event: 'Workplace Reflection', detail: 'Applying Segmentation at Work', icon: 'ri-edit-line', color: 'accent' },
  { date: '4 Jun 2026', event: 'Live Session Attended', detail: 'Customer Segmentation with Crispin Jones', icon: 'ri-video-line', color: 'emerald' },
  { date: '2 Jun 2026', event: 'Session Missed', detail: 'Marketing Environment — catch-up assigned', icon: 'ri-close-circle-line', color: 'red' },
  { date: '30 May 2026', event: 'Assessment Passed', detail: 'STP Model Worksheet — 85%', icon: 'ri-check-line', color: 'emerald' },
  { date: '28 May 2026', event: 'Progress Review', detail: 'May 2026 review with Med Maher', icon: 'ri-file-chart-line', color: 'primary' },
  { date: '25 May 2026', event: 'Evidence Accepted', detail: 'PESTLE Analysis validated', icon: 'ri-shield-check-line', color: 'emerald' },
  { date: '19 May 2026', event: 'Programme Start', detail: 'Marketing Executive L4 — Tim Hortons UK', icon: 'ri-flag-line', color: 'primary' },
];

const colorMap: Record<string, string> = { primary: 'bg-primary-100 text-primary-600 ring-primary-200', accent: 'bg-accent-100 text-accent-600 ring-accent-200', emerald: 'bg-emerald-100 text-emerald-600 ring-emerald-200', amber: 'bg-amber-100 text-amber-600 ring-amber-200', red: 'bg-red-100 text-red-600 ring-red-200' };

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

export default function ActivityTab() {
  const [showAllActivity, setShowAllActivity] = useState(false);
  const visibleActivity = showAllActivity ? TIMELINE_EVENTS : TIMELINE_EVENTS.slice(0, 5);

  return (
    <div className="space-y-5">
      <AnimatedSection delay={0}>
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-5 md:p-6">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
              <i className="ri-history-line text-primary-500"></i> Activity Timeline
            </h2>
            <div className="relative pl-8">
              <div className="absolute left-[13px] top-0 bottom-0 w-0.5 bg-background-200"></div>
              <div className="space-y-0">
                {visibleActivity.map((ev, i) => (
                  <div key={i} className="relative pb-5 last:pb-0 animate-fadeInUp" style={{ animationDelay: `${i * 0.06}s`, animationFillMode: 'both' }}>
                    <div className={`absolute -left-[19px] w-4 h-4 rounded-full flex items-center justify-center ring-2 ${colorMap[ev.color]} z-10 bg-background-50`}>
                      <i className={`${ev.icon} text-[8px]`}></i>
                    </div>
                    <div className="ml-2">
                      <p className="text-[12px] font-semibold text-foreground-900">{ev.event}</p>
                      <p className="text-[10px] text-foreground-400">{ev.date}</p>
                      <p className="text-[11px] text-foreground-500 mt-0.5">{ev.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {TIMELINE_EVENTS.length > 5 && (
              <button
                onClick={() => setShowAllActivity(!showAllActivity)}
                className="mt-3 w-full text-center text-[12px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer py-2 rounded-lg hover:bg-primary-50/50 transition-all"
              >
                {showAllActivity ? 'Show Less' : 'Show all activity'}
              </button>
            )}
          </div>
        </section>
      </AnimatedSection>
    </div>
  );
}