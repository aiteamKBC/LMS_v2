import { useContext, useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { LearnerTarget } from '@/api/assignedLearners';
import { Context } from './assignedLearnerDirectory';
import type { StatusCountState } from './learnerStatusCountStore';
import { learnerStatusLabel } from './learnerStatusLabels';

function statusMeta(status: string) {
  const key = status.replace(/[\s_-]+/g, '');
  if (key === 'active') return { icon: 'ri-checkbox-circle-line', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (key === 'withdrawn') return { icon: 'ri-user-unfollow-line', tone: 'border-red-200 bg-red-50 text-red-700' };
  if (['onbreak', 'onabreak', 'break', 'paused', 'onhold'].includes(key)) return { icon: 'ri-pause-circle-line', tone: 'border-amber-200 bg-amber-50 text-amber-800' };
  if (key === 'completed') return { icon: 'ri-graduation-cap-line', tone: 'border-sky-200 bg-sky-50 text-sky-700' };
  if (['enteredepa', 'epa'].includes(key)) return { icon: 'ri-medal-line', tone: 'border-violet-200 bg-violet-50 text-violet-700' };
  return { icon: status === 'all' ? 'ri-group-line' : 'ri-information-line', tone: 'border-foreground-200 bg-background-100 text-foreground-600' };
}

export function LearnerStatusCounts({ target, onManage, refreshKey }: { target: LearnerTarget; onManage?: () => void | Promise<unknown>; refreshKey?: unknown }) {
  const context = useContext(Context);
  const [state, setState] = useState<StatusCountState>({ value: null, loading: true, error: '' });
  const { scope, id, name } = target;
  useEffect(() => {
    setState({ value: null, loading: true, error: '' });
    return context?.statusStore.subscribe({ scope, id, name }, setState);
  }, [context?.statusStore, scope, id, name]);
  useEffect(() => {
    if (refreshKey !== undefined) context?.statusStore.refresh({ scope, id, name }, refreshKey);
  }, [context?.statusStore, scope, id, name, refreshKey]);
  if (!state.value) return <span className="inline-flex items-center gap-1 text-[11px] text-foreground-500" aria-label={`${name}: learner counts`}>
    {state.loading ? <span role="status" className="inline-flex gap-1"><span className="sr-only">Loading learner counts…</span>
      {['all', 'active', 'withdrawn', 'on break'].map(status => {
        const meta = statusMeta(status);
        return <span key={status} aria-hidden="true" className={`inline-flex min-h-7 items-center gap-1 rounded-lg border px-1.5 py-1 font-bold ${meta.tone}`}>
          <AppIcon className={meta.icon} /><span>…</span>
        </span>;
      })}
    </span> : <button type="button" onClick={event => { event.stopPropagation(); context?.statusStore.refresh(target); }}
      title={state.error} className="font-semibold text-red-700 underline">Retry learner counts</button>}
  </span>;
  const keys = ['all', 'active', 'withdrawn', ...Object.keys(state.value.statuses).filter(key => !['active', 'withdrawn'].includes(key))];
  return <span className="inline-flex flex-wrap items-center justify-center gap-1" role="group" aria-label={`${name}: learner counts`} aria-busy={state.loading}>
    {keys.map(status => {
      const count = status === 'all' ? state.value!.total : state.value!.statuses[status] || 0;
      const meta = statusMeta(status), label = learnerStatusLabel(status);
      return <button key={status} type="button" title={`${label}: ${count} learners`} aria-label={`${name}: ${count} ${label.toLowerCase()} learners`}
        onClick={event => { event.stopPropagation(); context?.open(target, onManage, status); }}
        className={`inline-flex min-h-7 items-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${meta.tone}`}>
        <AppIcon className={meta.icon} aria-hidden="true" /><span>{count}</span>
      </button>;
    })}
    {state.error && <button type="button" title={state.error} aria-label={`${name}: retry learner counts`} onClick={event => { event.stopPropagation(); context?.statusStore.refresh(target); }} className="text-red-700"><AppIcon className="ri-error-warning-line" /></button>}
  </span>;
}
