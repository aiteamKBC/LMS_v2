import { useCaseFileSession } from '@/features/coach/case-file/hooks/CaseFileSession';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { AssignmentSubmissions } from '@/pages/learner/monthly-submission/AssignmentSubmissions';
import { groupMonthlyAssignments, monthName, statusLabels } from '@/pages/learner/monthly-submission/model';
import { useMonthlyAssignmentPlan } from '@/pages/learner/monthly-submission/useMonthlyAssignmentPlan';
import { hasSubmission } from './assignmentSubmitted';
import type { useCaseFileMarking } from '../useCaseFileMarking';

/**
 * Every assignment this learner has submitted, by Training Plan month, with the
 * same submission history and PDF report the learner sees on Monthly
 * submission. Read only: marking stays in the Marking queue.
 */
function LegacyAssignmentsTab({ kind, learnerId, markingState }: {
  kind: LearnerKind;
  learnerId: string;
  markingState?: ReturnType<typeof useCaseFileMarking>;
}) {
  const { real, loading, loadError, refresh } = useLearnerDetailParam(kind, learnerId);
  const plan = useMonthlyAssignmentPlan(kind, learnerId);
  const months = useMemo(() => (real
    ? groupMonthlyAssignments(real, plan.metadata, plan.contract, plan.statuses, plan.submissionCounts)
      .map(group => ({ ...group, assignments: group.assignments.filter(hasSubmission) }))
      .filter(group => group.assignments.length > 0)
      // Latest month first; unscheduled work last.
      .sort((a, b) => a.month && b.month ? b.month.localeCompare(a.month) : a.month ? -1 : b.month ? 1 : 0)
    : []), [real, plan.metadata, plan.contract, plan.statuses, plan.submissionCounts]);
  if (loading || plan.loading || markingState?.loading) {
    return <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5" role="status" aria-label="Loading assignments"><RowsSkeleton rows={4} /></div>;
  }
  if (loadError) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p>{loadError}</p>
      <button type="button" onClick={refresh} className="mt-3 rounded-lg border border-red-200 px-3 py-1.5 font-semibold hover:bg-red-100">Retry assignments</button>
    </div>;
  }
  if (markingState?.error) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p>{markingState.error}</p>
      <button type="button" onClick={markingState.retry} className="mt-3 rounded-lg border border-red-200 px-3 py-1.5 font-semibold hover:bg-red-100">Retry marking</button>
    </div>;
  }

  return <AssignmentList months={months} errors={plan.errors} retry={plan.retry} kind={kind} learnerId={learnerId} />;
}

type Months = ReturnType<typeof groupMonthlyAssignments>;

interface HistoricalAssessment {
  id: string;
  title: string;
  date: string | null;
  sourceStatus: string;
  originalFeedback: Array<{ author?: string; message?: string }>;
  lmsReviews: Array<{ decision: string; feedback: string; reviewedBy: string; reviewedAt: string }>;
}

