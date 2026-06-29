import { EVIDENCE_COVERAGE } from '@/mocks/gateway-readiness';

export function EvidenceCoverage() {
  const getColor = (color: string) => {
    if (color === 'primary') return 'bg-primary-500';
    if (color === 'accent') return 'bg-accent-500';
    return 'bg-secondary-500';
  };

  const getTextColor = (color: string) => {
    if (color === 'primary') return 'text-primary-700';
    if (color === 'accent') return 'text-accent-700';
    return 'text-secondary-700';
  };

  const getBgColor = (color: string) => {
    if (color === 'primary') return 'bg-primary-100';
    if (color === 'accent') return 'bg-accent-100';
    return 'bg-secondary-100';
  };

  const maxPieces = Math.max(...EVIDENCE_COVERAGE.map(c => c.pieces));

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
          <i className="ri-pie-chart-line text-accent-700"></i>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Evidence Coverage Analysis</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Evidence distribution across KSB categories</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {EVIDENCE_COVERAGE.map(cat => {
          const pct = Math.round((cat.pieces / maxPieces) * 100);
          const isWeak = cat.pieces < 10;
          return (
            <div key={cat.category} className="bg-background-100/50 rounded-lg p-3.5 border border-background-200/30">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-7 h-7 rounded-lg ${getBgColor(cat.color)} flex items-center justify-center`}>
                  <i className={`${cat.icon} text-sm ${getTextColor(cat.color)}`}></i>
                </span>
                <span className="text-sm font-semibold text-foreground-900">{cat.category}</span>
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-bold text-foreground-900">{cat.pieces}</span>
                <span className="text-xs text-foreground-400">Pieces</span>
              </div>
              <div className="h-2 rounded-full bg-background-200 overflow-hidden">
                <div className={`h-2 rounded-full ${getColor(cat.color)} transition-all duration-700`} style={{ width: `${pct}%` }}></div>
              </div>
              {isWeak && (
                <div className="mt-2 flex items-center gap-1 text-[9px] text-red-700 bg-red-50 rounded-md px-2 py-1">
                  <i className="ri-error-warning-line"></i>
                  <span>Weak area — needs more evidence</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 bg-background-100 rounded-lg p-3 border border-background-200/30">
        <p className="text-xs text-foreground-500">
          <i className="ri-information-line text-primary-500 mr-1"></i>
          <strong>Insight:</strong> Your <strong>Behaviours</strong> category has the lowest evidence count. Behaviours KSBs are often demonstrated through reflections, coaching sessions, and workplace observations. Make sure you are logging these regularly.
        </p>
      </div>
    </section>
  );
}