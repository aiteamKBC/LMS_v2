import { useContext, useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import {
  changeProgrammeMembership, fetchAssignedLearnerProgress, type ActivityMetric,
  type AssignedLearner, type AssignedLearnerProgress, type LearnerTarget,
} from '@/api/assignedLearners';
import { Context } from './assignedLearnerDirectory';
import { learnerStatusLabel } from './learnerStatusLabels';

const normalized = (value: string) => value.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
const statusTone = (status: string) => ({
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  withdrawn: 'border-rose-200 bg-rose-50 text-rose-800',
  'on break': 'border-amber-200 bg-amber-50 text-amber-800',
  completed: 'border-sky-200 bg-sky-50 text-sky-800',
}[normalized(status)] || 'border-background-300 bg-background-100 text-foreground-600');

function Metric({ label, metric, due = false }: { label: string; metric: ActivityMetric | null; due?: boolean }) {
  const tone = due && metric?.total && metric.completed < metric.total ? 'bg-amber-500' : due ? 'bg-emerald-500' : 'bg-primary-500';
  return <div className="min-w-0">
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className="font-semibold text-foreground-600">{label}</span>
      <span className="font-bold tabular-nums text-foreground-900">{metric?.percent == null ? '—' : `${metric.percent}%`}</span>
    </div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metric?.percent ?? undefined}
      aria-valuetext={!metric ? 'Plan dates need review' : metric.total ? `${metric.completed} of ${metric.total} activities completed` : 'No activities'}
      className="h-2 overflow-hidden rounded-full bg-background-200">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${metric?.percent ?? 0}%` }} />
    </div>
    <p className="mt-2 text-[11px] text-foreground-500">{!metric ? 'Plan dates need review'
      : !metric.total ? due ? 'Nothing due yet' : 'No available activities'
        : `${metric.completed} / ${metric.total} ${due ? 'due' : 'available'} activities`}</p>
  </div>;
}

export function AssignedLearnerList({ target, learners, onChanged, onBusyChange }: {
  target: LearnerTarget; learners: AssignedLearner[]; onChanged: (message: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const context = useContext(Context);
  const [progress, setProgress] = useState<Record<string, AssignedLearnerProgress>>({});
  const [retry, setRetry] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setProgress({});
    void (async () => {
      // Bounded batches let the first rows render without waiting for the whole roster.
      for (let offset = 0; offset < learners.length && !controller.signal.aborted; offset += 5) {
        const batch = learners.slice(offset, offset + 5).map(learner => learner.id);
        try {
          const rows = await fetchAssignedLearnerProgress(target, batch, controller.signal);
          if (!controller.signal.aborted) setProgress(previous => ({ ...previous, ...rows }));
        } catch (reason) {
          if (!controller.signal.aborted) setProgress(previous => ({ ...previous, ...Object.fromEntries(batch.map(id => [id,
            { error: reason instanceof Error ? reason.message : 'Progress is unavailable. Please retry.' }])) }));
        }
      }
    })();
    return () => controller.abort();
  }, [target, learners, retry]);

  const change = async (learner: AssignedLearner, action: 'remove' | 'restore') => {
    if (pending.current) return;
    pending.current = true;
    setBusyId(learner.id); onBusyChange(true); setError('');
    try {
      await showCurriculumConfirm({
        title: `${action === 'remove' ? 'Remove' : 'Restore'} ${learner.name || 'this learner'} ${action === 'remove' ? 'from' : 'to'} the programme?`,
        text: `${learner.programme}. ${action === 'remove' ? 'Programme status will become Withdrawn.' : 'Programme status will become Active.'} Learning progress, submissions, attendance and audit history will be kept.`,
        icon: action === 'remove' ? 'warning' : 'question',
        confirmButtonText: action === 'remove' ? 'Remove from programme' : 'Restore to programme',
        cancelButtonText: 'Keep current status',
        onConfirm: async () => {
          await changeProgrammeMembership(target, learner, action);
          context?.store.refreshAll();
          context?.statusStore.refreshAll();
          onChanged(`${learner.name || 'Learner'} ${action === 'remove' ? 'removed from the programme. Choose Withdrawn or All statuses to restore them.' : 'restored to the programme.'}`);
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update programme membership.');
    } finally {
      pending.current = false; setBusyId(null); onBusyChange(false);
    }
  };
  const errors = Object.values(progress).some(row => 'error' in row);
  return <>
    {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {errors && <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
      <span>Some learner progress could not be loaded. Membership actions remain available.</span>
      <button type="button" onClick={() => setRetry(value => value + 1)} className="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 font-bold">Retry progress</button>
    </div>}
    <ul className="space-y-3">{learners.map(learner => {
      const row = progress[learner.id];
      const state = normalized(learner.status);
      const action = state === 'withdrawn' ? 'restore' : ['active', 'on break'].includes(state) ? 'remove' : null;
      const canChange = Boolean(action && learner.enrolmentId && learner.programme);
      return <li key={learner.id} className="rounded-2xl border border-background-200 bg-background-50 p-4 shadow-sm">
        <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-sm font-bold text-primary-700">{(learner.name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground-900" title={learner.name}>{learner.name || 'Unnamed learner'}</p>
              <p className="mt-0.5 truncate text-xs text-foreground-500" title={learner.email}>{learner.email}</p>
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone(learner.status)}`}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{learnerStatusLabel(state || 'unknown')}
              </span>
            </div>
          </div>
          {row && !('error' in row) ? <>
            <div title={`As of ${row.asOfDate} · UK learning plan`}><Metric label="Plan to date" metric={row.due} due />
              {row.undatedActivities > 0 && <p className="mt-1 text-[10px] text-amber-700">{row.undatedActivities} activities need plan dates</p>}</div>
            <Metric label="Available content" metric={row.available} />
          </> : <div className="text-xs text-foreground-500 md:col-span-2" role="status">{row && 'error' in row ? row.error : 'Loading activity progress…'}</div>}
          <div className="flex flex-col items-start gap-1.5 md:col-span-3 md:items-end xl:col-span-1">
            {action && <button type="button" disabled={!canChange || busyId !== null} onClick={() => void change(learner, action)}
              aria-label={`${action === 'remove' ? 'Remove' : 'Restore'} ${learner.name || 'learner'} ${action === 'remove' ? 'from' : 'to'} programme`}
              title={canChange ? `${action === 'remove' ? 'Remove from' : 'Restore to'} ${learner.programme}` : 'Programme membership needs an enrolment identity review'}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50 ${action === 'restore' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'border-rose-200 bg-background-50 text-rose-700 hover:bg-rose-50'}`}>
              <AppIcon className={action === 'restore' ? 'ri-user-add-line' : 'ri-user-unfollow-line'} />
              {busyId === learner.id ? 'Please wait…' : action === 'restore' ? 'Restore' : 'Remove'}
            </button>}
            {action && !canChange && <span className="text-[10px] text-foreground-500">Identity review required</span>}
            {learner.programme && <span className="max-w-40 truncate text-[10px] text-foreground-400" title={learner.programme}>{learner.programme}</span>}
          </div>
        </div>
      </li>;
    })}</ul>
  </>;
}
