import { EmptyState } from '@/pages/users/components/ui';
import { formatFraction, formatHours, type CaseFileTabProps } from '../data';

export default function OTJHTab({ data }: CaseFileTabProps) {
  const weekRows = data.journey.flatMap((module) =>
    module.weeks.map((week) => ({
      module: module.module,
      week: week.week,
      otjh: week.otjh,
      components: week.components.length,
      quizzes: week.components.filter((component) => component.isQuiz).length,
    })),
  );
  const moduleRows = data.journey.map((module) => ({
    module: module.module,
    weeks: module.weeks.length,
    otjh: module.weeks.reduce((sum, week) => sum + week.otjh, 0),
    components: module.weeks.reduce((sum, week) => sum + week.components.length, 0),
  }));
  const variance = data.otjhCompleted !== null && data.otjhTarget !== null
    ? Number((data.otjhCompleted - data.otjhTarget).toFixed(1))
    : null;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon="ri-time-line" label="Logged OTJH" value={formatHours(data.otjhCompleted)} tone="primary" />
        <StatCard icon="ri-flag-2-line" label="Current Target" value={formatHours(data.otjhTarget)} tone="emerald" />
        <StatCard icon="ri-route-line" label="Programme Total" value={formatHours(data.totalExpectedOtjh || null)} tone="secondary" />
        <StatCard
          icon="ri-scales-3-line"
          label="Variance vs Target"
          value={variance === null ? '--' : `${variance > 0 ? '+' : ''}${variance}h`}
          tone={variance !== null && variance < 0 ? 'amber' : 'primary'}
        />
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-book-2-line text-primary-500"></i> Module OTJH Summary
            </h2>
            <span className="text-[11px] text-foreground-400">{moduleRows.length} module(s)</span>
          </div>
          {moduleRows.length === 0 ? (
            <EmptyState text="No structured OTJH plan was returned for this learner." />
          ) : (
            <div className="space-y-3">
              {moduleRows.map((row) => (
                <div key={row.module} className="rounded-xl border border-foreground-200/60 bg-background-100/60 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <p className="text-[13px] font-semibold text-foreground-900">{row.module}</p>
                      <p className="text-[11px] text-foreground-400">{row.weeks} week(s) - {row.components} component(s)</p>
                    </div>
                    <span className="text-[12px] font-semibold text-foreground-900">{formatHours(row.otjh || null)}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-background-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary-500"
                      style={{ width: `${Math.min(100, data.totalExpectedOtjh ? (row.otjh / data.totalExpectedOtjh) * 100 : 0)}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-calendar-schedule-line text-accent-500"></i> Weekly OTJH Breakdown
            </h2>
            <span className="text-[11px] text-foreground-400">
              Logged {formatFraction(data.otjhCompleted, data.otjhTarget)}
            </span>
          </div>
          {weekRows.length === 0 ? (
            <EmptyState text="No week-level OTJH breakdown is available yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-background-200">
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Module</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Week</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Components</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Quizzes</th>
                    <th className="pb-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Planned OTJH</th>
                  </tr>
                </thead>
                <tbody>
                  {weekRows.map((row, index) => (
                    <tr key={`${row.module}-${row.week}-${index}`} className="border-b border-background-100 hover:bg-background-100/30 transition-all">
                      <td className="py-3 text-[13px] font-medium text-foreground-900">{row.module}</td>
                      <td className="py-3 text-[12px] text-foreground-600">{row.week}</td>
                      <td className="py-3 text-center text-[12px] text-foreground-700">{row.components}</td>
                      <td className="py-3 text-center text-[12px] text-foreground-700">{row.quizzes}</td>
                      <td className="py-3 text-center text-[12px] text-foreground-700">{formatHours(row.otjh || null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'secondary' | 'emerald' | 'amber';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    secondary: 'bg-secondary-100 text-secondary-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}
