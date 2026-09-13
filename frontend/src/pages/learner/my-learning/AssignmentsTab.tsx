import { readLearnerJson } from '@/api/learnerRead';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { PageTabs } from '@/components/ui/PageTabs';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { LearnerDetail } from '@/api/learnerDetail';
import { completedComponentIds, componentRequiresEvidence, hasComponentContent } from '@/utils/learnerJourney';
import { useSubjectMetadata } from './SubjectWorkspace';

type Assignment = {
  id: string; activityId: string; title: string; moduleTitle: string; status: string;
  month: string | null; dateCompleted: string | null; submittedAt: string | null;
  submissionOrigin?: string;
};

export function assignmentMonth(row: Pick<Assignment, 'month' | 'dateCompleted' | 'submittedAt'>): string {
  for (const date of [row.month, row.dateCompleted, row.submittedAt]) {
    const match = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:$|-|T)/.exec(date || '');
    if (match) return match[1];
  }
  return '';
}

const statusLabels: Record<string, string> = {
  todo: 'To do', draft: 'Draft', submitted_for_tutor_review: 'Submitted for review',
  accepted: 'Accepted', referred: 'Referred', returned: 'Returned',
  rejected: 'Returned', partial: 'Partially accepted', completed: 'Completed',
};

type AssignmentFilter = 'all' | 'todo' | 'submitted' | 'completed';
const assignmentFilter = (status: string): AssignmentFilter =>
  ['accepted', 'completed'].includes(status) ? 'completed'
    : status === 'submitted_for_tutor_review' ? 'submitted' : 'todo';

