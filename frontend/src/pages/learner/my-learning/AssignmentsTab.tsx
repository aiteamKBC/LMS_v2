import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { RowsSkeleton } from '@/components/feature/Skeletons';

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
  draft: 'Draft', submitted_for_tutor_review: 'Submitted for review',
  accepted: 'Accepted', referred: 'Referred', returned: 'Returned',
};

export function AssignmentsTab({ kind, id }: { kind?: string; id?: string }) {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!kind || !id) { setRows([]); setLoading(false); return; }
    const controller = new AbortController();
    setRows([]); setLoading(true); setError('');
    const query = new URLSearchParams({ learnerKind: kind, learnerId: id, view: 'assignments' });
    fetch(`/learner_api/reflection/submissions/?${query}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.assignments)) throw new Error(data.error || 'Could not load assignments.');
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
    <SectionHeader title="Assignments" description="Your classified assignments, organised by month" icon="ri-file-list-3-line" />
    {loading ? <RowsSkeleton /> : error ? <Panel><div role="alert" className="text-sm text-red-700">{error}</div><button className="mt-3 text-sm underline" onClick={() => setRetry(n => n + 1)}>Retry</button></Panel>
      : months.length === 0 ? <Panel><EmptyState size="sm" title="No classified assignments available yet" description="Assignments from your classification records will appear here by month." /></Panel>
      : months.map(([month, assignments], index) => <details key={month} open={index === 0} className="overflow-hidden rounded-2xl border border-purple-100 bg-white">
        <summary className="cursor-pointer bg-purple-50/50 px-5 py-4 font-semibold text-slate-900">
          {month ? new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Undated assignments'}
          <span className="ml-3 text-sm font-normal text-slate-500">{assignments.length} assignment{assignments.length === 1 ? '' : 's'}</span>
        </summary>
        <div className="divide-y divide-slate-100">{assignments.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div><h3 className="font-medium text-slate-900">{row.title || 'Assignment'}</h3><p className="mt-1 text-sm text-slate-500">{row.moduleTitle}</p><span className="mt-2 inline-block rounded-full bg-purple-50 px-3 py-1 text-xs text-purple-800">{statusLabels[row.status] || row.status.replaceAll('_', ' ')}</span></div>
          <Link className="rounded-lg border border-purple-200 px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-50" to={`/learner/${['imported_legacy', 'classified_legacy'].includes(row.submissionOrigin || '') ? 'historical-assignment' : 'monthly-submission'}/${kind}/${id}/${encodeURIComponent(row.activityId)}`}>{row.status === 'draft' ? 'Continue draft' : 'Open submission'}</Link>
        </div>)}</div>
      </details>)}
  </div>;
}
