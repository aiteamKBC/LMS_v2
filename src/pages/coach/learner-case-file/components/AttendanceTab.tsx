import { useState, useEffect, useRef } from 'react';
import { LEARNER_PROFILE, ATTENDANCE_HEATMAP } from '@/mocks/learner-profile';

const p = LEARNER_PROFILE;
const ATTENDANCE_DETAIL = [
  { date: '4 Jun 2026', session: 'Customer Segmentation', module: 'Marketing Planning', mode: 'Live Online', status: 'Attended', duration: '2.5h' },
  { date: '2 Jun 2026', session: 'Marketing Environment', module: 'Marketing Principles', mode: 'Live Online', status: 'Absent', duration: '2.5h', catchUp: 'Completed' },
  { date: '28 May 2026', session: 'PESTLE Analysis', module: 'Marketing Principles', mode: 'Self-Paced', status: 'Attended', duration: '1.5h' },
  { date: '26 May 2026', session: 'Consumer Behaviour', module: 'Marketing Principles', mode: 'Self-Paced', status: 'Late', duration: '2.0h' },
  { date: '23 May 2026', session: 'Customer Insight', module: 'Marketing Principles', mode: 'Live Online', status: 'Attended', duration: '2.5h' },
  { date: '19 May 2026', session: 'Apprenticeship Induction', module: 'Induction', mode: 'Live Online', status: 'Attended', duration: '3.0h' },
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
  if (status === 'Attended') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'Absent') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Late') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
};

const getPixelColor = (status: string) => {
  switch (status) {
    case 'attended': return 'bg-emerald-500';
    case 'absent': return 'bg-red-500';
    case 'late': return 'bg-amber-500';
    case 'upcoming': return 'bg-background-200';
    default: return 'bg-background-100';
  }
};

const getPixelHoverBg = (status: string) => {
  switch (status) {
    case 'attended': return 'bg-emerald-600';
    case 'absent': return 'bg-red-600';
    case 'late': return 'bg-amber-600';
    case 'upcoming': return 'bg-background-300';
    default: return 'bg-background-200';
  }
};

