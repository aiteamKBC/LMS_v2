import { useState, useEffect, useRef } from 'react';
import { LEARNER_PROFILE, COHORT_CONNECTIONS } from '@/mocks/learner-profile';

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

export default function NetworkTab() {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = COHORT_CONNECTIONS.filter(c =>
    !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.employer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Search */}
      <AnimatedSection delay={0}>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text"
              placeholder="Search cohort connections..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-background-50 border border-foreground-200/60 text-[13px] text-foreground-900 placeholder:text-foreground-400 outline-none focus:border-primary-300/50 transition-all"
            />
          </div>
          <span className="text-[12px] text-foreground-400 shrink-0">{filtered.length} learners</span>
        </div>
      </AnimatedSection>

      {/* Cohort Connections Grid */}
      <AnimatedSection delay={40}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((conn, i) => (
            <div
              key={conn.id}
              className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 hover:border-primary-200/50 transition-all cursor-pointer group"
              style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.06}s both` }}
            >
              <div className="flex items-start gap-3">
                <div className={`w-11 h-11 rounded-full ${conn.avatarColor} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
                  {conn.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[13px] font-semibold text-foreground-900 group-hover:text-primary-600 transition-colors">{conn.name}</h4>
                  <p className="text-[11px] text-foreground-400">{conn.programme} at {conn.employer}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="flex items-center gap-1 text-[11px] text-foreground-500">
                      <i className="ri-pie-chart-line text-primary-500 text-xs"></i> {conn.progress}%
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-foreground-500">
                      <i className={`ri-calendar-check-line text-xs ${conn.attendance >= 90 ? 'text-emerald-500' : 'text-amber-500'}`}></i> {conn.attendance}%
                    </span>
                  </div>
                </div>
                <button className="w-8 h-8 rounded-full border border-background-200 flex items-center justify-center hover:bg-primary-50 hover:border-primary-200 transition-all cursor-pointer shrink-0">
                  <i className="ri-user-add-line text-primary-500 text-xs"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      </AnimatedSection>

      {/* Cohort Stats */}
      <AnimatedSection delay={100}>
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-5 md:p-6">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
              <i className="ri-bar-chart-grouped-line text-accent-500"></i> Cohort Leaderboard
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-background-200">
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider w-8">#</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Progress</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Attendance</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Employer</th>
                  </tr>
                </thead>
                <tbody>
                  {[...COHORT_CONNECTIONS].sort((a, b) => b.progress - a.progress).map((conn, i) => (
                    <tr key={conn.id} className={`border-b border-background-100 hover:bg-background-100/30 transition-all ${conn.name === p.fullName ? 'bg-primary-50/30' : ''}`}>
                      <td className="py-2.5 text-[12px] font-bold text-foreground-400">
                        {i === 0 ? <i className="ri-medal-fill text-amber-500"></i> :
                         i === 1 ? <i className="ri-medal-fill text-foreground-300"></i> :
                         i === 2 ? <i className="ri-medal-fill text-amber-700"></i> :
                         <span className="text-[11px]">{i + 1}</span>}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-6 h-6 rounded-full ${conn.avatarColor} flex items-center justify-center text-[9px] font-bold text-white`}>{conn.initials}</span>
                          <span className={`text-[12px] font-medium ${conn.name === p.fullName ? 'text-primary-700 font-semibold' : 'text-foreground-900'}`}>
                            {conn.name} {conn.name === p.fullName && <span className="text-[9px] font-medium text-primary-400 ml-1">(You)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-center">
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-10 h-1 rounded-full bg-background-200 overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full" style={{ width: `${conn.progress}%` }}></div>
                          </div>
                          <span className="text-[11px] font-semibold text-foreground-700">{conn.progress}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-center">
                        <span className={`text-[12px] font-semibold ${conn.attendance >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>{conn.attendance}%</span>
                      </td>
                      <td className="py-2.5 text-center text-[11px] text-foreground-500">{conn.employer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  );
}