import { UPCOMING_SESSIONS } from '@/mocks/attendance';

const typeBadge: Record<string, string> = {
  Live: 'bg-primary-100 text-primary-700',
  Coaching: 'bg-accent-100 text-accent-700',
  Workshop: 'bg-amber-100 text-amber-700',
  'Progress Review': 'bg-emerald-100 text-emerald-700',
};

export default function UpcomingSessions() {
  return (
    <section className="bg-background-50 rounded-2xl border border-background-200/60 overflow-hidden">
      <div className="p-4 border-b border-background-200/60 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-xl bg-accent-100 flex items-center justify-center">
          <i className="ri-calendar-event-line text-accent-600 text-sm"></i>
        </span>
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Upcoming</h3>
      </div>
      <div className="divide-y divide-background-200/50">
        {UPCOMING_SESSIONS.slice(0, 3).map((s) => (
          <div key={s.id} className="p-3.5 hover:bg-background-100/40 transition-all">
            <div className="flex items-start gap-3">
              <div className="text-center shrink-0 w-10">
                <p className="text-[10px] text-foreground-400 font-semibold uppercase">{s.day}</p>
                <p className="text-sm font-bold text-foreground-900">{s.date}</p>
                <p className="text-[10px] text-foreground-400">{s.time}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="text-xs font-semibold text-foreground-900">{s.title}</p>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${typeBadge[s.type] || 'bg-background-100 text-foreground-400'}`}>
                    {s.type}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-foreground-400 flex-wrap">
                  <span className="flex items-center gap-1"><i className="ri-book-open-line text-[10px]"></i> {s.module}</span>
                </div>
              </div>
              <a href={s.teamsLink} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer">
                <i className="ri-links-line text-[10px]"></i> Join
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}