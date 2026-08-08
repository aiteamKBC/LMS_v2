import { MISSED_SESSION_GUIDANCE } from '@/mocks/attendance';
import { useState } from 'react';

const colorMap: Record<string, { border: string; iconBg: string; badgeBg: string }> = {
  amber: { border: 'border-amber-200/50', iconBg: 'bg-amber-100 text-amber-600', badgeBg: 'bg-amber-100 text-amber-700' },
  orange: { border: 'border-amber-200/50', iconBg: 'bg-amber-100 text-amber-600', badgeBg: 'bg-amber-100 text-amber-700' },
  red: { border: 'border-red-200/50', iconBg: 'bg-red-100 text-red-600', badgeBg: 'bg-red-100 text-red-700' },
};

export default function MissedSessionGuidance() {
  const [open, setOpen] = useState(false);

  return (
    <section className="bg-background-50 rounded-2xl border border-background-200/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full p-5 text-left cursor-pointer hover:bg-background-100/40 transition-all"
      >
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-secondary-100 flex items-center justify-center">
            <AppIcon className="ri-question-answer-line text-secondary-600 text-base"></AppIcon>
          </span>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">What Happens If I Miss a Session?</h3>
        </div>
        <AppIcon className={`${open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-400 text-lg`}></AppIcon>
      </button>
      {open && (
        <div className="px-5 pb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {MISSED_SESSION_GUIDANCE.map((g) => {
              const colors = colorMap[g.color] || colorMap.amber;
              return (
                <div key={g.level} className={`bg-background-100/40 rounded-xl border ${colors.border} p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${colors.iconBg}`}>
                      <AppIcon className={`${g.icon} text-sm`}></AppIcon>
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors.badgeBg}`}>
                      {g.badge}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground-900 mb-2">{g.level}</p>
                  <ul className="space-y-1">
                    {g.steps.map((step, i) => (
                      <li key={i} className="text-xs text-foreground-500 flex items-start gap-1.5">
                        <span className="text-foreground-300 mt-0.5 shrink-0">&bull;</span>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}