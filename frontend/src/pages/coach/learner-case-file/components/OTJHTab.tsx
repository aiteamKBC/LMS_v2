import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
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
        <MetricCard icon="ri-time-line" label="Logged OTJH" value={formatHours(data.otjhCompleted)} tone="brand" />
        <MetricCard icon="ri-flag-2-line" label="Current Target" value={formatHours(data.otjhTarget)} tone="positive" />
        <MetricCard icon="ri-route-line" label="Programme Total" value={formatHours(data.totalExpectedOtjh || null)} tone="info" />
        <MetricCard
          icon="ri-scales-3-line"
          label="Variance vs Target"
          value={variance === null ? '--' : `${variance > 0 ? '+' : ''}${variance}h`}
          tone={variance !== null && variance < 0 ? 'caution' : 'brand'}
        />
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-book-2-line text-primary-500"></AppIcon> Module OTJH Summary
            </h2>
            <span className="text-[12px] text-foreground-400">{moduleRows.length} module(s)</span>
          </div>
          {moduleRows.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No OTJH plan"
              description="No structured OTJH plan was returned for this learner."
            />
          ) : (
            <div className="space-y-3">
              {moduleRows.map((row) => (
                <div key={row.module} className="rounded-xl border border-foreground-200/60 bg-background-100/60 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <p className="text-[13px] font-semibold text-foreground-900">{row.module}</p>
                      <p className="text-[12px] text-foreground-400">{row.weeks} week(s) - {row.components} component(s)</p>
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
              <AppIcon className="ri-calendar-schedule-line text-accent-500"></AppIcon> Weekly OTJH Breakdown
            </h2>
            <span className="text-[12px] text-foreground-400">
              Logged {formatFraction(data.otjhCompleted, data.otjhTarget)}
            </span>
          </div>
          {weekRows.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No weekly breakdown"
              description="No week-level OTJH breakdown is available yet."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-background-200">
                    <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider">Module</th>
                    <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider">Week</th>
                    <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Components</th>
                    <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Quizzes</th>
                    <th className="pb-3 text-[12px] font-semibold text-foreground-400 uppercase tracking-wider text-center">Planned OTJH</th>
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
