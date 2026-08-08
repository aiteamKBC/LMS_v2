import { MAY_STAGES, JUNE_STAGES, JULY_STAGES, MONTHS_META } from '@/mocks/monthly-cycle';

interface MonthlyJourneyTimelineProps {
  activeMonth: string;
  onMonthChange: (month: string) => void;
}

const stageStyle: Record<string, { dot: string; line: string; label: string; labelBg: string; labelColor: string }> = {
  completed: { dot: 'bg-foreground-900 border-foreground-900', line: 'bg-foreground-900', label: 'Completed', labelBg: 'bg-foreground-900', labelColor: 'text-white' },
  'in-progress': { dot: 'bg-primary-500 border-primary-300 ring-2 ring-primary-200', line: 'bg-primary-300', label: 'In Progress', labelBg: 'bg-primary-100', labelColor: 'text-primary-700' },
  'not-started': { dot: 'bg-background-50 border-background-300', line: 'bg-background-200', label: 'Not Started', labelBg: 'bg-background-100', labelColor: 'text-foreground-400' },
  pending: { dot: 'bg-background-50 border-amber-300', line: 'bg-background-200', label: 'Upcoming', labelBg: 'bg-amber-50', labelColor: 'text-amber-700' },
  locked: { dot: 'bg-background-50 border-foreground-200', line: 'bg-background-200', label: 'Locked', labelBg: 'bg-background-100', labelColor: 'text-foreground-400' },
};

const monthDates: Record<string, string> = {
  may: 'Assignment due 20/05/2026 · Coaching window 21/05/2026–31/05/2026',
  jun: 'Assignment due 20/06/2026 · Coaching window 21/06/2026–30/06/2026',
  jul: 'Assignment due 20/07/2026 · Coaching window 21/07/2026–31/07/2026',
};

const monthStages: Record<string, typeof JUNE_STAGES> = {
  may: MAY_STAGES,
  jun: JUNE_STAGES,
  jul: JULY_STAGES,
};

export default function MonthlyJourneyTimeline({ activeMonth, onMonthChange }: MonthlyJourneyTimelineProps) {
  const activeMonthLabel = MONTHS_META.find(m => m.key === activeMonth)?.label || 'June 2026';
  const stages = monthStages[activeMonth] || JUNE_STAGES;
  const dates = monthDates[activeMonth] || monthDates.jun;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="p-5 border-b border-foreground-400/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">{activeMonthLabel} — monthly journey</h3>
          <p className="text-sm text-foreground-400 mt-0.5">{dates}</p>
        </div>

        {/* Month Selector Tabs */}
        <div className="flex items-center gap-2 shrink-0">
          {MONTHS_META.map(m => (
            <button
              key={m.key}
              onClick={() => onMonthChange(m.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                activeMonth === m.key
                  ? m.current ? 'bg-primary-500 text-white' : 'bg-foreground-900 text-white'
                  : m.status === 'completed' ? 'bg-background-100 text-foreground-500 hover:bg-background-200' : 'bg-background-100 text-foreground-400 hover:bg-background-200'
              }`}
            >
              {m.label}
              {m.current && activeMonth === m.key && <span className="ml-1.5 text-[8px] font-bold bg-white/20 px-1 py-0.5 rounded-full">In progress</span>}
              {m.status === 'completed' && activeMonth === m.key && !m.current && <span className="ml-1.5 text-[8px] font-bold bg-white/20 px-1 py-0.5 rounded-full">complete</span>}
              {m.status === 'not-started' && activeMonth === m.key && <span className="ml-1.5 text-[8px] font-bold bg-foreground-200 text-foreground-400 px-1 py-0.5 rounded-full">Not started</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        <div className="relative">
          {/* Horizontal connector line */}
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-background-200 hidden sm:block"></div>

          <div className="flex flex-col sm:flex-row sm:justify-between gap-0">
            {stages.map((stage, i) => {
              const s = stageStyle[stage.status];
              const isCurrent = stage.status === 'in-progress';

              return (
                <div key={stage.id} className="relative flex sm:flex-col items-start sm:items-center gap-3 sm:gap-2 group">
                  {/* Connector line to next (mobile vertical) */}
                  {i < stages.length - 1 && (
                    <div className={`sm:hidden absolute left-[13px] top-8 w-0.5 h-full ${s.line}`}></div>
                  )}

                  {/* Dot */}
                  <div className={`relative z-10 w-[26px] h-[26px] sm:w-10 sm:h-10 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300 ${s.dot} ${isCurrent ? 'animate-pulse-slow' : ''}`}>
                    {stage.status === 'completed' && <AppIcon className="ri-check-line text-white text-[10px] sm:text-sm"></AppIcon>}
                    {stage.status === 'in-progress' && <AppIcon className="ri-arrow-right-line text-primary-500 text-[10px] sm:text-sm"></AppIcon>}
                    {stage.status === 'locked' && <AppIcon className="ri-lock-line text-foreground-300 text-[8px] sm:text-xs"></AppIcon>}
                    {stage.status === 'not-started' && <span className="text-[8px] sm:text-[10px] font-bold text-foreground-300">{i + 1}</span>}
                    {stage.status === 'pending' && <span className="text-[8px] sm:text-[10px] font-bold text-amber-500">{i + 1}</span>}
                  </div>

                  {/* Content */}
                  <div className="flex-1 sm:flex-none sm:text-center sm:mt-2 min-w-0 pb-3 sm:pb-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.labelBg} ${s.labelColor}`}>{s.label}</span>
                    <p className="text-xs font-semibold text-foreground-800 mt-1">{stage.step}</p>
                    <p className="text-[11px] text-foreground-400 mt-0.5 hidden sm:block max-w-[120px]">{stage.description}</p>
                    <p className="text-[10px] text-foreground-300 mt-0.5">{stage.date}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}