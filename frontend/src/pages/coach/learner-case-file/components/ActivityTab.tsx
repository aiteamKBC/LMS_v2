import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { flattenJourney, type CaseFileTabProps } from '../data';

const toneMap = {
  primary: 'bg-primary-100 text-primary-600 ring-primary-200',
  accent: 'bg-accent-100 text-accent-600 ring-accent-200',
  emerald: 'bg-emerald-100 text-emerald-600 ring-emerald-200',
  amber: 'bg-amber-100 text-amber-600 ring-amber-200',
  red: 'bg-red-100 text-red-600 ring-red-200',
} as const;

export default function ActivityTab({ data }: CaseFileTabProps) {
  const flatComponents = flattenJourney(data);
  const timelineItems = data.activityItems;
  const passedQuizzes = (data.detail?.quizAttempts || []).filter((attempt) => attempt.passed).length;
  const milestones = [
    { label: 'Next Coaching', value: data.snapshot?.nextCoaching || '--', detail: 'From coach caseload schedule.', icon: 'ri-calendar-schedule-line' },
    { label: 'Next Review', value: data.snapshot?.nextReview || '--', detail: 'Upcoming learner review touchpoint.', icon: 'ri-file-chart-line' },
    { label: 'Gateway Review', value: data.gatewayReviewDate || '--', detail: 'Programme milestone from coach snapshot.', icon: 'ri-flag-2-line' },
    { label: 'Planned End', value: data.plannedEndDate || '--', detail: 'Expected programme end date.', icon: 'ri-calendar-check-line' },
  ].filter((item) => item.value && item.value !== '--');

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard icon="ri-history-line" label="Live Events" value={timelineItems.length} tone="brand" />
        <MetricCard icon="ri-check-double-line" label="Passed Quizzes" value={passedQuizzes} tone="positive" />
        <MetricCard icon="ri-route-line" label="Plan Components" value={flatComponents.length} tone="upcoming" />
        <MetricCard icon="ri-folder-upload-line" label="Latest Submission" value={data.evidence?.lastSubmission || '--'} tone="caution" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-history-line text-primary-500"></AppIcon> Activity Timeline
            </h2>
            <span className="text-[12px] text-foreground-400">{timelineItems.length} event(s)</span>
          </div>
          {timelineItems.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No activity yet"
              description="No live activity items were derived for this learner yet."
            />
          ) : (
            <div className="relative pl-8">
              <div className="absolute left-[13px] top-0 bottom-0 w-0.5 bg-background-200"></div>
              <div className="space-y-0">
                {timelineItems.map((item) => (
                  <div key={item.id} className="relative pb-5 last:pb-0">
                    <div className={`absolute -left-[19px] w-4 h-4 rounded-full flex items-center justify-center ring-2 ${toneMap[item.tone]} z-10 bg-background-50`}>
                      <AppIcon className={`${activityIcon(item.event, item.tone)} text-[12px]`}></AppIcon>
                    </div>
                    <div className="ml-2">
                      <p className="text-[12px] font-semibold text-foreground-900">{item.event}</p>
                      <p className="text-[12px] text-foreground-400">{item.date}</p>
                      <p className="text-[12px] text-foreground-500 mt-0.5">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-calendar-todo-line text-accent-500"></AppIcon> Upcoming Milestones
            </h2>
            <span className="text-[12px] text-foreground-400">{milestones.length} dated item(s)</span>
          </div>
          {milestones.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No upcoming milestones"
              description="No upcoming milestone dates were returned in the live coach snapshot."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {milestones.map((item) => (
                <DetailCard key={item.label} title={item.label} value={item.value} detail={item.detail} icon={item.icon} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6 text-[12px] text-foreground-600 space-y-2">
          <p>
            Timeline items are generated from live coach data such as programme start, evidence queue activity, and recent quiz submissions.
          </p>
          <p>
            Session-by-session coaching notes are not exposed by the current backend, so the old mock timeline was removed.
          </p>
        </div>
      </section>
    </div>
  );
}

function activityIcon(event: string, tone: keyof typeof toneMap) {
  const normalized = event.toLowerCase();
  if (normalized.includes('programme')) return 'ri-flag-line';
  if (normalized.includes('evidence')) return 'ri-folder-upload-line';
  if (normalized.includes('passed')) return 'ri-check-line';
  if (normalized.includes('quiz')) return 'ri-question-answer-line';
  if (tone === 'amber') return 'ri-time-line';
  return 'ri-history-line';
}

function DetailCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <Panel padding="md">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg bg-background-100 border border-foreground-200/60 flex items-center justify-center">
          <AppIcon className={`${icon} text-sm text-foreground-600`}></AppIcon>
        </span>
        <p className="text-[12px] font-semibold text-foreground-900">{title}</p>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[12px] text-foreground-400 mt-1">{detail}</p>
    </Panel>
  );
}
