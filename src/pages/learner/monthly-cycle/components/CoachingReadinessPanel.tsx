import { useState } from 'react';
import { COACHING_READINESS_DATA } from '@/mocks/monthly-cycle';

export default function CoachingReadinessPanel() {
  const d = COACHING_READINESS_DATA;
  const [checked, setChecked] = useState<Set<string>>(new Set(d.items.filter(i => i.status === 'Completed').map(i => i.label)));

  const toggle = (label: string) => {
    setChecked(prev => {
      const n = new Set(prev);
      n.has(label) ? n.delete(label) : n.add(label);
      return n;
    });
  };

  const progress = Math.round((checked.size / d.totalItems) * 100);

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/50 p-5">
      {/* Header with Score */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <i className="ri-shield-check-line text-foreground-600 text-sm"></i>
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Coaching Readiness</h3>
          </div>
          <p className="text-sm text-foreground-400">{d.message}</p>
        </div>

        {/* Coaching Readiness Score */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative w-16 h-16 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="30" fill="none" stroke="oklch(var(--background-200))" strokeWidth="6" />
              <circle
                cx="36" cy="36" r="30" fill="none"
                stroke={progress >= 80 ? 'oklch(var(--primary-500))' : progress >= 50 ? 'oklch(var(--accent-500))' : 'oklch(var(--secondary-500))'}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 30}
                strokeDashoffset={(2 * Math.PI * 30) - (progress / 100) * (2 * Math.PI * 30)}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-bold text-foreground-950">{progress}%</span>
              <span className="text-[8px] text-foreground-400">Ready</span>
            </div>
          </div>
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="text-emerald-700 font-medium"><span className="font-bold">{checked.size}</span> Complete</span>
            <span className="text-foreground-400"><span className="font-bold">{d.totalItems - checked.size}</span> Outstanding</span>
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {d.items.map(item => {
          const isDone = checked.has(item.label);
          return (
            <button
              key={item.label}
              onClick={() => toggle(item.label)}
              className="flex items-center justify-between p-3 rounded-lg border border-background-200/50 hover:bg-background-100 transition-smooth cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isDone ? 'bg-foreground-900 border-foreground-900' : 'border-foreground-300'}`}>
                  {isDone && <i className="ri-check-line text-white text-[8px]"></i>}
                </span>
                <span className="text-sm text-foreground-700">{item.label}</span>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-600'}`}>
                {isDone ? 'Done' : 'Pending'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-foreground-500 font-medium">Coaching Readiness Progress</span>
          <span className="text-xs text-foreground-400">{progress}%</span>
        </div>
        <div className="h-2 bg-background-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${progress >= 80 ? 'bg-primary-500' : progress >= 50 ? 'bg-accent-500' : 'bg-secondary-500'}`}
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
}