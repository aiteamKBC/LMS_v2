import { ATTENDANCE_STATS } from '@/mocks/attendance';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';

interface AttendanceHeroProps {
  missedCount: number;
  attendedCount: number;
  onReportAbsence: () => void;
}

export default function AttendanceHero({ missedCount, attendedCount, onReportAbsence }: AttendanceHeroProps) {
  const p = LEARNER_PROFILE;
  const s = ATTENDANCE_STATS;
  const gap = s.target - s.currentRate;
  const isOnTarget = s.currentRate >= s.target;

  const statusLabel = s.currentRate >= 90 ? 'Excellent' : s.currentRate >= 85 ? 'Good Standing' : s.currentRate >= 75 ? 'Needs Attention' : 'At Risk';
  const statusBg = s.currentRate >= 90 ? 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/20' :
                  s.currentRate >= 85 ? 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/20' :
                  s.currentRate >= 75 ? 'bg-amber-400/15 text-amber-300 border border-amber-400/20' :
                  'bg-red-400/15 text-red-300 border border-red-400/20';

  const donutColor = isOnTarget ? '#10b981' : s.currentRate >= 75 ? '#f59e0b' : '#ef4444';
  const r = 42;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(s.currentRate, 100) / 100) * circ;

  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute opacity-20" style={{ width: '55%', height: '28%', left: '-8%', top: '-8%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.25) 0%, transparent 70%)', filter: 'blur(55px)' }} />
        <div className="absolute opacity-12" style={{ width: '65%', height: '32%', right: '-12%', top: '12%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.18) 0%, transparent 70%)', filter: 'blur(50px)' }} />
      </div>
      <div className="relative p-6 md:p-8 flex flex-col lg:flex-row items-start lg:items-center gap-6 lg:gap-10">
        {/* Left — title + stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md font-label border border-accent-400/15">
              {p.programme} · {p.programmeLevel}
            </span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusBg}`}>
              {statusLabel}
            </span>
          </div>
          <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">Attendance</h1>
          <p className="text-sm text-white/40 max-w-lg mb-4">
            Target {s.target}% · Current {s.currentRate}% · {isOnTarget ? 'On target' : `${gap}% below target`} · {s.catchUpOutstanding} catch-up outstanding
          </p>
          {/* Stats inline */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onReportAbsence}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white/90 text-xs font-medium hover:bg-white/20 transition-all whitespace-nowrap cursor-pointer border border-white/10"
            >
              <i className="ri-calendar-close-line text-xs"></i> Report Absence
            </button>
            <a href="/learner/catchup" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white/90 text-xs font-medium hover:bg-white/20 transition-all whitespace-nowrap cursor-pointer border border-white/10">
              <i className="ri-timer-flash-line text-xs"></i> Catch-Up Hub
            </a>
            <a href="/learner/profile" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white/90 text-xs font-medium hover:bg-white/20 transition-all whitespace-nowrap cursor-pointer border border-white/10">
              <i className="ri-user-line text-xs"></i> Profile
            </a>
          </div>
        </div>

        {/* Right — donut + mini stats */}
        <div className="flex items-center gap-5 lg:gap-6 shrink-0">
          <div className="relative">
            <svg width="100" height="100" className="-rotate-90">
              <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
              <circle cx="50" cy="50" r={r} fill="none" stroke={donutColor} strokeWidth="8" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} className="transition-all duration-700 ease-out" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-heading font-bold text-white">{s.currentRate}%</span>
              <span className="text-[10px] text-white/50 font-medium">Attendance</span>
            </div>
          </div>
          <div className="w-px h-12 bg-white/10 hidden sm:block" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              <span className="w-2 h-2 rounded-full bg-emerald-400/80" />
              <span className="text-white/80 font-medium">{attendedCount}</span> Attended
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              <span className="w-2 h-2 rounded-full bg-red-400/80" />
              <span className="text-white/80 font-medium">{missedCount}</span> Missed
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              <span className="w-2 h-2 rounded-full bg-amber-400/80" />
              <span className="text-white/80 font-medium">{s.catchUpOutstanding}</span> Outstanding
            </div>
          </div>
        </div>
      </div>

      {/* Bottom stats strip */}
      <div className="relative bg-black/20 border-t border-white/5 px-6 md:px-8 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span className="text-white/90 font-medium">{s.currentRate}%</span>
          <span>Rate</span>
        </div>
        <div className="w-px h-3 bg-white/10 hidden sm:block" />
        <div className="flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="text-white/90 font-medium">{attendedCount}</span>
          <span>of {s.totalSessions} sessions</span>
        </div>
        <div className="w-px h-3 bg-white/10 hidden sm:block" />
        <div className="flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="text-white/90 font-medium">{s.catchUpCompleted}</span>
          <span>catch-ups done</span>
        </div>
        <div className="w-px h-3 bg-white/10 hidden sm:block" />
        <div className="flex items-center gap-1.5 text-[11px] text-white/60">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
          <span className="text-white/90 font-medium">{s.catchUpOutstanding}</span>
          <span>outstanding</span>
        </div>
      </div>
    </div>
  );
}