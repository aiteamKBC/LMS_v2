import { useState, useEffect, useRef } from 'react';

const CASE_DOCUMENTS = [
  { id: 'cd-01', name: 'ILR Enrolment Form', type: 'Compliance', date: '12 Jan 2026', status: 'Complete', signedBy: 'All parties' },
  { id: 'cd-02', name: 'Initial Assessment Report', type: 'Assessment', date: '15 Jan 2026', status: 'Complete', signedBy: 'Coach' },
  { id: 'cd-03', name: 'Commitment Statement', type: 'Statutory', date: '20 Jan 2026', status: 'Complete', signedBy: 'Learner, Employer, Provider' },
  { id: 'cd-04', name: 'Employer Agreement', type: 'Contract', date: '22 Jan 2026', status: 'Complete', signedBy: 'Employer, Provider' },
  { id: 'cd-05', name: 'Training Plan v1.2', type: 'Plan', date: '1 Feb 2026', status: 'Complete', signedBy: 'All parties' },
  { id: 'cd-06', name: 'Safeguarding Declaration', type: 'Compliance', date: '25 Jan 2026', status: 'Complete', signedBy: 'Learner' },
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
  if (status === 'Complete') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
};

export default function DocumentsTab() {
  const [showAllDocs, setShowAllDocs] = useState(false);
  const visibleDocs = showAllDocs ? CASE_DOCUMENTS : CASE_DOCUMENTS.slice(0, 3);

  return (
    <div className="space-y-5">
      <AnimatedSection delay={0}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleDocs.map((doc, i) => (
            <div key={doc.id} className="flex items-start gap-3 p-3 rounded-xl bg-background-50 border border-foreground-200/60 hover:border-primary-200/50 transition-all cursor-pointer group" style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.08}s both` }}>
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${doc.status === 'Complete' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                <i className={`${doc.status === 'Complete' ? 'ri-check-line' : 'ri-time-line'} text-sm`}></i>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground-900 group-hover:text-primary-600 transition-colors">{doc.name}</p>
                <p className="text-[10px] text-foreground-400 mt-0.5">{doc.type} · {doc.date}</p>
                {doc.signedBy && <p className="text-[9px] text-foreground-400 mt-0.5">Signed: {doc.signedBy}</p>}
                <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full border mt-1 ${getStatusClass(doc.status)}`}>{doc.status}</span>
              </div>
            </div>
          ))}
        </div>
        {CASE_DOCUMENTS.length > 3 && (
          <button
            onClick={() => setShowAllDocs(!showAllDocs)}
            className="mt-3 w-full text-center text-[12px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer py-2 rounded-lg hover:bg-primary-50/50 transition-all"
          >
            {showAllDocs ? 'Show Less' : `Show all ${CASE_DOCUMENTS.length} documents`}
          </button>
        )}
      </AnimatedSection>
    </div>
  );
}