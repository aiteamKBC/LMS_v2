import { useState } from 'react';
import { COACHING_ACTIONS } from '@/mocks/monthly-coaching';

export default function CoachingActionTracker() {
  const [filter, setFilter] = useState<string>('All');
  const a = COACHING_ACTIONS;

  const filters = ['All', 'In Progress', 'Not Started', 'Completed', 'Overdue'];

  const filtered = filter === 'All' ? a : a.filter((act) => act.status === filter);

  const statusStyle = {
    Completed: { text: 'text-green-700', bg: 'bg-green-100', border: 'border-green-200' },
    'In Progress': { text: 'text-primary-700', bg: 'bg-primary-100', border: 'border-primary-200' },
    'Not Started': { text: 'text-foreground-500', bg: 'bg-foreground-100', border: 'border-foreground-200' },
    Overdue: { text: 'text-red-700', bg: 'bg-red-100', border: 'border-red-200' },
  };

  const priorityStyle = {
    High: 'text-red-600 bg-red-50',
    Normal: 'text-foreground-600 bg-background-100',
    Low: 'text-foreground-500 bg-background-100',
  };

  return (
    <section className="rounded-2xl border border-background-200/50 bg-background-50 overflow-hidden">
      <div className="p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
              <i className="ri-task-line text-primary-700" />
            </div>
            <h2 className="text-lg font-heading font-semibold text-foreground-900">Coaching Action Tracker</h2>
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {filters.map((f) => {
              const count = f === 'All' ? a.length : a.filter((act) => act.status === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                    filter === f
                      ? 'bg-foreground-900 text-white'
                      : 'bg-background-100 text-foreground-600 hover:bg-background-200 border border-background-200/50'
                  }`}
                >
                  {f} ({count})
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          {filtered.map((act) => {
            const s = statusStyle[act.status];
            const p = priorityStyle[act.priority];
            return (
              <div
                key={act.id}
                className={`rounded-xl border ${s.border} bg-background-50 p-4 hover:bg-background-100/30 transition-smooth`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-2 ${
                      act.status === 'Completed' ? 'bg-green-500' : act.status === 'Overdue' ? 'bg-red-500' : act.status === 'In Progress' ? 'bg-primary-500' : 'bg-foreground-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${act.status === 'Completed' ? 'text-foreground-500 line-through' : 'text-foreground-800'}`}>
                        {act.text}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
                          {act.status}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p}`}>
                          {act.priority}
                        </span>
                        <span className="text-xs text-foreground-400 flex items-center gap-1">
                          <i className="ri-calendar-line" /> {act.dueDate}
                        </span>
                        <span className="text-xs text-foreground-400 flex items-center gap-1">
                          <i className="ri-user-line" /> {act.coachAssigned}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}