import { useContext, useEffect, useState } from 'react';
import { Context } from '../shared/entities/assignedLearnerDirectory';
import type { StatusCountState } from '../shared/entities/learnerStatusCountStore';

/** The module catalogue opens its assignments directly; other directories keep their own navigation. */
export function ModuleLearnerCount({ moduleId, moduleName, refreshKey, onOpen }: {
  moduleId: string;
  moduleName: string;
  refreshKey?: unknown;
  onOpen: () => Promise<number | null>;
}) {
  const context = useContext(Context);
  const [state, setState] = useState<StatusCountState>({ value: null, loading: true, error: '' });
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    setState({ value: null, loading: true, error: '' });
    return context?.statusStore.subscribe({ scope: 'module', id: moduleId, name: moduleName }, setState);
  }, [context?.statusStore, moduleId, moduleName]);
  useEffect(() => {
    if (refreshKey !== undefined) context?.statusStore.refresh({ scope: 'module', id: moduleId, name: moduleName }, refreshKey);
  }, [context?.statusStore, moduleId, moduleName, refreshKey]);

  const count = state.value?.total;
  return <span className="inline-flex items-center gap-1">
    <button type="button" disabled={opening} aria-busy={opening}
      aria-label={`${moduleName}: ${count == null ? 'view' : count} learners`}
      title="Open assignments & progress for all assigned learners"
      onClick={async event => {
        event.stopPropagation();
        setOpening(true);
        try { await onOpen(); }
        finally { setOpening(false); }
      }}
      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-primary-200 bg-primary-50 px-3 text-[11px] font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-wait disabled:opacity-60">
      {count == null ? 'View learners' : `${count} learner${count === 1 ? '' : 's'}`}
      {opening && <span className="ml-1.5" role="status">Opening…</span>}
    </button>
    {state.error && <button type="button" title={state.error} aria-label={`${moduleName}: retry learner count`}
      onClick={event => { event.stopPropagation(); context?.statusStore.refresh({ scope: 'module', id: moduleId, name: moduleName }); }}
      className="text-[11px] font-semibold text-red-700 underline">Retry count</button>}
  </span>;
}
