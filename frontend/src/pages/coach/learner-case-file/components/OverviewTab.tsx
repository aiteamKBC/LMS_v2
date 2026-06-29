import { useState, useEffect, useRef } from 'react';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';

const p = LEARNER_PROFILE;

const PROGRESS_HISTORY = [
  { month: 'May 2026', progress: 28, attendance: 90, otjh: 22, ksb: 15 },
  { month: 'Jun 2026', progress: 42, attendance: 86, otjh: 16, ksb: 23 },
  { month: 'Jul 2026', progress: 55, attendance: 88, otjh: 20, ksb: 32, projected: true },
  { month: 'Aug 2026', progress: 65, attendance: 92, otjh: 22, ksb: 42, projected: true },
  { month: 'Sep 2026', progress: 75, attendance: 90, otjh: 20, ksb: 52, projected: true },
  { month: 'Oct 2026', progress: 85, attendance: 91, otjh: 18, ksb: 62, projected: true },
];

const REVIEWS = [
  { date: '25 Jun 2026', type: 'Monthly Progress Review', period: 'June 2026', coach: 'Med Maher', status: 'Scheduled' },
  { date: '28 May 2026', type: 'Monthly Progress Review', period: 'May 2026', coach: 'Med Maher', status: 'Awaiting Employer' },
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
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

const getStatusClass = (status: string) => {
  if (status === 'Validated' || status === 'Accepted' || status === 'Complete' || status === 'Attended') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'In Progress' || status === 'Submitted' || status === 'Scheduled') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'Absent' || status === 'Referred') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
};

export default function OverviewTab() {
  return (
    <div className="space-y-5">
      {/* Quick Stats Bar */}
      <AnimatedSection delay={0}>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: 'Progress', value: `${p.overallProgress}%`, icon: 'ri-pie-chart-line', color: 'primary' },
            { label: 'Attendance', value: `${p.attendanceRate}%`, icon: 'ri-calendar-check-line', color: 'accent' },
            { label: 'OTJH', value: `${p.otjhCompleted}h`, icon: 'ri-time-line', color: 'secondary' },
            { label: 'KSB', value: `${p.ksbProgress}%`, icon: 'ri-bar-chart-2-line', color: 'emerald' },
            { label: 'Evidence', value: `${p.evidenceCount}`, icon: 'ri-folder-upload-line', color: 'primary' },
            { label: 'Points', value: `${p.pointsBalance}`, icon: 'ri-star-line', color: 'accent' },
          ].map((stat, i) => (
            <div key={i} className="bg-background-50 rounded-xl border border-background-200/50 p-3 text-center hover:border-background-300/60 transition-all cursor-default group" style={{ animationDelay: `${i * 0.06}s`, animation: 'fadeInUp 0.5s ease-out both' }}>
              <div className={`w-8 h-8 mx-auto rounded-lg bg-${stat.color}-100 text-${stat.color}-600 flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform`}>
                <i className={`${stat.icon} text-sm`}></i>
              </div>
              <p className="text-base font-heading font-bold text-foreground-900">{stat.value}</p>
              <p className="text-[10px] text-foreground-400">{stat.label}</p>
            </div>
          ))}
        </div>
      </AnimatedSection>

      {/* About */}
      <AnimatedSection delay={80}>
        <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-user-line text-primary-500"></i> About
              </h2>
              <button className="text-[12px] text-primary-600 hover:text-primary-700 font-medium cursor-pointer whitespace-nowrap flex items-center gap-1">
                <i className="ri-edit-line text-xs"></i> Edit
              </button>
            </div>
            <p className="text-[13px] text-foreground-600 leading-relaxed">
              {p.firstName} is a dedicated <strong>Marketing Executive Level 4 Apprentice</strong> at <strong>{p.employer}</strong>, currently in Week {p.currentWeek} of the programme. Enrolled since {p.startDate}, with a planned end date of {p.plannedEndDate}. 
              {p.firstName} is progressing through the apprenticeship standard <strong>{p.standardCode}</strong>, focusing on marketing principles, campaign planning, and customer segmentation strategies. 
              With a <strong>{p.learningStyle}</strong> learning style preference, {p.firstName} demonstrates strong engagement in visual and reading/writing-based activities.
            </p>
          </div>
        </section>
      </AnimatedSection>

      {/* Programme Progress */}
      <AnimatedSection delay={140}>
        <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-line-chart-line text-primary-500"></i> Programme Progress
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-background-200">
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Month</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Progress</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Attendance</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">OTJH</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">KSB</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {PROGRESS_HISTORY.map((m, i) => (
                    <tr key={i} className="border-b border-background-100 hover:bg-background-100/30 transition-all">
                      <td className="py-3 text-[13px] font-medium text-foreground-900">{m.month}</td>
                      <td className="py-3 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-14 h-1.5 rounded-full bg-background-200 overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full transition-all duration-700" style={{ width: `${m.progress}%` }}></div>
                          </div>
                          <span className="text-[12px] font-semibold text-foreground-700">{m.progress}%</span>
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        <span className={`text-[12px] font-semibold ${m.attendance >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>{m.attendance}%</span>
                      </td>
                      <td className="py-3 text-center text-[12px] text-foreground-600">{m.otjh}h</td>
                      <td className="py-3 text-center text-[12px] text-foreground-600">{m.ksb}%</td>
                      <td className="py-3 text-center">
                        {('projected' in m && m.projected) ? (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 border border-primary-200/60">Projected</span>
                        ) : (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60">Actual</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Reviews */}
      <AnimatedSection delay={200}>
        <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-file-chart-line text-secondary-500"></i> Progress Reviews
              </h2>
            </div>
            <div className="space-y-3">
              {REVIEWS.map((r, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-background-100/60 border border-foreground-200/60 hover:border-primary-200/50 transition-all cursor-pointer">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${r.status === 'Awaiting Employer' ? 'bg-amber-100 text-amber-600' : 'bg-primary-100 text-primary-600'}`}>
                    <i className="ri-file-chart-line text-base"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{r.type}</p>
                    <p className="text-[11px] text-foreground-400">Period: {r.period} · Coach: {r.coach}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${getStatusClass(r.status)}`}>{r.status}</span>
                  <span className="text-[12px] text-foreground-400">{r.date}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  );
}