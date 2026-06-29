import { EPA_COMPONENT_READINESS } from '@/mocks/gateway-readiness';

export function EPAComponentReadiness() {
  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
          <i className="ri-award-line text-primary-600"></i>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">EPA Component Readiness</h3>
          <p className="text-xs text-foreground-400 mt-0.5">How prepared you are for each EPA component</p>
        </div>
      </div>

      <div className="space-y-4">
        {EPA_COMPONENT_READINESS.map(comp => (
          <div key={comp.id} className="bg-background-100/50 rounded-lg p-4 border border-background-200/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground-900">{comp.title}</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">
                  Readiness: {comp.readiness}%
                </span>
              </div>
            </div>
            <div className="h-2 rounded-full bg-background-200 overflow-hidden mb-3">
              <div
                className="h-2 rounded-full bg-primary-500 transition-all duration-700"
                style={{ width: `${comp.readiness}%` }}
              ></div>
            </div>
            <p className="text-xs text-foreground-500 mb-2">{comp.description}</p>
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-foreground-700 uppercase tracking-wide">Recommendations:</p>
              {comp.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-foreground-500">
                  <i className="ri-checkbox-blank-circle-fill text-[5px] text-primary-400 mt-1.5 shrink-0"></i>
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}