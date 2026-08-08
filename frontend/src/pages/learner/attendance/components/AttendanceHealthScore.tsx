import { ATTENDANCE_HEALTH } from '@/mocks/attendance';

const healthConfig: Record<string, { label: string; ring: string }> = {
  excellent: { label: 'Excellent', ring: 'text-emerald-500' },
  good: { label: 'Good Standing', ring: 'text-emerald-500' },
  'needs-attention': { label: 'Needs Attention', ring: 'text-amber-500' },
  'at-risk': { label: 'At Risk', ring: 'text-red-500' },
};

export default function AttendanceHealthScore() {
  const h = ATTENDANCE_HEALTH;
  const config = healthConfig[h.statusLevel];
  const r = 30;
  const circ = 2 * Math.PI * r;
  const offset = circ - (h.factors.attendanceRate / 100) * circ;

  return (
    <section className="bg-background-50 rounded-2xl border border-background-200/60 overflow-hidden">
      <div className="p-4 border-b border-background-200/60 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
            <AppIcon className="ri-heart-pulse-line text-emerald-600 text-sm"></AppIcon>
          </span>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Health</h3>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{config.label}</span>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <svg className="w-16 h-16 -rotate-90">
              <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-background-200" />
              <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"
                className={config.ring}
                strokeDasharray={`${circ} ${circ}`}
                strokeDashoffset={offset}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground-900">{h.factors.attendanceRate}%</span>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-1.5">
            <div className="text-center bg-background-100/50 rounded-lg p-2">
              <p className="text-xs font-semibold text-foreground-900">{h.factors.missedSessions}</p>
              <p className="text-[10px] text-foreground-400">Missed</p>
            </div>
            <div className="text-center bg-background-100/50 rounded-lg p-2">
              <p className="text-xs font-semibold text-foreground-900">{h.factors.outstandingCatchUps}</p>
              <p className="text-[10px] text-foreground-400">Outstanding</p>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-foreground-500 mt-3 leading-relaxed">{h.summary}</p>
      </div>
    </section>
  );
}