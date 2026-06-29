import { ATTENDANCE_INSIGHTS } from '@/mocks/attendance';

export default function AttendanceInsights() {
  const i = ATTENDANCE_INSIGHTS;

  return (
    <section className="bg-background-50 rounded-2xl border border-background-200/60 overflow-hidden">
      <div className="p-5 border-b border-background-200/60 flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-accent-100 flex items-center justify-center">
          <i className="ri-bar-chart-grouped-line text-accent-600 text-base"></i>
        </span>
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Insights</h3>
      </div>
      <div className="p-5 space-y-5">
        {/* By Module */}
        <div>
          <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">By Module</p>
          <div className="space-y-2.5">
            {i.byModule.map((mod) => (
              <div key={mod.module} className="flex items-center gap-3">
                <span className="text-xs text-foreground-500 w-32 shrink-0 truncate">{mod.module}</span>
                <div className="flex-1 h-2 rounded-full bg-background-200 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${mod.rate >= 90 ? 'bg-emerald-500' : mod.rate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${mod.rate}%` }} />
                </div>
                <span className={`text-xs font-semibold w-9 text-right ${mod.rate >= 90 ? 'text-emerald-600' : mod.rate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{mod.rate}%</span>
                <span className="text-[10px] text-foreground-400 w-12 text-right">{mod.missed}/{mod.sessions}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By Session Type */}
        <div>
          <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">By Session Type</p>
          <div className="space-y-2.5">
            {i.bySessionType.map((st) => (
              <div key={st.type} className="flex items-center gap-3">
                <span className="text-xs text-foreground-500 w-24 shrink-0 truncate">{st.type}</span>
                <div className="flex-1 h-2 rounded-full bg-background-200 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${st.rate >= 90 ? 'bg-emerald-500' : st.rate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${st.rate}%` }} />
                </div>
                <span className={`text-xs font-semibold w-9 text-right ${st.rate >= 90 ? 'text-emerald-600' : st.rate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{st.rate}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-50/50 rounded-xl border border-emerald-200/40 p-3 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <i className="ri-star-line text-emerald-600 text-sm"></i>
            </span>
            <div>
              <p className="text-[11px] text-foreground-400">Best Module</p>
              <p className="text-sm font-semibold text-foreground-900">{i.bestModule}</p>
            </div>
          </div>
          <div className="bg-amber-50/50 rounded-xl border border-amber-200/40 p-3 flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <i className="ri-error-warning-line text-amber-600 text-sm"></i>
            </span>
            <div>
              <p className="text-[11px] text-foreground-400">Most Missed</p>
              <p className="text-sm font-semibold text-foreground-900">{i.mostMissedType}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}