import { EmptyState } from '@/pages/users/components/ui';
import { componentTypeMeta } from '@/utils/learnerJourney';
import {
  flattenJourney,
  formatDisplayDate,
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
        <StatCard icon="ri-folder-upload-line" label="Total Evidence" value={String(evidence?.totalEvidence ?? data.evidenceCount ?? '--')} tone="primary" />
        <StatCard icon="ri-time-line" label="Pending Review" value={String(evidence?.pendingEvidence ?? '--')} tone="amber" />
        <StatCard icon="ri-check-double-line" label="Accepted" value={String(evidence?.acceptedEvidence ?? '--')} tone="emerald" />
        <StatCard icon="ri-error-warning-line" label="Referred" value={String(evidence?.referredEvidence ?? '--')} tone="red" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-radar-line text-primary-500"></i> Review Snapshot
            </h2>
            {evidence && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${queueBadge(evidence)}`}>
                {queueLabel(evidence)}
              </span>
            )}
          </div>
          {!evidence ? (
            <EmptyState text="No live marking-queue record was returned for this learner." />
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
              <i className="ri-route-line text-accent-500"></i> Planned Evidence Opportunities
            </h2>
            <span className="text-[11px] text-foreground-400">{opportunityRows.length} live plan item(s)</span>
          </div>
          {opportunityRows.length === 0 ? (
            <EmptyState text="No evidence-style components were found in the live training plan." />
          ) : (
            <div className="space-y-3">
              {opportunityRows.map((item, index) => {
                const meta = componentTypeMeta(item.title);
                return (
                  <div key={`${item.module}-${item.week}-${item.title}-${index}`} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}>
                        <i className={`${meta.icon} text-base ${meta.color}`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-semibold text-foreground-900">{meta.detail || meta.label}</p>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-50 text-foreground-500 border border-background-200">
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-foreground-500 mt-1">
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
              <i className="ri-questionnaire-line text-secondary-500"></i> Assessment Evidence Links
            </h2>
            <span className="text-[11px] text-foreground-400">{assessmentSignals.length} recent linked attempt(s)</span>
          </div>
          {assessmentSignals.length === 0 ? (
            <EmptyState text="No quiz attempts with KSB links were returned yet." />
          ) : (
            <div className="space-y-3">
              {assessmentSignals.map((attempt, index) => (
                <div key={`${attempt.quizId}-${attempt.attempt ?? 0}-${attempt.submittedAt}-${index}`} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      attempt.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-700'
                    }`}>
                      <i className="ri-question-answer-line text-base"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground-900">{attempt.quizName}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          attempt.passed
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {attempt.passed ? 'Passed' : 'Submitted'}
                        </span>
                      </div>
                      <p className="text-[11px] text-foreground-500 mt-1">
                        {attempt.module || 'Quiz'} - Submitted {formatDisplayDate(attempt.submittedAt)}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-foreground-500">
                        <span>{attempt.grade}{attempt.Score ? ` - ${attempt.Score}` : ''}</span>
                        <span>{attempt.ksbs?.length || 0} linked KSB(s)</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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

function queueBadge(evidence: NonNullable<CaseFileTabProps['data']['evidence']>) {
  if (evidence.isOverdue) return 'bg-red-50 text-red-700 border-red-200';
  if (evidence.pendingEvidence > 0) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
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
  tone: 'primary' | 'amber' | 'emerald' | 'red';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    amber: 'bg-amber-100 text-amber-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    red: 'bg-red-100 text-red-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
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
    <div className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg bg-background-50 border border-background-200 flex items-center justify-center">
          <i className={`${icon} text-sm text-foreground-600`}></i>
        </span>
        <p className="text-[12px] font-semibold text-foreground-900">{title}</p>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{detail}</p>
    </div>
  );
}
