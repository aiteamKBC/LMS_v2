import { AT_RISK_KSBS } from '@/mocks/gateway-readiness';

export function KSBRiskAnalysis() {
  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
          <AppIcon className="ri-error-warning-line text-red-600"></AppIcon>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">At Risk KSBs</h3>
          <p className="text-xs text-foreground-400 mt-0.5">KSBs with low validation progress that need immediate attention</p>
        </div>
      </div>

      <div className="space-y-2">
        {AT_RISK_KSBS.map(ksb => (
          <div key={ksb.code} className="bg-background-100/50 rounded-lg p-3.5 border border-background-200/30 flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-red-700">{ksb.code}</span>
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-semibold text-foreground-900">{ksb.code}</span>
                <span className="text-[9px] font-semibold text-foreground-400 bg-background-100 px-1.5 py-0.5 rounded-full">{ksb.category}</span>
                <span className="text-[9px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">{ksb.issue}</span>
              </div>
              <p className="text-xs text-foreground-500 leading-relaxed mt-1.5">
                <AppIcon className="ri-lightbulb-line text-accent-500 mr-1"></AppIcon>
                <strong>Recommendation:</strong> {ksb.recommendation}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}