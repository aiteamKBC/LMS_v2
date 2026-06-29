import { useState, useEffect, useRef } from 'react';
import { LEARNER_PROFILE, KSB_ENDORSEMENTS, KSB_HEATMAP_MATRIX } from '@/mocks/learner-profile';

const p = LEARNER_PROFILE;

const DETAILED_KSB = [
  { id: 'K1', category: 'Knowledge', title: 'Marketing principles and concepts', status: 'Validated', evidence: 3, module: 'Marketing Principles' },
  { id: 'K2', category: 'Knowledge', title: 'Customer segmentation and targeting', status: 'In Progress', evidence: 2, module: 'Marketing Planning' },
  { id: 'K3', category: 'Knowledge', title: 'Marketing environment analysis (PESTLE)', status: 'Validated', evidence: 2, module: 'Marketing Principles' },
  { id: 'K4', category: 'Knowledge', title: 'Consumer behaviour and decision-making', status: 'Not Started', evidence: 0, module: 'Marketing Principles' },
  { id: 'K5', category: 'Knowledge', title: 'Marketing mix and campaign planning', status: 'In Progress', evidence: 1, module: 'Marketing Planning' },
  { id: 'K6', category: 'Knowledge', title: 'Brand management fundamentals', status: 'Not Started', evidence: 0, module: 'Marketing Planning' },
  { id: 'S1', category: 'Skills', title: 'Develop marketing plans and campaigns', status: 'In Progress', evidence: 2, module: 'Marketing Planning' },
  { id: 'S2', category: 'Skills', title: 'Conduct market research and analysis', status: 'Validated', evidence: 2, module: 'Marketing Principles' },
  { id: 'S3', category: 'Skills', title: 'Use digital marketing tools', status: 'Not Started', evidence: 0, module: 'Digital Channels' },
  { id: 'S4', category: 'Skills', title: 'Create marketing content', status: 'In Progress', evidence: 1, module: 'Marketing Planning' },
  { id: 'B1', category: 'Behaviours', title: 'Professional communication', status: 'Validated', evidence: 3, module: 'Professional Practice' },
  { id: 'B2', category: 'Behaviours', title: 'Teamwork and collaboration', status: 'Validated', evidence: 2, module: 'Professional Practice' },
  { id: 'B3', category: 'Behaviours', title: 'Initiative and self-development', status: 'In Progress', evidence: 1, module: 'Professional Practice' },
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
  if (status === 'Validated' || status === 'Accepted' || status === 'Complete') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'In Progress' || status === 'Submitted') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
};

const getPixelColor = (progress: number) => {
  if (progress >= 80) return 'bg-emerald-500';
  if (progress >= 50) return 'bg-emerald-400';
  if (progress >= 25) return 'bg-amber-400';
  if (progress >= 5) return 'bg-amber-200';
  return 'bg-background-200';
};

