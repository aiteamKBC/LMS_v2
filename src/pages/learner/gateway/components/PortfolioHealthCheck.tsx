import { PORTFOLIO_HEALTH } from '@/mocks/gateway-readiness';

export function PortfolioHealthCheck() {
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
          <i className="ri-heart-pulse-line text-primary-600"></i>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Portfolio Health Score</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Overall assessment of your portfolio quality and completeness</p>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-5">
        {/* Big score */}
        <div className="relative w-20 h-20">
          <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="oklch(var(--background-200))" strokeWidth="3"></circle>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke={PORTFOLIO_HEALTH.score >= 80 ? '#10b981' : PORTFOLIO_HEALTH.score >= 60 ? '#f59e0b' : '#ef4444'} strokeWidth="3" strokeDasharray={`${PORTFOLIO_HEALTH.score} ${100 - PORTFOLIO_HEALTH.score}`} strokeLinecap="round"></circle>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-lg font-bold ${getScoreColor(PORTFOLIO_HEALTH.score)}`}>{PORTFOLIO_HEALTH.score}%</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground-900">
            {PORTFOLIO_HEALTH.score >= 80 ? 'Strong' : PORTFOLIO_HEALTH.score >= 60 ? 'Developing' : 'Needs Attention'}
          </p>
          <p className="text-xs text-foreground-400 mt-0.5">Based on evidence quality, cross-referencing, KSB coverage, and workplace application</p>
        </div>
      </div>

      {/* Dimension bars */}
      <div className="space-y-3">
        {PORTFOLIO_HEALTH.dimensions.map(dim => (
          <div key={dim.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-background-100 flex items-center justify-center">
                  <i className={`${dim.icon} text-[10px] text-foreground-400`}></i>
                </span>
                <span className="text-foreground-600 font-medium">{dim.label}</span>
              </div>
              <span className={`font-semibold ${getScoreColor(dim.score)}`}>{dim.score}%</span>
            </div>
            <div className="h-2 rounded-full bg-background-200 overflow-hidden">
              <div
                className={`h-2 rounded-full ${getScoreBg(dim.score)} transition-all duration-700`}
                style={{ width: `${dim.score}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}