function AssignedList({ real, kind, id, canTake }: {
  real: LearnerDetail; kind?: string; id?: string; canTake: boolean;
}) {
  const [filter, setFilter] = useState<AssignmentFilter>('all');
  const [statuses, setStatuses] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const { metadata, error: datesError, retry: retryDates } = useSubjectMetadata(null, real, kind, id, true, true);
  useEffect(() => {
    if (!kind || !id) return;
    const controller = new AbortController();
    setStatuses(null); setError('');
    const query = new URLSearchParams({ learnerKind: kind, learnerId: id });
    void readLearnerJson<{ statuses: Array<{ activityType: string; activityId: string; status: string }> }>(
      `/learner_api/reflection/submissions/?${query}`, { signal: controller.signal },
    ).then(data => {
      if (!Array.isArray(data.statuses)) throw new Error('Could not load assignment statuses.');
      if (!controller.signal.aborted) setStatuses(Object.fromEntries(data.statuses
        .filter(row => row.activityType === 'assignment').map(row => [row.activityId, row.status])));
    }).catch(() => { if (!controller.signal.aborted) setError('Could not load assignment statuses. You can still open your assignments.'); });
    return () => controller.abort();
  }, [kind, id, real, retry]);

  const rows = useMemo(() => {
    const completed = completedComponentIds(real);
    const seen = new Set<string>();
    return real.components.filter(component => {
      if (!component.componentId || !componentRequiresEvidence(component.type) || seen.has(component.componentId)) return false;
      seen.add(component.componentId);
      return true;
    }).map(component => {
      const componentId = component.componentId!;
      const status = statuses?.[componentId] || real.componentMarkingStatus?.[componentId]?.status
        || (completed.has(componentId) ? 'completed' : statuses ? 'todo' : '');
      return { ...component, status, date: metadata?.activity_dates?.[componentId]?.date || component.sessionDate,
        hasSavedWork: ['draft', 'submitted_for_tutor_review', 'accepted', 'referred', 'returned', 'rejected', 'partial'].includes(status),
        hasContent: hasComponentContent({ ...component, title: component.component }) };
    });
  }, [real, statuses, metadata]);
  const filtered = filter === 'all' ? rows : rows.filter(row => row.status && assignmentFilter(row.status) === filter);

  return <section aria-label="Assigned assignments" className="space-y-3">
    <h2 className="text-base font-semibold text-slate-900">Assigned to you</h2>
    <PageTabs label="Filter assignments" value={filter} onChange={value => setFilter(value as AssignmentFilter)} items={[
      { value: 'all', label: 'All', count: rows.length },
      { value: 'todo', label: 'To Do', count: rows.filter(row => row.status && assignmentFilter(row.status) === 'todo').length },
      { value: 'submitted', label: 'Submitted', count: rows.filter(row => assignmentFilter(row.status) === 'submitted').length },
      { value: 'completed', label: 'Completed', count: rows.filter(row => assignmentFilter(row.status) === 'completed').length, tone: 'positive' },
    ]} />
    {error && <p role="alert" className="text-sm text-red-700">{error} <button className="underline" onClick={() => setRetry(value => value + 1)}>Retry statuses</button></p>}
    {datesError && <p role="alert" className="text-sm text-red-700">Could not load assignment dates. <button className="underline" onClick={retryDates}>Retry dates</button></p>}
    {filtered.length === 0 ? <Panel><EmptyState size="sm" title="No assignments match this filter" /></Panel> :
      <Panel padding="none"><div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="border-b bg-background-100/60 text-foreground-500"><tr>
          <th className="px-4 py-3">Assignment</th><th className="px-4 py-3">Week</th>
          <th className="px-4 py-3">Planned date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"><span className="sr-only">Action</span></th>
        </tr></thead>
        <tbody className="divide-y divide-foreground-100">{filtered.map(row => {
          const stage = assignmentFilter(row.status);
          const action = !canTake ? 'View assignment' : row.status === 'todo' ? 'Start assignment'
            : row.status === 'draft' ? 'Continue draft' : ['referred', 'returned', 'rejected', 'partial'].includes(row.status)
              ? 'Revise assignment' : ['submitted', 'completed'].includes(stage) ? 'Open submission' : 'Open assignment';
          return <tr key={row.componentId}>
            <td className="px-4 py-3"><h3 className="font-semibold text-foreground-900">{row.component || 'Assignment'}</h3><p className="mt-1 text-xs text-foreground-500">{row.module}</p>
              {!row.hasContent && <p className="mt-1 text-xs text-foreground-500">{row.hasSavedWork
                ? 'The assignment brief is currently unavailable. You can still open your saved work.'
                : 'Your tutor has not added the assignment brief or materials yet.'}</p>}</td>
            <td className="px-4 py-3">{row.week || 'Not specified'}</td>
            <td className="whitespace-nowrap px-4 py-3">{row.date ? new Date(`${row.date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB') : 'Not scheduled'}</td>
            <td className="px-4 py-3"><StatusBadge tone={stage === 'completed' ? 'positive' : 'neutral'} label={statusLabels[row.status] || row.status.replaceAll('_', ' ') || (error ? 'Status unavailable' : 'Loading status…')} /></td>
            <td className="whitespace-nowrap px-4 py-3 text-right">{!row.hasContent && !row.hasSavedWork ? <span className="text-foreground-500">Awaiting brief</span> : kind && id && <Link className="rounded-lg border border-purple-200 px-4 py-2 font-medium text-purple-800 hover:bg-purple-50"
              to={`/learner/monthly-submission/${kind}/${id}/${encodeURIComponent(row.componentId!)}`}>{action}</Link>}</td>
          </tr>;
        })}</tbody>
      </table></div></Panel>}
  </section>;
}

export function AssignmentsTab({ kind, id, real = null, loading: planLoading = false, loadError = null, onRetry, canTake = true }: {
  kind?: string; id?: string; real?: LearnerDetail | null; loading?: boolean;
  loadError?: string | null; onRetry?: () => void; canTake?: boolean;
}) {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const hasAssigned = !!real?.components?.some(component => component.componentId && componentRequiresEvidence(component.type));
  useEffect(() => {
    if (!kind || !id) { setRows([]); setLoading(false); return; }
    const controller = new AbortController();
    setRows([]); setLoading(true); setError('');
    const query = new URLSearchParams({ learnerKind: kind, learnerId: id, view: 'assignments' });
    readLearnerJson<{ assignments: Assignment[] }>(`/learner_api/reflection/submissions/?${query}`, { signal: controller.signal })
      .then(data => {
        if (!Array.isArray(data.assignments)) throw new Error('Could not load assignments.');
        if (!controller.signal.aborted) setRows(data.assignments);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load assignments.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, id, retry]);

  const months = useMemo(() => {
    const groups = new Map<string, Assignment[]>();
    for (const row of rows) {
      const key = assignmentMonth(row);
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    return [...groups].sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  return <div className="space-y-4">
    <SectionHeader title="Assignments" description="Your assigned work, drafts and previous submissions" icon="ri-file-list-3-line" />
    {planLoading && !real ? <RowsSkeleton /> : loadError ? <Panel><div role="alert" className="text-sm text-red-700">{loadError}</div>{onRetry && <button className="mt-3 text-sm underline" onClick={onRetry}>Retry assignments</button>}</Panel> : null}
    {hasAssigned && real && <AssignedList key={`${kind}:${id}`} real={real} kind={kind} id={id} canTake={canTake} />}
    {!planLoading && !loadError && !hasAssigned && !loading && !error && months.length === 0 && <Panel><EmptyState size="sm" title="No assignments linked yet" description="Assignments linked to your training plan will appear here." /></Panel>}
    {loading ? <p role="status" className="text-sm text-slate-500">Loading previous assignments…</p> : error ? <Panel><div role="alert" className="text-sm text-red-700">{error}</div><button className="mt-3 text-sm underline" onClick={() => setRetry(n => n + 1)}>Retry</button></Panel>
      : months.length > 0 && <section aria-label="Previous assignments" className="space-y-3"><h2 className="text-base font-semibold text-slate-900">Previous assignments</h2>{months.map(([month, assignments], index) => <details key={month} open={index === 0} className="overflow-hidden rounded-2xl border border-purple-100 bg-white">
        <summary className="cursor-pointer bg-purple-50/50 px-5 py-4 font-semibold text-slate-900">
          {month ? new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Undated assignments'}
          <span className="ml-3 text-sm font-normal text-slate-500">{assignments.length} assignment{assignments.length === 1 ? '' : 's'}</span>
        </summary>
        <div className="divide-y divide-slate-100">{assignments.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div><h3 className="font-medium text-slate-900">{row.title || 'Assignment'}</h3><p className="mt-1 text-sm text-slate-500">{row.moduleTitle}</p><span className="mt-2 inline-block rounded-full bg-purple-50 px-3 py-1 text-xs text-purple-800">{statusLabels[row.status] || row.status.replaceAll('_', ' ')}</span></div>
          <Link className="rounded-lg border border-purple-200 px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-50" to={`/learner/${['imported_legacy', 'classified_legacy'].includes(row.submissionOrigin || '') ? 'historical-assignment' : 'monthly-submission'}/${kind}/${id}/${encodeURIComponent(row.activityId)}`}>{row.status === 'draft' ? 'Continue draft' : 'Open submission'}</Link>
        </div>)}</div>
      </details>)}</section>}
  </div>;
}