export default function KSBsTab() {
  const [endorsedSkills, setEndorsedSkills] = useState<Set<string>>(new Set());
  const [showAllKsbs, setShowAllKsbs] = useState(false);
  const [hoveredKsb, setHoveredKsb] = useState<{id: string, label: string, progress: number, category: string} | null>(null);

  const visibleKsbs = showAllKsbs ? DETAILED_KSB : DETAILED_KSB.slice(0, 6);

  const handleEndorse = (ksbId: string) => {
    setEndorsedSkills(prev => {
      const next = new Set(prev);
      if (next.has(ksbId)) next.delete(ksbId);
      else next.add(ksbId);
      return next;
    });
  };

  const knowledge = KSB_HEATMAP_MATRIX.filter(k => k.category === 'Knowledge');
  const skills = KSB_HEATMAP_MATRIX.filter(k => k.category === 'Skills');
  const behaviours = KSB_HEATMAP_MATRIX.filter(k => k.category === 'Behaviours');

  return (
    <div className="space-y-5">
      {/* KSB Progress Overview */}
      <AnimatedSection delay={0}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total KSBs', value: `${p.ksbTotal}`, sub: 'Knowledge + Skills + Behaviours', icon: 'ri-stack-line', color: 'primary' as const },
            { label: 'Validated', value: `${p.ksbValidated}`, sub: `${Math.round((p.ksbValidated / p.ksbTotal) * 100)}% complete`, icon: 'ri-check-double-line', color: 'emerald' as const },
            { label: 'In Progress', value: `${p.ksbPending}`, sub: 'Evidence submitted', icon: 'ri-hourglass-line', color: 'amber' as const },
            { label: 'Not Started', value: `${p.ksbNotStarted}`, sub: 'Pending evidence', icon: 'ri-circle-line', color: 'red' as const },
          ].map((stat, i) => (
            <div key={i} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 hover:border-background-300/60 transition-all cursor-default" style={{ animation: `fadeInUp 0.5s ease-out ${i * 0.08}s both` }}>
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

      {/* Pixel KSB Heat Map */}
      <AnimatedSection delay={80}>
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-grid-line text-accent-500"></i> KSB Progress Heat Map
              </h2>
              <div className="flex items-center gap-2 text-[10px] text-foreground-400">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-emerald-500"></span> 80%+</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-emerald-400"></span> 50–79%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-amber-400"></span> 25–49%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-amber-200"></span> 5–24%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-background-200"></span> 0–4%</span>
              </div>
            </div>

            {/* ── Pixel Grid ── */}
            <div className="space-y-3">
              {/* Knowledge */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold text-foreground-500 uppercase tracking-wider w-20 shrink-0 text-right">Knowledge</span>
                <div className="flex items-center gap-1">
                  {knowledge.map(ksb => (
                    <div
                      key={ksb.id}
                      className={`w-[10px] h-[10px] rounded-[2px] ${getPixelColor(ksb.progress)} cursor-default transition-all duration-150 hover:scale-125 hover:ring-1 hover:ring-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]`}
                      onMouseEnter={() => setHoveredKsb({
                        id: ksb.id,
                        label: ksb.label,
                        progress: ksb.progress,
                        category: ksb.category,
                      })}
                      onMouseLeave={() => setHoveredKsb(null)}
                      title={`${ksb.id}: ${ksb.label} — ${ksb.progress}%`}
                    />
                  ))}
                </div>
              </div>
              {/* Skills */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold text-foreground-500 uppercase tracking-wider w-20 shrink-0 text-right">Skills</span>
                <div className="flex items-center gap-1">
                  {skills.map(ksb => (
                    <div
                      key={ksb.id}
                      className={`w-[10px] h-[10px] rounded-[2px] ${getPixelColor(ksb.progress)} cursor-default transition-all duration-150 hover:scale-125 hover:ring-1 hover:ring-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]`}
                      onMouseEnter={() => setHoveredKsb({
                        id: ksb.id,
                        label: ksb.label,
                        progress: ksb.progress,
                        category: ksb.category,
                      })}
                      onMouseLeave={() => setHoveredKsb(null)}
                      title={`${ksb.id}: ${ksb.label} — ${ksb.progress}%`}
                    />
                  ))}
                </div>
              </div>
              {/* Behaviours */}
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold text-foreground-500 uppercase tracking-wider w-20 shrink-0 text-right">Behaviours</span>
                <div className="flex items-center gap-1">
                  {behaviours.map(ksb => (
                    <div
                      key={ksb.id}
                      className={`w-[10px] h-[10px] rounded-[2px] ${getPixelColor(ksb.progress)} cursor-default transition-all duration-150 hover:scale-125 hover:ring-1 hover:ring-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]`}
                      onMouseEnter={() => setHoveredKsb({
                        id: ksb.id,
                        label: ksb.label,
                        progress: ksb.progress,
                        category: ksb.category,
                      })}
                      onMouseLeave={() => setHoveredKsb(null)}
                      title={`${ksb.id}: ${ksb.label} — ${ksb.progress}%`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* KSB labels row */}
            <div className="mt-3 flex items-center gap-3 pl-[92px]">
              <div className="flex items-center gap-[1px]">
                {KSB_HEATMAP_MATRIX.map(ksb => (
                  <span key={ksb.id} className="text-[9px] text-foreground-400 w-[10px] text-center leading-[10px] shrink-0">{ksb.id}</span>
                ))}
              </div>
            </div>

            {/* Hover tooltip panel */}
            {hoveredKsb && (
              <div className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-background-100/50 border border-foreground-200/60 animate-fadeInUp">
                <span className={`w-2.5 h-2.5 rounded-[2px] ${getPixelColor(hoveredKsb.progress)}`}></span>
                <span className="text-[11px] text-foreground-700 font-semibold">{hoveredKsb.id}</span>
                <span className="text-[11px] text-foreground-500">{hoveredKsb.label}</span>
                <span className="text-[10px] text-foreground-400 ml-auto">{hoveredKsb.progress}% • {hoveredKsb.category}</span>
              </div>
            )}

            {/* Category breakdown */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { category: 'Knowledge', total: 6, validated: knowledge.filter(k => k.progress >= 80).length, inProgress: knowledge.filter(k => k.progress >= 5 && k.progress < 80).length, notStarted: knowledge.filter(k => k.progress < 5).length },
                { category: 'Skills', total: 4, validated: skills.filter(k => k.progress >= 80).length, inProgress: skills.filter(k => k.progress >= 5 && k.progress < 80).length, notStarted: skills.filter(k => k.progress < 5).length },
                { category: 'Behaviours', total: 3, validated: behaviours.filter(k => k.progress >= 80).length, inProgress: behaviours.filter(k => k.progress >= 5 && k.progress < 80).length, notStarted: behaviours.filter(k => k.progress < 5).length },
              ].map((cat, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-background-100/40 border border-background-200/30">
                  <p className="text-[10px] font-semibold text-foreground-500 uppercase tracking-wider mb-1.5">{cat.category}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-[2px] bg-emerald-500"></span>
                      <span className="text-[10px] text-foreground-700 font-medium">{cat.validated}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-[2px] bg-amber-400"></span>
                      <span className="text-[10px] text-foreground-700 font-medium">{cat.inProgress}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-[2px] bg-background-200"></span>
                      <span className="text-[10px] text-foreground-700 font-medium">{cat.notStarted}</span>
                    </div>
                    <span className="text-[9px] text-foreground-400 ml-auto">{cat.total} total</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Skills & Endorsements (LinkedIn-style) */}
      <AnimatedSection delay={140}>
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-award-line text-accent-500"></i> Skills &amp; Endorsements
              </h2>
              <span className="text-[11px] text-foreground-400">{p.ksbValidated} of {DETAILED_KSB.length} validated</span>
            </div>
            <div className="space-y-0">
              {visibleKsbs.map((ksb, i) => {
                const endorsements = KSB_ENDORSEMENTS[ksb.id] || [];
                const isEndorsed = endorsedSkills.has(ksb.id);
                return (
                  <div key={ksb.id} className={`flex items-start gap-3 py-3 ${i < visibleKsbs.length - 1 ? 'border-b border-background-100' : ''}`}>
                    <span className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                      ksb.category === 'Knowledge' ? 'bg-primary-100 text-primary-700' :
                      ksb.category === 'Skills' ? 'bg-accent-100 text-accent-700' :
                      'bg-secondary-100 text-secondary-700'
                    }`}>{ksb.id}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-medium text-foreground-900">{ksb.title}</p>
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{ksb.module}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${getStatusClass(ksb.status)}`}>{ksb.status}</span>
                        <span className="text-[11px] text-foreground-400">{ksb.evidence} evidence item{ksb.evidence !== 1 ? 's' : ''}</span>
                      </div>
                      {/* Endorsements row */}
                      {endorsements.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          {endorsements.map((end, ei) => (
                            <div key={ei} className={`w-6 h-6 rounded-full ${end.color} flex items-center justify-center text-[9px] font-bold text-white cursor-default relative group`} title={`${end.name} · ${end.role}`}>
                              {end.initials}
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground-900 text-background-50 text-[10px] font-medium px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                                {end.name} · {end.role} · {end.date}
                              </div>
                            </div>
                          ))}
                          <span className="text-[10px] text-foreground-400 ml-1">
                            {endorsements.length} endorsement{endorsements.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span className="text-[10px] font-medium text-foreground-400 px-2 py-0.5 rounded bg-background-100">{ksb.category}</span>
                      <button
                        onClick={() => handleEndorse(ksb.id)}
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border cursor-pointer transition-all whitespace-nowrap ${
                          isEndorsed
                            ? 'bg-primary-50 text-primary-700 border-primary-300'
                            : 'bg-background-100 text-foreground-400 border-background-200 hover:border-primary-200 hover:text-primary-600'
                        }`}
                      >
                        <i className={`${isEndorsed ? 'ri-thumb-up-fill' : 'ri-thumb-up-line'} text-[10px] mr-0.5`}></i>
                        {isEndorsed ? 'Endorsed' : 'Endorse'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {DETAILED_KSB.length > 6 && (
              <button
                onClick={() => setShowAllKsbs(!showAllKsbs)}
                className="mt-3 w-full text-center text-[12px] font-semibold text-primary-600 hover:text-primary-700 cursor-pointer py-2 rounded-lg hover:bg-primary-50/50 transition-all"
              >
                {showAllKsbs ? 'Show Less' : `Show all ${DETAILED_KSB.length} KSBs`}
              </button>
            )}
          </div>
        </section>
      </AnimatedSection>
    </div>
  );
}