import { NEXT_ACTIONS } from '@/mocks/gateway-readiness';

export function ActionCentre() {
  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
          <i className="ri-lightbulb-flash-line text-primary-600"></i>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Next Best Actions</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Focus on these highest-priority items to accelerate your Gateway readiness</p>
        </div>
      </div>

      <div className="space-y-2">
        {NEXT_ACTIONS.map((action, index) => (
          <a
            key={action.id}
            href={action.link}
            className="flex items-start gap-3 p-3 bg-background-100/50 rounded-lg border border-background-200/30 hover:border-primary-300/50 hover:bg-primary-50/50 transition-smooth group cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary-100 transition-smooth">
              <i className={`${action.icon} text-foreground-500 text-sm group-hover:text-primary-600 transition-smooth`}></i>
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground-900">{action.label}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  action.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {action.priority === 'high' ? 'High Priority' : 'Medium Priority'}
                </span>
                <span className="text-[9px] font-semibold text-foreground-300">#{index + 1}</span>
              </div>
              <p className="text-xs text-foreground-400 mt-0.5">{action.detail}</p>
            </div>
            <i className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-500 transition-smooth shrink-0 mt-1"></i>
          </a>
        ))}
      </div>
    </section>
  );
}