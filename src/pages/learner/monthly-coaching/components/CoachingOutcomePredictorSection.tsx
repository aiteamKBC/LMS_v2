import { COACHING_OUTCOME_PREDICTOR } from '@/mocks/monthly-coaching';

export default function CoachingOutcomePredictorSection() {
  const o = COACHING_OUTCOME_PREDICTOR;

  const outcomeStyle = {
    Green: { text: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500' },
    Amber: { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
    Red: { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500' },
  };
  const os = outcomeStyle[o.outcome];

  const riskLevelStyle = {
    low: { text: 'text-green-700', bg: 'bg-green-100' },
    medium: { text: 'text-amber-700', bg: 'bg-amber-100' },
    high: { text: 'text-red-700', bg: 'bg-red-100' },
  };

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
            <i className="ri-bar-chart-box-line text-accent-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Coaching Outcome Predictor</h2>
        </div>

        {/* Outcome Banner */}
        <div className={`rounded-xl border ${os.border} ${os.bg} p-5 mb-6`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-4 h-4 rounded-full ${os.dot}`} />
            <p className="text-sm font-medium text-foreground-500">Expected Coaching Outcome</p>
          </div>
          <p className={`text-2xl font-bold font-heading ${os.text} mb-2`}>{o.outcomeLabel}</p>
          <p className="text-sm text-foreground-600 leading-relaxed">{o.message}</p>
        </div>

        {/* Risks Grid */}
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-3">Key Risks</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {o.risks.map((risk, i) => {
              const rs = riskLevelStyle[risk.level];
              return (
                <div key={i} className="flex items-start gap-3 p-4 rounded-xl border border-background-200/50 bg-background-100/30">
                  <div className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center shrink-0">
                    <i className={`${risk.icon} text-foreground-500`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-foreground-800">{risk.label}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rs.bg} ${rs.text}`}>
                        {risk.level}
                      </span>
                    </div>
                    <p className="text-xs text-foreground-500">{risk.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recommendations */}
        <div className="rounded-xl border border-primary-200/50 bg-primary-50/20 p-4">
          <h3 className="text-xs font-semibold text-primary-600 uppercase tracking-wide mb-3">Recommendations</h3>
          <ul className="space-y-2">
            {o.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-primary-800">
                <i className="ri-arrow-right-line text-primary-600 mt-0.5 shrink-0" />
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}