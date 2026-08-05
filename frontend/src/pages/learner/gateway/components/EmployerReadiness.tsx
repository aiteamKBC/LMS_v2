import { EMPLOYER_READINESS } from '@/mocks/gateway-readiness';

export function EmployerReadiness() {
  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
          <AppIcon className="ri-building-2-line text-secondary-700"></AppIcon>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Employer Readiness</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Ensure your employer is prepared before you reach Gateway</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {EMPLOYER_READINESS.map(item => (
          <div key={item.id} className="bg-background-100/50 rounded-lg p-3.5 border border-background-200/30 flex items-start gap-3">
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
              item.status === 'complete' ? 'bg-emerald-100 text-emerald-600' :
              item.status === 'in-progress' ? 'bg-amber-100 text-amber-600' :
              'bg-background-100 text-foreground-300'
            }`}>
              <AppIcon className={`${
                item.status === 'complete' ? 'ri-check-line' :
                item.status === 'in-progress' ? 'ri-time-line' :
                'ri-subtract-line'
              } text-sm`}></AppIcon>
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground-900">{item.label}</p>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                  item.status === 'complete' ? 'bg-emerald-100 text-emerald-700' :
                  item.status === 'in-progress' ? 'bg-amber-100 text-amber-700' :
                  item.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                  'bg-background-100 text-foreground-400'
                }`}>
                  {item.status === 'complete' ? 'Complete' : item.status === 'in-progress' ? 'In Progress' : item.status === 'pending' ? 'Pending' : 'Required'}
                </span>
              </div>
              <p className="text-xs text-foreground-400 mt-0.5 leading-relaxed">{item.detail}</p>
              <div className="flex items-center gap-1 mt-1">
                <AppIcon className="ri-calendar-line text-[9px] text-foreground-300"></AppIcon>
                <span className="text-[9px] text-foreground-400">{item.deadline}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 bg-secondary-50 rounded-lg p-3 border border-secondary-200/50">
        <p className="text-xs text-secondary-700">
          <AppIcon className="ri-information-line mr-1"></AppIcon>
          <strong>Tip:</strong> Start conversations with your line manager early. Employer paperwork is the most common cause of Gateway delays.
        </p>
      </div>
    </section>
  );
}