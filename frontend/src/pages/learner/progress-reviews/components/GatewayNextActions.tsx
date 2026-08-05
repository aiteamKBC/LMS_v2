import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';

export default function GatewayNextActions() {
  const d = PROGRESS_REVIEWS_DATA;

  return (
    <div className="space-y-6">
      {/* ── SECTION 15: GATEWAY IMPACT ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Gateway Impact</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          {[
            d.gatewayImpact.ksbValidation,
            d.gatewayImpact.evidenceCoverage,
            d.gatewayImpact.otjhProgress,
            d.gatewayImpact.employerEngagement,
            d.gatewayImpact.assessmentReadiness,
          ].map((item) => (
            <div key={item.label} className="bg-background-100 rounded-lg border border-background-200/50 p-4 text-center">
              <div className="text-xl font-bold text-foreground-900">{item.current}<span className="text-sm text-foreground-400">/{item.total}</span></div>
              <div className="text-xs text-foreground-500 mt-1">{item.label}</div>
              <div className="mt-2 h-1 rounded-full bg-foreground-100 overflow-hidden">
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, (item.current / item.total) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="bg-primary-500/5 border border-primary-500/15 rounded-lg p-4">
          <p className="text-sm font-semibold text-primary-700">
            <AppIcon className="ri-flag-line mr-1" /> {d.gatewayImpact.contribution}
          </p>
        </div>
      </section>

      {/* ── SECTION 16: NEXT BEST ACTIONS ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Next Best Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {d.nextBestActions.map((action) => (
            <div key={action.id} className="flex items-center gap-3 bg-background-100 rounded-lg border border-background-200/50 p-4 hover:bg-background-200 transition-all cursor-pointer">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${action.priority === 'high' ? 'bg-red-500/10 text-red-500' : action.priority === 'medium' ? 'bg-amber-500/10 text-amber-500' : 'bg-primary-500/10 text-primary-500'}`}>
                <AppIcon className={action.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground-900">{action.title}</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${action.priority === 'high' ? 'bg-red-100 text-red-700' : action.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{action.priority}</span>
              </div>
              <AppIcon className="ri-arrow-right-line text-foreground-300" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}