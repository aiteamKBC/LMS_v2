import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/pages/users/components/Modal';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchAssignedLearners, type LearnerTarget, type LearnerDirectoryPage } from '@/api/assignedLearners';
import { Context, createCountStore, keyFor, type CountState } from './assignedLearnerDirectory';

export function LearnerDirectoryProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createCountStore, []);
  const [selection, setSelection] = useState<{ target: LearnerTarget; manage?: () => void | Promise<unknown> } | null>(null);
  useEffect(() => () => store.dispose(), [store]);
  const open = useCallback((target: LearnerTarget, manage?: () => void | Promise<unknown>) => setSelection(current =>
    current && keyFor(current.target) === keyFor(target) ? current : { target, manage }), []);
  const context = useMemo(() => ({ store, open }), [store, open]);
  return <Context.Provider value={context}>{children}{selection && <DirectoryDialog key={keyFor(selection.target)}
    target={selection.target} store={store} onClose={() => setSelection(current => current === selection ? null : current)} onManage={selection.manage} />}</Context.Provider>;
}

export function AssignedLearners({ target, initialCount, onManage, render }: {
  target: LearnerTarget; initialCount?: number | null; onManage?: () => void | Promise<unknown>;
  render?: (count: string, open: (event?: { stopPropagation: () => void }) => void) => ReactNode;
}) {
  const context = useContext(Context);
  const [state, setState] = useState<CountState>({ count: initialCount ?? null });
  const { scope, id, name } = target;
  useEffect(() => {
    setState({ count: initialCount ?? null });
    return context?.store.subscribe({ scope, id, name }, setState);
  }, [context?.store, scope, id, name, initialCount]);
  const open = (event?: { stopPropagation: () => void }) => { event?.stopPropagation(); context?.open(target, onManage); };
  const count = state.count === null ? 'View' : String(state.count);
  if (render) return render(count, open);
  return <button type="button" onClick={open} title={`View active assigned learners in ${name}`}
    aria-label={state.count === null ? `${name}: view assigned learners` : `${name}: ${count} active assigned learners`}
    className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-lg border border-primary-100 bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
    <AppIcon className="ri-group-line" aria-hidden="true" />{count} learners
  </button>;
}

function DirectoryDialog({ target, store, onClose, onManage }: {
  target: LearnerTarget; store: ReturnType<typeof createCountStore>; onClose: () => void; onManage?: () => void | Promise<unknown>;
}) {
  const [status, setStatus] = useState<'active' | 'all'>('active'), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [result, setResult] = useState<LearnerDirectoryPage | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [managing, setManaging] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), version = ++latest.current;
    setLoading(true); setError(''); setResult(null);
    const timer = window.setTimeout(async () => {
      try {
        const data = await fetchAssignedLearners(target, status, search.trim(), page, controller.signal);
        if (controller.signal.aborted || version !== latest.current) return;
        setResult(data); if (status === 'active') store.update(target, data.total);
      } catch (reason) {
        if (!controller.signal.aborted && version === latest.current) setError(reason instanceof Error ? reason.message : 'Could not load assigned learners.');
      } finally { if (!controller.signal.aborted && version === latest.current) setLoading(false); }
    }, search.trim() ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [target, store, status, search, page, retry]);
  return <Modal title={`${target.name} — Assigned learners`} onClose={onClose} size="max-w-2xl" footer={onManage ?
    <button type="button" disabled={managing} onClick={async () => {
      setManaging(true);
      try { await onManage(); onClose(); }
      catch { setError('Could not open assignments. Please retry.'); setManaging(false); }
    }} className="rounded-lg border border-primary-200 px-3 py-2 text-sm font-semibold text-primary-700 disabled:opacity-60">{managing ? 'Opening assignments...' : 'Assignments & progress'}</button> : undefined}>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="flex-1 text-xs font-semibold">Search learners<input type="search" value={search} maxLength={100} onChange={event => { setSearch(event.target.value); setPage(1); }}
        className="mt-1 block w-full rounded-lg border border-background-200 px-3 py-2 text-sm" /></label>
      <label className="text-xs font-semibold">Status<select value={status} onChange={event => { setStatus(event.target.value as 'active' | 'all'); setPage(1); }}
        className="mt-1 block rounded-lg border border-background-200 px-3 py-2 text-sm"><option value="active">Active learners</option><option value="all">All statuses</option></select></label>
    </div>
    <p role="status" className="mb-3 text-xs text-foreground-500">{loading ? 'Loading assigned learners…' : result ? `${result.total} assigned learners${search.trim() ? ` · ${result.filteredTotal} matching` : ''}` : ''}</p>
    {error && <div role="alert" className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 font-semibold underline">Retry</button></div>}
    {result && <><ul className="divide-y divide-background-200">{result.learners.map(learner => <li key={learner.id} className="flex items-center justify-between gap-3 py-3">
      <span className="min-w-0"><span className="block truncate text-sm font-semibold">{learner.name || 'Unnamed learner'}</span><span className="block truncate text-xs text-foreground-500">{learner.email}</span></span>
      <span className="shrink-0 rounded-full bg-background-100 px-2 py-1 text-[11px]">{learner.status || 'Not specified'}</span>
    </li>)}</ul>{!result.learners.length && <p className="py-6 text-center text-sm text-foreground-500">{search.trim() ? 'No learners match this search.' : 'No assigned learners in this view.'}</p>}
      {result.filteredTotal > result.pageSize && <nav aria-label="Learner pages" className="mt-3 flex items-center justify-end gap-3 text-xs">
        <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>Page {page} of {Math.ceil(result.filteredTotal / result.pageSize)}</span>
        <button type="button" disabled={page * result.pageSize >= result.filteredTotal || loading} onClick={() => setPage(value => value + 1)}>Next</button>
      </nav>}</>}
  </Modal>;
}
