import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/pages/users/components/Modal';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchAssignedLearners, type LearnerTarget, type LearnerDirectoryPage } from '@/api/assignedLearners';
import { Context, createCountStore, keyFor, type CountState } from './assignedLearnerDirectory';
import { createLearnerStatusCountStore } from './learnerStatusCountStore';
import { learnerStatusLabel } from './learnerStatusLabels';
import { useLiveRefresh } from '@/hooks/useRefreshOnReturn';
import { AssignedLearnerList } from './AssignedLearnerList';

export function LearnerDirectoryProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createCountStore, []);
  const statusStore = useMemo(createLearnerStatusCountStore, []);
  const [selection, setSelection] = useState<{ target: LearnerTarget; manage?: () => void | Promise<unknown>; status: string } | null>(null);
  useEffect(() => () => { store.dispose(); statusStore.dispose(); }, [store, statusStore]);
  useLiveRefresh(() => statusStore.refreshAll());
  const open = useCallback((target: LearnerTarget, manage?: () => void | Promise<unknown>, status = 'active') => setSelection(current =>
    current && keyFor(current.target) === keyFor(target) && current.status === status ? current : { target, manage, status }), []);
  const context = useMemo(() => ({ store, statusStore, open }), [store, statusStore, open]);
  return <Context.Provider value={context}>{children}{selection && <DirectoryDialog key={`${keyFor(selection.target)}:${selection.status}`}
    target={selection.target} store={store} initialStatus={selection.status} onClose={() => setSelection(current => current === selection ? null : current)} onManage={selection.manage} />}</Context.Provider>;
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

function DirectoryDialog({ target, store, onClose, onManage, initialStatus = 'active' }: {
  target: LearnerTarget; store: ReturnType<typeof createCountStore>; onClose: () => void; onManage?: () => void | Promise<unknown>;
  initialStatus?: string;
}) {
  const [status, setStatus] = useState(initialStatus), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [result, setResult] = useState<LearnerDirectoryPage | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [managing, setManaging] = useState(false);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipNotice, setMembershipNotice] = useState('');
  const latest = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), version = ++latest.current;
    setLoading(true); setError(''); setResult(null);
    const timer = window.setTimeout(async () => {
      try {
        const data = await (['all', 'active'].includes(status)
          ? fetchAssignedLearners(target, status as 'active' | 'all', search.trim(), page, controller.signal)
          : fetchAssignedLearners(target, 'all', search.trim(), page, controller.signal, status));
        if (controller.signal.aborted || version !== latest.current) return;
        setResult(data); if (status === 'active') store.update(target, data.total);
      } catch (reason) {
        if (!controller.signal.aborted && version === latest.current) setError(reason instanceof Error ? reason.message : 'Could not load assigned learners.');
      } finally { if (!controller.signal.aborted && version === latest.current) setLoading(false); }
    }, search.trim() ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [target, store, status, search, page, retry]);
  const reloadMembership = (message: string) => { setMembershipNotice(message); setRetry(value => value + 1); };
  return <Modal title={<span className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700"><AppIcon className="ri-team-line text-xl" /></span><span><span className="block text-[10px] font-bold uppercase tracking-widest text-primary-600">{target.scope} · Assigned learners</span><span className="mt-1 block">{target.name}</span></span></span>}
    onClose={onClose} dismissible={!membershipBusy} size="max-w-6xl" footer={<><span className="mr-auto hidden items-center gap-1.5 text-[11px] text-foreground-500 sm:inline-flex"><AppIcon className="ri-shield-check-line" />Learning history is preserved</span>{onManage &&
    <button type="button" disabled={managing || membershipBusy} onClick={async () => {
      setManaging(true);
      try { await onManage(); onClose(); }
      catch { setError('Could not open assignments. Please retry.'); setManaging(false); }
    }} className="rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-primary-700 disabled:opacity-60">{managing ? 'Opening assignments...' : 'Assignments & progress'}</button>}</>}>
    <div className="mb-5 grid grid-cols-2 gap-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-4">
      <div><p className="text-xs font-bold text-foreground-800">Plan to date</p><p className="mt-1 text-xs leading-relaxed text-foreground-500">Completed ÷ activities due by today.</p></div>
      <div><p className="text-xs font-bold text-foreground-800">Available content</p><p className="mt-1 text-xs leading-relaxed text-foreground-500">Completed ÷ all available activities in this {target.scope}.</p></div>
      <p className="col-span-2 text-[10px] text-foreground-500">UK plan dates · Future completions do not cover overdue work.</p>
    </div>
    {membershipNotice && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">{membershipNotice}</p>}
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-xs font-semibold text-foreground-600">Search learners<input type="search" value={search} disabled={membershipBusy} maxLength={100} placeholder="Search by name or email…" onChange={event => { setSearch(event.target.value); setPage(1); }}
        className="mt-2 block min-h-10 w-full rounded-xl border border-background-300 bg-background-50 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" /></label>
      <label className="text-xs font-semibold text-foreground-600">Status<select value={status} disabled={membershipBusy} onChange={event => { setStatus(event.target.value); setPage(1); }}
        className="mt-2 block min-h-10 rounded-xl border border-background-300 bg-background-50 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"><option value="active">Active learners</option><option value="all">All statuses</option>
        {[...new Set(['withdrawn', 'on break', 'completed', ...(!['active', 'all'].includes(initialStatus) ? [initialStatus] : [])])].map(value => <option key={value} value={value}>{learnerStatusLabel(value)}</option>)}
      </select></label>
    </div>
    <p role="status" className="mb-3 text-xs text-foreground-500">{loading ? 'Loading assigned learners…' : result ? `${result.total} assigned learners${search.trim() ? ` · ${result.filteredTotal} matching` : ''}` : ''}</p>
    {error && <div role="alert" className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 font-semibold underline">Retry</button></div>}
    {result && <><AssignedLearnerList target={target} learners={result.learners} onChanged={reloadMembership} onBusyChange={setMembershipBusy} />{!result.learners.length && <p className="py-6 text-center text-sm text-foreground-500">{search.trim() ? 'No learners match this search.' : 'No assigned learners in this view.'}</p>}
      {result.filteredTotal > result.pageSize && <nav aria-label="Learner pages" className="mt-3 flex items-center justify-end gap-3 text-xs">
        <button type="button" disabled={page <= 1 || loading || membershipBusy} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>Page {page} of {Math.ceil(result.filteredTotal / result.pageSize)}</span>
        <button type="button" disabled={page * result.pageSize >= result.filteredTotal || loading || membershipBusy} onClick={() => setPage(value => value + 1)}>Next</button>
      </nav>}</>}
  </Modal>;
}
