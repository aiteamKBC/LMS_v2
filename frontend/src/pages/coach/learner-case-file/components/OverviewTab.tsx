import { EmptyState } from '@/pages/users/components/ui';
import {
  flattenJourney,
  formatDisplayDate,
  formatHours,
  formatPercent,
  quizGradeValue,
  type CaseFileTabProps,
} from '../data';

export default function OverviewTab({ data }: CaseFileTabProps) {
  const flatComponents = flattenJourney(data);
  const weekRows = data.journey.flatMap((module) =>
    module.weeks.map((week) => ({
      module: module.module,
      week: week.week,
      componentCount: week.components.length,
      quizCount: week.components.filter((component) => component.isQuiz).length,
      otjh: week.otjh,
    })),
  );
  const latestAttempts = [...(data.detail?.quizAttempts || [])]
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon="ri-pie-chart-line" label="Overall Progress" value={formatPercent(data.overallProgress)} tone="primary" />
        <StatCard icon="ri-calendar-check-line" label="Attendance" value={formatPercent(data.attendanceRate)} tone="amber" />
        <StatCard icon="ri-time-line" label="OTJH Logged" value={formatHours(data.otjhCompleted)} tone="secondary" />
        <StatCard icon="ri-line-chart-line" label="Plan OTJH" value={formatHours(data.totalExpectedOtjh || null)} tone="emerald" />
        <StatCard icon="ri-award-line" label="Mapped KSBs" value={String(data.detail?.ksbs.length || 0)} tone="accent" />
        <StatCard icon="ri-folder-upload-line" label="Evidence Count" value={String(data.evidenceCount ?? '--')} tone="primary" />
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-user-line text-primary-500"></i> About
            </h2>
          </div>
          <p className="text-[13px] text-foreground-600 leading-relaxed">
            {data.displayName} is currently tracked under <strong>{data.programme}</strong>
            {data.employer ? <> with <strong>{data.employer}</strong></> : null}
            {data.cohort ? <> in cohort <strong>{data.cohort}</strong></> : null}.
            {' '}The coach snapshot shows <strong>{formatPercent(data.overallProgress)}</strong> overall progress,
            {' '}<strong>{formatPercent(data.attendanceRate)}</strong> attendance,
            {' '}and <strong>{formatHours(data.otjhCompleted)}</strong> logged against a target of <strong>{formatHours(data.otjhTarget)}</strong>.
            {' '}This learner currently has <strong>{flatComponents.length}</strong> structured component(s),
            {' '}<strong>{data.journey.reduce((count, module) => count + module.weeks.length, 0)}</strong> learning week(s),
            {' '}and <strong>{data.detail?.quizAttempts.length || 0}</strong> recorded quiz attempt(s).
          </p>
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-route-line text-primary-500"></i> Programme Journey
            </h2>
            <span className="text-[11px] text-foreground-400">{weekRows.length} week row(s)</span>
          </div>
          {weekRows.length === 0 ? (
            <EmptyState text="No structured plan has been saved for this learner yet." />
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
                      <td className="py-3 text-center text-[12px] text-foreground-700">{row.componentCount}</td>
                      <td className="py-3 text-center text-[12px] text-foreground-700">{row.quizCount}</td>
                      <td className="py-3 text-center text-[12px] text-foreground-700">{formatHours(row.otjh || null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-question-answer-line text-secondary-500"></i> Recent Assessments
            </h2>
            <span className="text-[11px] text-foreground-400">{data.detail?.quizAttempts.length || 0} total attempt(s)</span>
          </div>
          {latestAttempts.length === 0 ? (
            <EmptyState text="No quiz attempts have been recorded for this learner yet." />
          ) : (
            <div className="space-y-3">
              {latestAttempts.map((attempt, index) => (
                <div
                  key={`${attempt.quizId}-${attempt.attempt ?? 0}-${attempt.submittedAt}-${index}`}
                  className="flex items-center gap-4 p-3 rounded-xl bg-background-100/60 border border-foreground-200/60"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    attempt.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-700'
                  }`}>
                    <i className="ri-questionnaire-line text-base"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{attempt.quizName}</p>
                    <p className="text-[11px] text-foreground-400">
                      {attempt.module || 'Quiz'} - Submitted {formatDisplayDate(attempt.submittedAt)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${
                      attempt.passed
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {attempt.passed ? 'Passed' : 'Submitted'}
                    </span>
                    <p className="text-[12px] font-semibold text-foreground-900 mt-1">
                      {attempt.grade}{attempt.Score ? ` - ${attempt.Score}` : ''}
                    </p>
                    <p className="text-[10px] text-foreground-400">
                      {attempt.ksbs?.length ? `${attempt.ksbs.length} KSB link(s)` : `${quizGradeValue(attempt)}%`}
                    </p>
                  </div>
                </div>
              ))}
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
  tone: 'primary' | 'accent' | 'emerald' | 'secondary' | 'amber';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    accent: 'bg-accent-100 text-accent-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    secondary: 'bg-secondary-100 text-secondary-600',
    amber: 'bg-amber-100 text-amber-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-3 text-center">
      <div className={`w-8 h-8 mx-auto rounded-lg flex items-center justify-center mb-2 ${toneMap[tone]}`}>
        <i className={`${icon} text-sm`}></i>
      </div>
      <p className="text-base font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[10px] text-foreground-400">{label}</p>
    </div>
  );
}