function HistoricalCoachAssessments() {
  const session = useCaseFileSession();
  const [items, setItems] = useState<HistoricalAssessment[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(session));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    void session.read<{ items: HistoricalAssessment[] }>('assignments', { resource: 'historical' },
      { signal: controller.signal, refresh: attempt > 0 }).then(payload => {
      if (!controller.signal.aborted) setItems(payload.items);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Historical assessments are unavailable.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session, attempt]);
  if (!session) return null;
  if (loading) return <p role="status">Loading historical assessments…</p>;
  if (error) return <div role="alert">{error}<button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!items.length) return null;
  return <section className="rounded-xl border border-foreground-200 bg-white p-4" aria-label="Historical assessments and LMS reviews">
    <h3 className="font-semibold">Historical Aptem assessments</h3>
    <div className="mt-3 space-y-2">{items.map(item => <details key={item.id} className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{item.title} · {item.sourceStatus} · {item.date || 'Date not recorded'}</summary>
      <div className="mt-3 space-y-2">
        {item.originalFeedback.map((feedback, index) => <p key={index} className="whitespace-pre-wrap"><strong>Original coach feedback{feedback.author ? ` · ${feedback.author}` : ''}:</strong> {feedback.message || 'No text recorded'}</p>)}
        {item.lmsReviews.map((review, index) => <p key={index} className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3"><strong>LMS review · {review.decision} · {review.reviewedBy} · {review.reviewedAt.slice(0, 10)}:</strong> {review.feedback}</p>)}
      </div>
    </details>)}</div>
  </section>;
}

export default function AssignmentsTab(props: { kind: LearnerKind; learnerId: string; markingState?: ReturnType<typeof useCaseFileMarking> }) {
  const session = useCaseFileSession();
  return session ? <SectionAssignments {...props} /> : <LegacyAssignmentsTab {...props} />;
}

function SectionAssignments({ kind, learnerId }: { kind: LearnerKind; learnerId: string }) {
  const session = useCaseFileSession();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ months?: Months; errors?: string[]; error?: string }>({});
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setState({});
    void session.read<{ months: Months; errors: string[] }>('assignments', {}, { signal: controller.signal, refresh: attempt > 0 }).then(payload => {
      if (!controller.signal.aborted) setState(payload);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Unable to load assignments.' });
    });
    return () => controller.abort();
  }, [session, attempt]);
  const retry = () => setAttempt(value => value + 1);
  if (state.error) return <div role="alert">{state.error}<button type="button" onClick={retry}>Retry assignments</button></div>;
  if (!state.months) return <div role="status" aria-label="Loading assignments"><RowsSkeleton rows={4} /></div>;
  return <AssignmentList months={state.months} errors={state.errors || []} retry={retry} kind={kind} learnerId={learnerId} />;
}

function AssignmentList({ months, errors, retry, kind, learnerId }: { months: Months; errors: string[]; retry: () => void; kind: LearnerKind; learnerId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = months.reduce((sum, group) => sum + group.assignments.length, 0);
  return <section className="space-y-4" aria-label="Submitted assignments">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-foreground-900">Assignments</h2>
        <p className="text-sm text-foreground-500">Everything this learner has submitted, with coach feedback. Preview or download each submission as a PDF report.</p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
        <FileText size={14} aria-hidden="true" />{total} submitted
      </span>
    </div>

    {errors.length > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      {errors.map(message => <p key={message}>{message}</p>)}
      <p>Some submitted assignments may be missing from this list until the details load.</p>
      <button type="button" onClick={retry} className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 font-semibold hover:bg-amber-100">Retry details</button>
    </div>}

    {months.length === 0 ? (
      <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-8 text-center text-sm text-foreground-500">
        <FileText size={24} aria-hidden="true" className="mx-auto mb-2 text-foreground-300" />
        This learner has not submitted any assignments yet.
      </div>
    ) : months.map(group => <section key={group.month || 'unscheduled'} aria-label={`Assignments for ${monthName(group.month)}`}
      className="rounded-xl border border-foreground-200/60 bg-background-50">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-foreground-200/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground-900">
          {monthName(group.month)}{group.label && group.label !== monthName(group.month) ? ` — ${group.label}` : ''}
        </h3>
        <span className="text-xs text-foreground-500">{group.assignments.length} assignment{group.assignments.length === 1 ? '' : 's'}</span>
      </header>
      <ul className="divide-y divide-foreground-200/60">
        {group.assignments.map(row => {
          const key = `${group.month}:${row.id}`;
          const expanded = open === key;
          const panelId = `case-file-assignment-${row.id}`;
          return <li key={row.id}>
            <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : key)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300">
              <FileText size={18} aria-hidden="true" className="shrink-0 text-primary-600" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground-900">{row.component}</span>
                <span className="block text-xs text-foreground-500">
                  {[row.module, row.week, row.submissionCount !== undefined ? `${row.submissionCount} submission${row.submissionCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-foreground-200 px-2 py-0.5 text-[11px] font-semibold text-foreground-700">
                {statusLabels[row.status] || row.status.replaceAll('_', ' ')}
              </span>
              {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            </button>
            {/* Mounted only when open: each one loads its own submission history. */}
            {expanded && <div id={panelId} className="px-4 pb-4">
              <AssignmentSubmissions kind={kind} learnerId={learnerId} activityId={row.id} status={row.status}
                submissionCount={row.submissionCount} marking={row.marking} month={group.month} />
            </div>}
          </li>;
        })}
      </ul>
    </section>)}
    <HistoricalCoachAssessments />
  </section>;
}
