import { ATTENDANCE_TIMELINE } from '@/mocks/attendance';

const badgeMap: Record<string, string> = {
  Attended: 'bg-emerald-100 text-emerald-700',
  Late: 'bg-amber-100 text-amber-700',
  Missed: 'bg-red-100 text-red-700',
  CatchUpComplete: 'bg-primary-100 text-primary-700',
  RecordingComplete: 'bg-accent-100 text-accent-700',
};

const iconMap: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-600',
  amber: 'bg-amber-100 text-amber-600',
  red: 'bg-red-100 text-red-600',
  primary: 'bg-primary-100 text-primary-600',
  accent: 'bg-accent-100 text-accent-600',
};

export default function AttendanceTimeline() {
  return (
    <section className="bg-background-50 rounded-2xl border border-background-200/60 overflow-hidden">
      <div className="p-5 border-b border-background-200/60 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center">
            <i className="ri-history-line text-primary-600 text-base"></i>
          </span>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">History</h3>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-foreground-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Attended</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Late</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Missed</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {ATTENDANCE_TIMELINE.map((entry, i) => (
            <div key={entry.id}
              className="flex items-center gap-4 px-5 py-3 border-b border-background-200/50 last:border-b-0 hover:bg-background-100/40 transition-all"
            >
              {/* Timeline dot + line */}
              <div className="relative flex items-center justify-center shrink-0 w-4">
                <div className={`w-2.5 h-2.5 rounded-full ring-2 ring-offset-1 ring-offset-background-50 ${
                  entry.color === 'emerald' ? 'bg-emerald-500 ring-emerald-200' :
                  entry.color === 'amber' ? 'bg-amber-500 ring-amber-200' :
                  entry.color === 'red' ? 'bg-red-500 ring-red-200' :
                  entry.color === 'primary' ? 'bg-primary-500 ring-primary-200' :
                  'bg-accent-500 ring-accent-200'
                }`} />
                {i < ATTENDANCE_TIMELINE.length - 1 && (
                  <div className="absolute top-full w-px h-6 bg-background-200" />
                )}
              </div>
              {/* Icon */}
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconMap[entry.color] || 'bg-background-100 text-foreground-400'}`}>
                <i className={`${entry.icon} text-[13px]`}></i>
              </span>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground-900">{entry.title}</p>
                <p className="text-xs text-foreground-400 mt-0.5">{entry.module}</p>
              </div>
              {/* Date */}
              <div className="shrink-0 text-right">
                <p className="text-xs text-foreground-500 font-medium">{entry.date}</p>
                <p className="text-[11px] text-foreground-400">{entry.day}</p>
              </div>
              {/* Badge */}
              <span className={`shrink-0 text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${badgeMap[entry.type] || 'bg-background-100 text-foreground-500'}`}>
                {entry.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}