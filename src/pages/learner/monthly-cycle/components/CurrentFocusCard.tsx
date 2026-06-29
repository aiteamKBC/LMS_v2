import { MAY_FOCUS, JUNE_FOCUS, JULY_FOCUS, MAY_NEXT_ACTION, JUNE_NEXT_ACTION, JULY_NEXT_ACTION } from '@/mocks/monthly-cycle';

interface CurrentFocusCardProps {
  month: string;
}

const focusMap: Record<string, typeof JUNE_FOCUS> = {
  may: MAY_FOCUS,
  jun: JUNE_FOCUS,
  jul: JULY_FOCUS,
};

const nextMap: Record<string, typeof JUNE_NEXT_ACTION> = {
  may: MAY_NEXT_ACTION,
  jun: JUNE_NEXT_ACTION,
  jul: JULY_NEXT_ACTION,
};

export default function CurrentFocusCard({ month }: CurrentFocusCardProps) {
  const focus = focusMap[month] || JUNE_FOCUS;
  const next = nextMap[month] || JUNE_NEXT_ACTION;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 flex flex-col sm:flex-row items-start gap-4">
      {/* Current Focus */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Current Focus</span>
          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">{focus.priority} Priority</span>
        </div>
        <h3 className="text-base font-heading font-semibold text-foreground-900">{focus.title}</h3>
        <p className="text-sm text-foreground-500 mt-1">{focus.description}</p>
        <div className="flex items-center gap-3 mt-3">
          <a href={focus.actionUrl} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5">
            <i className={`${focus.icon} text-sm`}></i>
            {focus.actionLabel}
          </a>
          <span className="text-xs text-foreground-400">
            <i className="ri-time-line mr-1"></i>
            Due: {focus.deadline}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="hidden sm:block w-px h-24 bg-background-200 self-stretch"></div>

      {/* Next Best Action */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-secondary-600 bg-secondary-50 px-2 py-0.5 rounded-full uppercase tracking-wider">Next Best Action</span>
        </div>
        <h3 className="text-base font-heading font-semibold text-foreground-900">{next.title}</h3>
        <p className="text-sm text-foreground-500 mt-1">{next.description}</p>
        <div className="flex items-center gap-3 mt-3">
          <a href={next.actionUrl} className="px-4 py-2 border border-foreground-300 text-foreground-700 rounded-lg text-sm font-semibold hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5">
            <i className={`${next.icon} text-sm`}></i>
            {next.actionLabel}
          </a>
          <span className="text-xs text-primary-600">
            <i className="ri-flashlight-line mr-1"></i>
            {next.impact}
          </span>
        </div>
      </div>
    </div>
  );
}