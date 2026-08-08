import { WORKPLACE_APPLICATION } from '@/mocks/monthly-coaching';

export default function WorkplaceApplicationSection() {
  const w = WORKPLACE_APPLICATION;

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
            <AppIcon className="ri-building-2-line text-accent-700" />
          </div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Workplace Application Summary</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {w.map((item) => (
            <div key={item.id} className="rounded-xl border border-background-200/50 bg-background-100/30 p-4 hover:bg-background-100/60 transition-smooth">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                  <AppIcon className="ri-lightbulb-line text-primary-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground-900 mb-1">{item.title}</h3>
                  <p className="text-xs text-foreground-500 mb-2 leading-relaxed">{item.description}</p>

                  <div className="flex flex-wrap gap-1 mb-2">
                    {item.ksbCodes.map((code) => (
                      <span key={code} className="text-xs font-medium bg-secondary-100 text-secondary-700 px-1.5 py-0.5 rounded">
                        {code}
                      </span>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-background-200/30 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-foreground-500">
                      <AppIcon className="ri-folder-upload-line text-foreground-400" />
                      <span>{item.evidenceLinked} evidence linked</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-foreground-500">
                      <AppIcon className="ri-building-line text-foreground-400" />
                      <span className="truncate">{item.workplaceEvidence}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}