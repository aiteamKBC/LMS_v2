import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import { componentTypeMeta } from '@/utils/learnerJourney';
import {
  flattenJourney,
  formatAttemptGrade,
  formatDisplayDate,
  formatQuizAttemptScore,
  resolveQuizAttemptModule,
  resolveQuizAttemptTitle,
  type CaseFileTabProps,
} from '../data';

export default function EvidenceTab({ data }: CaseFileTabProps) {
  const evidence = data.evidence;
  const assessmentSignals = [...(data.detail?.quizAttempts || [])]
    .filter((attempt) => (attempt.ksbs || []).length > 0)
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
    .slice(0, 6);
  const opportunityRows = flattenJourney(data)
    .filter((item) => {
      const label = componentTypeMeta(item.title).label.toLowerCase();
      return label.includes('evidence') || label.includes('reflection') || label.includes('activity');
    })
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard icon="ri-folder-upload-line" label="Total Evidence" value={evidence?.totalEvidence ?? data.evidenceCount ?? '--'} tone="brand" />
        <MetricCard icon="ri-time-line" label="Pending Review" value={evidence?.pendingEvidence ?? '--'} tone="caution" />
        <MetricCard icon="ri-check-double-line" label="Accepted" value={evidence?.acceptedEvidence ?? '--'} tone="positive" />
        <MetricCard icon="ri-error-warning-line" label="Referred" value={evidence?.referredEvidence ?? '--'} tone="critical" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-radar-line text-primary-500"></AppIcon> Review Snapshot
            </h2>
            {evidence && <StatusBadge tone={queueTone(evidence)} label={queueLabel(evidence)} />}
          </div>
          {!evidence ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No marking-queue record"
              description="No live marking-queue record was returned for this learner."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DetailCard
                title="Last Submission"
                value={evidence.lastSubmission || '--'}
                detail={evidence.lastSubmissionIso ? `Recorded ${formatDisplayDate(evidence.lastSubmissionIso)}` : '--'}
                icon="ri-calendar-event-line"
              />
              <DetailCard
                title="Elapsed Days"
                value={`${evidence.elapsedDays} day(s)`}
                detail={evidence.isOverdue ? 'This queue item is beyond the overdue threshold.' : 'Within the current review threshold.'}
                icon="ri-hourglass-line"
              />
              <DetailCard
                title="Programme Group"
                value={evidence.group || '--'}
                detail={evidence.programme || '--'}
                icon="ri-group-line"
              />
              <DetailCard
                title="Evidence Totals"
                value={`${evidence.pendingEvidence} pending / ${evidence.acceptedEvidence} accepted`}
                detail={`${evidence.referredEvidence} referred and ${evidence.totalEvidence} total item(s)`}
                icon="ri-file-list-3-line"
              />
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-route-line text-accent-500"></AppIcon> Planned Evidence Opportunities
            </h2>
            <span className="text-[12px] text-foreground-400">{opportunityRows.length} live plan item(s)</span>
          </div>
          {opportunityRows.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No evidence opportunities"
              description="No evidence-style components were found in the live training plan."
            />
          ) : (
            <div className="space-y-3">
              {opportunityRows.map((item, index) => {
                const meta = componentTypeMeta(item.title);
                return (
                  <div key={`${item.module}-${item.week}-${item.title}-${index}`} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}>
                        <AppIcon className={`${meta.icon} text-base ${meta.color}`}></AppIcon>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-semibold text-foreground-900">{meta.detail || meta.label}</p>
                          <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-background-50 text-foreground-500 border border-background-200">
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-[12px] text-foreground-500 mt-1">
                          {item.module} - {item.week}
                          {item.expectedOtjh ? ` - ${item.expectedOtjh}h planned OTJH` : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-questionnaire-line text-secondary-500"></AppIcon> Assessment Evidence Links
            </h2>
            <span className="text-[12px] text-foreground-400">{assessmentSignals.length} recent linked attempt(s)</span>
          </div>
          {assessmentSignals.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No linked quiz attempts"
              description="No quiz attempts with KSB links were returned yet."
            />
          ) : (
            <div className="space-y-3">
              {assessmentSignals.map((attempt, index) => {
                const tone: StatusTone = attempt.passed ? 'positive' : 'caution';
                const style = toneStyle(tone);
                return (
                  <div key={`${attempt.quizId}-${attempt.attempt ?? 0}-${attempt.submittedAt}-${index}`} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${style.bg} ${style.text}`}>
                        <AppIcon className="ri-question-answer-line text-base"></AppIcon>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-semibold text-foreground-900">{resolveQuizAttemptTitle(data.detail, attempt)}</p>
                          <StatusBadge tone={tone} label={attempt.passed ? 'Passed' : 'Submitted'} />
                        </div>
                        <p className="text-[12px] text-foreground-500 mt-1">
                          {resolveQuizAttemptModule(data.detail, attempt) || 'Quiz'} - Submitted {formatDisplayDate(attempt.submittedAt)}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[12px] text-foreground-500">
                          <span>{[formatAttemptGrade(attempt), formatQuizAttemptScore(attempt)].filter(Boolean).join(' - ') || '--'}</span>
                          <span>{attempt.ksbs?.length || 0} linked KSB(s)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6 text-[12px] text-foreground-600 space-y-2">
          <p>
            This tab now uses live evidence totals from the coach marking queue plus real quiz-to-KSB links from the learner detail endpoint.
          </p>
          <p>
            Individual file names, uploads, and document URLs are not exposed by the current backend yet, so static fake evidence cards were removed.
          </p>
        </div>
      </section>
    </div>
  );
}

function queueLabel(evidence: NonNullable<CaseFileTabProps['data']['evidence']>) {
  if (evidence.isOverdue) return 'Overdue';
  if (evidence.pendingEvidence > 0) return 'Awaiting Review';
  return 'Up to Date';
}

function queueTone(evidence: NonNullable<CaseFileTabProps['data']['evidence']>): StatusTone {
  if (evidence.isOverdue) return 'critical';
  if (evidence.pendingEvidence > 0) return 'caution';
  return 'positive';
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
