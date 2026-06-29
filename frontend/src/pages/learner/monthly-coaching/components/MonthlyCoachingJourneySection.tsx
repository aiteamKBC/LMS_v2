import { COACHING_JOURNEY } from '@/mocks/monthly-coaching';

export default function MonthlyCoachingJourneySection() {
  const j = COACHING_JOURNEY;

  const statusStyle = {
    completed: { bg: 'bg-primary-500', text: 'text-white', border: 'border-primary-500', icon: 'ri-check-line' },
    current: { bg: 'bg-accent-500', text: 'text-white', border: 'border-accent-500', icon: 'ri-loader-4-line' },
    pending: { bg: 'bg-background-200', text: 'text-foreground-400', border: 'border-background-300', icon: 'ri-circle-line' },
  };

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
            <i className="ri-route-line text-primary-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Monthly Coaching Journey</h2>
        </div>

        {/* Journey Flow */}
        <div className="flex flex-col md:flex-row items-stretch gap-2 md:gap-0">
          {j.map((stage, index) => {
            const s = statusStyle[stage.status];
            const isLast = index === j.length - 1;
            return (
              <div key={stage.id} className="flex-1 min-w-0 flex flex-col md:flex-row items-center">
                {/* Step */}
                <div className="flex flex-col items-center text-center flex-1 min-w-0 px-2">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${s.bg}`}>
                    <i className={`${s.icon} ${s.text} text-lg`} />
                  </div>
                  <h3 className={`text-sm font-semibold mb-1 ${
                    stage.status === 'current' ? 'text-accent-700' : stage.status === 'completed' ? 'text-foreground-500' : 'text-foreground-400'
                  }`}>
                    {stage.label}
                  </h3>
                  <p className="text-xs text-foreground-400 leading-relaxed">{stage.description}</p>
                  {stage.status === 'current' && (
                    <span className="mt-2 text-xs font-semibold text-accent-700 bg-accent-100 px-2 py-0.5 rounded-full">
                      Current Stage
                    </span>
                  )}
                </div>

                {/* Arrow */}
                {!isLast && (
                  <div className="hidden md:flex items-center justify-center px-2 shrink-0">
                    <i className="ri-arrow-right-line text-foreground-300 text-xl" />
                  </div>
                )}
                {!isLast && (
                  <div className="md:hidden flex items-center justify-center py-2">
                    <i className="ri-arrow-down-line text-foreground-300 text-xl" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}