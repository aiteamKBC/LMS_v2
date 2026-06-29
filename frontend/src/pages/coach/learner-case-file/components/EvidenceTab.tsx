import { useState, useEffect, useRef } from 'react';

const EVIDENCE_ITEMS = [
  { id: 'ev-01', title: 'Customer Persona for Tim Hortons Breakfast Campaign', type: 'Workplace Project', module: 'Marketing Planning', date: '8 Jun 2026', ksbCount: 3, status: 'Submitted', validated: false },
  { id: 'ev-02', title: 'Workplace Reflection: Applying Segmentation at Work', type: 'Reflection', module: 'Marketing Planning', date: '6 Jun 2026', ksbCount: 2, status: 'Submitted', validated: false },
  { id: 'ev-03', title: 'STP Model Worksheet', type: 'Assignment', module: 'Marketing Principles', date: '30 May 2026', ksbCount: 4, status: 'Accepted', validated: true },
  { id: 'ev-04', title: 'PESTLE Analysis of UK QSR Market', type: 'Report', module: 'Marketing Principles', date: '25 May 2026', ksbCount: 3, status: 'Accepted', validated: true },
];

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

const getStatusClass = (status: string) => {
  if (status === 'Accepted') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'Submitted') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
};

export default function EvidenceTab() {
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const visibleEvidence = showAllEvidence ? EVIDENCE_ITEMS : EVIDENCE_ITEMS.slice(0, 3);

  return (
    <div className="space-y-5">
      <AnimatedSection delay={0}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleEvidence.map((item, i) => (
            <div key={item.id} className="bg-background-50 rounded-xl p-4 border border-foreground-200/60 hover:border-primary-200/50 transition-all cursor-pointer group" style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.08}s both` }}>
              <div className="flex items-start justify-between mb-2">
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${getStatusClass(item.status)}`}>{item.status}</span>
                <span className="text-[10px] text-foreground-400">{item.date}</span>
              </div>
              <h4 className="text-[13px] font-semibold text-foreground-900 mb-2 leading-snug group-hover:text-primary-600 transition-colors">{item.title}</h4>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500 border border-background-200">{item.type}</span>
                <span className="text-[10px] text-foreground-400">{item.module}</span>
                <span className="text-[10px] text-foreground-400">{item.ksbCount} KSBs</span>
              </div>
            </div>
          ))}
        </div>
        {EVIDENCE_ITEMS.length > 3 && (
          <button
            onClick={() => setShowAllEvidence(!showAllEvidence)}
            className="mt-3 w-full text-center text-[12px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer py-2 rounded-lg hover:bg-primary-50/50 transition-all"
          >
            {showAllEvidence ? 'Show Less' : `Show all ${EVIDENCE_ITEMS.length} pieces of evidence`}
          </button>
        )}
      </AnimatedSection>
    </div>
  );
}