import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardCheck, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { qualityReviews, invalidateQualityReviews, type QualitySummary, type ReviewList } from '@/api/coachingQualityReviews';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { CALENDAR_TIME_ZONES } from '@/pages/curriculum/recordings/utils';
import { meetingDate } from './model';
import { readQualityLocation, writeQualityLocation } from './qualityLocation';
const QualityReviewDialog = lazy(() => import('./QualityReviewDialog'));
const control = 'min-w-0 w-full rounded-lg border border-background-200 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-primary-700 disabled:opacity-50';

export default function QualityReviewsPage() {
  const [params, setParams] = useSearchParams();
  const { filters: location, review: requestedReview, invalidReview } = readQualityLocation(params);
  const { start, end, coachEmail, status, search, timeZone } = location;
  const applied = useMemo(() => ({ start, end, coachEmail, status, search, timeZone }), [start, end, coachEmail, status, search, timeZone]);
  const [filters, setFilters] = useState(applied);
  const listKey = JSON.stringify(applied);
  const [rows, setRows] = useState<QualitySummary[]>([]), [coaches, setCoaches] = useState<ReviewList['coaches']>([]);
  const [page, setPage] = useState({ key: listKey, offset: 0 }), [next, setNext] = useState<number | null>(null), [epoch, setEpoch] = useState(0);
  const offset = page.key === listKey ? page.offset : 0;
  useEffect(() => { setPage({ key: listKey, offset: 0 }); }, [listKey]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [selected, setSelected] = useState(requestedReview);
  const dirty = useRef(false), pendingSave = useRef(false), acceptedLocation = useRef(params.toString());
  const reportDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const reportBusy = useCallback((value: boolean) => { pendingSave.current = value; }, []);
  useEffect(() => { setFilters(applied); }, [applied]);
  useEffect(() => {
    if (selected !== requestedReview) {
      if (pendingSave.current || (dirty.current && !window.confirm('Discard the unsaved changes to this review?'))) {
        setParams(new URLSearchParams(acceptedLocation.current)); return;
      }
      dirty.current = false; setSelected(requestedReview);
    }
    acceptedLocation.current = params.toString();
  }, [params, requestedReview, selected, setParams]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    if (!offset) { setRows([]); setNext(null); }
    void qualityReviews(applied, offset, abort.signal).then(value => {
      if (abort.signal.aborted) return;
      setRows(current => offset ? [...new Map([...current, ...value.reviews].map(row => [row.id, row])).values()] : value.reviews);
      setCoaches(value.coaches); setNext(value.nextOffset);
    }).catch(reason => { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Reviews could not be loaded.'); if (!offset) setRows([]); } })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [applied, offset, epoch]);
  const refresh = () => { invalidateQualityReviews(); setPage({ key: listKey, offset: 0 }); setEpoch(value => value + 1); };
  const apply = (event: React.FormEvent) => { event.preventDefault(); setParams(writeQualityLocation(filters)); };
  return <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" workspaceLabel="Curriculum Studio"
    pageTitle="Quality reviews & evidence" pageSubtitle="Saved portfolio sampling reviews by coach, learner and meeting" navItems={curriculumNavItems}>
    <main className="mx-auto w-full max-w-[1600px] space-y-5 p-3 sm:p-6">
      <Link className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700" to="/curriculum/coaching-recordings"><ArrowLeft size={16} />Coach meetings calendar</Link>
      {invalidReview && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">This saved review link is invalid. <button type="button" className={`${button} ml-2`} onClick={() => setParams(writeQualityLocation(applied))}>Close invalid review link</button></div>}
      <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-primary-600">Quality workspace</p>
        <h1 className="mt-2 text-2xl font-bold text-foreground-950">Reviewed meetings & evidence</h1><p className="mt-2 text-sm text-foreground-600">Open a saved review to see its observations, screenshots and action plan. Completed reviews include a PDF.</p></div>
        <button className={button} disabled={loading} onClick={refresh}><RefreshCw size={15} />Refresh reviews</button></header>
      <form onSubmit={apply} className="grid items-end gap-3 rounded-xl border border-background-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <label className="grid gap-1 text-xs font-semibold">Coach<select className={control} value={filters.coachEmail} onChange={event => setFilters({ ...filters, coachEmail: event.target.value })}><option value="">All coaches</option>{coaches.map(coach => <option key={coach.email} value={coach.email}>{coach.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold">From<input required type="date" className={control} value={filters.start} onChange={event => setFilters({ ...filters, start: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold">To<input required type="date" min={filters.start} className={control} value={filters.end} onChange={event => setFilters({ ...filters, end: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold">Review status<select className={control} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="completed">Completed</option><option value="draft">Drafts</option><option value="">All saved reviews</option></select></label>
        <label className="grid gap-1 text-xs font-semibold">Learner or meeting<input type="search" maxLength={200} className={control} value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold">Time zone<select className={control} value={filters.timeZone} onChange={event => setFilters({ ...filters, timeZone: event.target.value })}>{[...new Set([...CALENDAR_TIME_ZONES, filters.timeZone])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        <button type="submit" className={`${button} bg-primary-600 text-white`} disabled={loading}>Apply filters</button>
      </form>
      {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{error} <button className={`${button} ml-2`} onClick={() => setEpoch(value => value + 1)}>Retry reviews</button></div>}
      <section aria-label="Saved quality reviews" className="space-y-3">
        <p role="status" className="text-xs text-foreground-500">{loading ? 'Loading saved reviews…' : `${rows.length} reviews loaded · Meeting dates in ${applied.timeZone}`}</p>
        {!loading && !error && !rows.length && <div className="rounded-xl border border-background-200 bg-white p-8 text-center"><ClipboardCheck className="mx-auto text-primary-500" /><h2 className="mt-3 font-bold">No saved reviews match these filters</h2><p className="mt-2 text-sm text-foreground-600">Start a portfolio sampling review from a meeting in the coach calendar, or choose another period and status.</p></div>}
        {rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-background-200 bg-white p-4 shadow-sm">
          <div className="min-w-0 flex-1 basis-64"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-sm font-bold">{row.learnerName}</h2><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'completed' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{row.status === 'completed' ? 'Completed' : 'Draft'}</span></div>
            <p className="mt-2 break-words text-sm">{row.title}</p><p className="mt-2 text-xs text-foreground-500">{row.coachName} · {meetingDate(row.startsAt, applied.timeZone)} · Version {row.version} · {row.actionCount} follow-up actions</p></div>
          <Link className={button} aria-label={`Open review for ${row.learnerName}`} to={{ search: writeQualityLocation(applied, row.id).toString() }}><ClipboardCheck size={15} />Open review</Link>
        </article>)}
        {next !== null && <button className={button} disabled={loading} onClick={() => setPage({ key: listKey, offset: next })}>Load more reviews</button>}
      </section>
      {selected && <Suspense fallback={<p role="status">Opening saved review…</p>}><QualityReviewDialog key={selected} reviewId={selected} timeZone={applied.timeZone} onDirtyChange={reportDirty} onBusyChange={reportBusy}
        onClose={() => { dirty.current = false; setParams(writeQualityLocation(applied)); }} onSaved={() => { dirty.current = false; refresh(); }} /></Suspense>}
    </main>
  </WorkspaceShell>;
}