export default function AttendanceTab() {
  const [hoveredCell, setHoveredCell] = useState<{week: string, day: string, date: string, status: string, sessions: number} | null>(null);

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  // Build flat cell array per week
  const weekCells = ATTENDANCE_HEATMAP.map(week => ({
    week: week.week,
    days: week.days,
  }));

  return (
    <div className="space-y-5">
      <AnimatedSection delay={0}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Attendance Rate', value: '86%', sub: 'Target: 90%', icon: 'ri-calendar-check-line', color: 'amber' as const },
            { label: 'Sessions Attended', value: '37', sub: `of ${p.sessionsAttended + p.sessionsMissed} total`, icon: 'ri-check-double-line', color: 'emerald' as const },
            { label: 'Sessions Missed', value: '6', sub: '2 with catch-up', icon: 'ri-close-circle-line', color: 'red' as const },
            { label: 'Current Streak', value: '3', sub: 'consecutive attended', icon: 'ri-fire-line', color: 'secondary' as const },
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

      <AnimatedSection delay={80}>
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-grid-line text-emerald-500"></i> Attendance Heat Map
              </h2>
              <div className="flex items-center gap-3 text-[10px] text-foreground-400">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-emerald-500"></span> Attended</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-red-500"></span> Absent</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-amber-500"></span> Late</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-background-200 border border-dashed border-foreground-300"></span> Upcoming</span>
              </div>
            </div>

            {/* ── Pixel Heat Map ── */}
            <div className="flex items-start gap-4">
              {/* Day labels */}
              <div className="flex flex-col gap-1 pt-6">
                {dayLabels.map(d => (
                  <span key={d} className="text-[10px] text-foreground-400 leading-[10px] h-[10px] flex items-center">{d}</span>
                ))}
              </div>

              <div className="flex-1 overflow-x-auto">
                {/* Month labels */}
                <div className="flex gap-1 mb-1">
                  {weekCells.map((week, wi) => {
                    const month = week.week.includes('May') ? 'May' : week.week.includes('Jun') ? 'Jun' : '';
                    return (
                      <span key={wi} className="text-[10px] text-foreground-400 w-[66px] text-center shrink-0">{month}</span>
                    );
                  })}
                </div>

                {/* Pixel grid */}
                <div className="flex gap-1">
                  {weekCells.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-1">
                      {week.days.map((day, di) => (
                        <div
                          key={di}
                          className={`w-[10px] h-[10px] rounded-[2px] ${getPixelColor(day.status)} cursor-default transition-all duration-150 hover:scale-125 hover:ring-1 hover:ring-white ${day.status !== 'no-session' ? 'shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : ''}`}
                          onMouseEnter={() => setHoveredCell({
                            week: week.week,
                            day: day.day,
                            date: day.date,
                            status: day.status,
                            sessions: day.sessions,
                          })}
                          onMouseLeave={() => setHoveredCell(null)}
                          title={`${day.date}: ${day.status} ${day.sessions > 0 ? `(${day.sessions} session${day.sessions > 1 ? 's' : ''})` : ''}`}
                        />
                      ))}
                    </div>
                  ))}
                </div>

                {/* Week labels */}
                <div className="flex gap-1 mt-1">
                  {weekCells.map((week, wi) => (
                    <span key={wi} className="text-[9px] text-foreground-400 w-[66px] text-center shrink-0">{week.week.split(' ')[0] + ' ' + week.week.split(' ')[1]}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Tooltip panel */}
            {hoveredCell && (
              <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-background-100/50 border border-foreground-200/60 animate-fadeInUp">
                <span className={`w-2.5 h-2.5 rounded-[2px] ${getPixelColor(hoveredCell.status)}`}></span>
                <span className="text-[11px] text-foreground-700 font-medium">
                  {hoveredCell.day} {hoveredCell.date} — {hoveredCell.status.charAt(0).toUpperCase() + hoveredCell.status.slice(1)}
                </span>
                {hoveredCell.sessions > 0 && (
                  <span className="text-[10px] text-foreground-400">{hoveredCell.sessions} session{hoveredCell.sessions > 1 ? 's' : ''}</span>
                )}
              </div>
            )}

            {/* Stats row */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'May Sessions', value: '14', total: '14', status: 'attended' },
                { label: 'Jun Sessions', value: '6', total: '10', status: 'attended' },
                { label: 'Late Entries', value: '1', total: '', status: 'late' },
                { label: 'Absences', value: '2', total: '', status: 'absent' },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-background-100/40">
                  <span className={`w-2 h-2 rounded-[2px] ${getPixelColor(s.status)}`}></span>
                  <div>
                    <p className="text-[11px] font-semibold text-foreground-900">{s.value}{s.total && <span className="text-foreground-400 font-normal">/{s.total}</span>}</p>
                    <p className="text-[9px] text-foreground-400">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={140}>
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-5 md:p-6">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
              <i className="ri-bar-chart-grouped-line text-primary-500"></i> Weekly Attendance Breakdown
            </h2>
            <div className="flex items-end gap-3 h-32 px-2">
              {[
                { label: 'Wk 1', attended: 6, late: 0, absent: 0, total: 6 },
                { label: 'Wk 2', attended: 5, late: 1, absent: 0, total: 6 },
                { label: 'Wk 3', attended: 3, late: 0, absent: 2, total: 5 },
                { label: 'Wk 4', attended: 2, late: 0, absent: 0, total: 5, upcoming: true },
              ].map((wk, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex flex-col-reverse" style={{ height: '100px' }}>
                    {wk.absent > 0 && <div className="w-full bg-red-400 rounded-t-sm" style={{ height: `${(wk.absent / wk.total) * 100}%` }}></div>}
                    {wk.late > 0 && <div className="w-full bg-amber-400" style={{ height: `${(wk.late / wk.total) * 100}%` }}></div>}
                    <div className={`w-full rounded-sm ${wk.upcoming ? 'bg-background-200 border border-dashed border-foreground-300' : 'bg-emerald-400'}`} style={{ height: `${(wk.attended / wk.total) * 100}%` }}></div>
                  </div>
                  <span className="text-[10px] text-foreground-400 font-medium">{wk.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={200}>
        <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-list-check text-secondary-500"></i> Detailed Attendance Log
              </h2>
              <span className="text-[11px] text-foreground-400">{p.sessionsAttended} of {p.sessionsAttended + p.sessionsMissed} sessions</span>
            </div>
            <div className="divide-y divide-background-200/30">
              {ATTENDANCE_DETAIL.map((rec, i) => (
                <div key={i} className="p-3 flex items-center gap-3 hover:bg-background-100/30 transition-all">
                  <span className="text-[11px] text-foreground-400 shrink-0 w-20">{rec.date}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground-900">{rec.session}</p>
                    <p className="text-[10px] text-foreground-400">{rec.module} · {rec.mode} · {rec.duration}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getStatusClass(rec.status)}`}>{rec.status}</span>
                  {'catchUp' in rec && rec.catchUp && (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 border border-primary-200/60">{rec.catchUp}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  );
}