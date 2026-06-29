import { useState } from 'react';
import { COACHING_READINESS } from '@/mocks/monthly-coaching';

export default function CoachingReadinessScore() {
  const [expanded, setExpanded] = useState(true);
  const r = COACHING_READINESS;

  const statusColorMap = {
    completed: { bg: 'bg-primary-500', text: 'text-white', border: 'border-primary-500', icon: 'ri-check-line' },
    pending: { bg: 'bg-foreground-200', text: 'text-foreground-500', border: 'border-foreground-300', icon: 'ri-subtract-line' },
    warning: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300', icon: 'ri-alert-line' },
  };

  const scoreColor = r.score >= 80 ? 'text-green-600' : r.score >= 50 ? 'text-amber-600' : 'text-red-600';
  const scoreBg = r.score >= 80 ? 'bg-green-50' : r.score >= 50 ? 'bg-amber-50' : 'bg-red-50';
  const scoreBorder = r.score >= 80 ? 'border-green-200' : r.score >= 50 ? 'border-amber-200' : 'border-red-200';

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
          {/* Score Ring */}
          <div className="flex flex-col items-center justify-center shrink-0">
            <div className={`relative w-32 h-32 rounded-full border-4 ${scoreBorder} ${scoreBg} flex flex-col items-center justify-center`}>
              <span className={`text-3xl font-bold font-heading ${scoreColor}`}>{r.score}%</span>
              <span className="text-xs text-foreground-500 mt-0.5">Ready</span>
            </div>
            <p className="text-sm font-semibold text-foreground-700 mt-3">{r.statusLabel}</p>
            <p className="text-xs text-foreground-400 mt-1">{r.completedItems} of {r.totalItems} items complete</p>
          </div>

          {/* Checklist */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-heading font-semibold text-foreground-900">Coaching Readiness Checklist</h2>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-sm text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer flex items-center gap-1"
              >
              <i className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                {expanded ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {expanded && (
              <div className="space-y-2">
                {r.checklist.map((item) => {
                  const style = statusColorMap[item.status];
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border ${
                        item.status === 'warning' ? 'bg-amber-50/50 border-amber-200/50' : item.status === 'completed' ? 'bg-background-100/50 border-background-200/30' : 'bg-background-50 border-background-200/30'
                      }`}
                    >
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${style.bg}`}>
                        <i className={`${style.icon} ${style.text} text-xs`} />
                      </span>
                      <i className={`${item.icon} text-foreground-400 shrink-0`} />
                      <span className={`text-sm font-medium ${item.status === 'completed' ? 'text-foreground-500' : 'text-foreground-800'}`}>
                        {item.label}
                      </span>
                      {item.status === 'warning' && (
                        <span className="ml-auto text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">Required</span>
                      )}
                      {item.status === 'pending' && (
                        <span className="ml-auto text-xs font-semibold text-foreground-500 bg-foreground-100 px-2 py-0.5 rounded-full shrink-0">Pending</span>
                      )}
                      {item.status === 'completed' && (
                        <span className="ml-auto text-xs font-semibold text-primary-700 bg-primary-100 px-2 py-0.5 rounded-full shrink-0">Done</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 p-3 rounded-lg bg-amber-50/50 border border-amber-200/50 flex items-start gap-3">
              <i className="ri-alert-line text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">{r.message}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}