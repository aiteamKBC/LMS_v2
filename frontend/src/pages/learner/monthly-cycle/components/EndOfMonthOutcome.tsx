import { MAY_OUTCOME, JUNE_OUTCOME, JULY_OUTCOME, MAY_HEALTH, JUNE_HEALTH, JULY_HEALTH } from '@/mocks/monthly-cycle';

interface EndOfMonthOutcomeProps {
  month: string;
}

const statusConfig: Record<string, { color: string; bg: string; dot: string }> = {
  'On Track': { color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
  'Behind': { color: 'text-amber-700', bg: 'bg-amber-50', dot: 'bg-amber-500' },
};

const healthMap: Record<string, typeof JUNE_HEALTH> = {
  may: MAY_HEALTH,
  jun: JUNE_HEALTH,
  jul: JULY_HEALTH,
};

const outcomeMap: Record<string, typeof JUNE_OUTCOME> = {
  may: MAY_OUTCOME,
  jun: JUNE_OUTCOME,
  jul: JULY_OUTCOME,
};

export default function EndOfMonthOutcome({ month }: EndOfMonthOutcomeProps) {
  const h = healthMap[month] || JUNE_HEALTH;
  const o = outcomeMap[month] || JUNE_OUTCOME;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      {/* Monthly Health Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5 pb-4 border-b border-background-200/50">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${h.status === 'On Track' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
          <AppIcon className={`text-lg ${h.status === 'On Track' ? 'ri-check-double-line text-emerald-600' : 'ri-error-warning-line text-amber-600'}`}></AppIcon>
        </div>
        <div className="flex-1">
          <p className={`text-sm font-heading font-semibold ${h.status === 'On Track' ? 'text-emerald-800' : 'text-amber-800'}`}>{h.label}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{h.message}</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${h.status === 'On Track' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {h.status}
        </span>
      </div>

      {/* End of Month Outcome */}
      <div className="flex items-center gap-2 mb-3">
        <AppIcon className="ri-flag-line text-foreground-600 text-sm"></AppIcon>
        <h3 className="text-sm font-heading font-semibold text-foreground-900">End of Month Outcome</h3>
      </div>
      <p className="text-xs text-foreground-400 mb-3">{o.summary}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {o.outcomes.map((item) => {
          const sc = statusConfig[item.status];
          return (
            <div key={item.label} className="p-3 rounded-lg border border-background-200/50 bg-background-50/50">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-6 h-6 rounded-md bg-background-100 flex items-center justify-center shrink-0">
                  <AppIcon className={`${item.icon} text-foreground-500 text-xs`}></AppIcon>
                </div>
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}></span>
              </div>
              <p className="text-xs font-semibold text-foreground-800">{item.label}</p>
              <p className="text-xs text-foreground-500 mt-0.5">{item.projected}</p>
              <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1.5 ${sc.bg} ${sc.color}`}>{item.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}