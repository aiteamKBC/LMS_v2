import { useEffect, useRef, useState } from 'react';
import { loadModuleSessions, requestSessionSync, type ModuleSessionResults, type SessionResult } from '@/api/sessionResults';
import { SessionResults } from '@/components/feature/SessionResults';
import { formatSystemTimestamp } from '@/lib/format';

export function SessionResultsDialog({ moduleId, onClose }: { moduleId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Module session results" tabIndex={-1}
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,[tabindex="0"]') || []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-2xl bg-background-50 p-5">
      <button type="button" onClick={onClose} className="mb-4 rounded-lg border bg-white px-3 py-2 text-sm">Close sessions</button>
      <ModuleSessions moduleId={moduleId} />
    </div>
  </div>;
}

export function ModuleSessions({ moduleId }: { moduleId: string }) {
  const [data, setData] = useState<ModuleSessionResults>();
  const [selected, setSelected] = useState<SessionResult>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    loadModuleSessions(moduleId, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message || 'Could not load sessions.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [moduleId, revision]);
  useEffect(() => { setSelected(undefined); setNotice(''); setData(undefined); }, [moduleId]);
  const sync = async (id: string) => {
    setBusy(id); setError('');
    try { const result = await requestSessionSync(id); setNotice(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not request synchronization.'); }
    finally { setBusy(''); }
  };
  if (selected) return <div className="space-y-4"><button type="button" className="text-sm font-semibold text-primary-700" onClick={() => setSelected(undefined)}>← All sessions</button><SessionResults seriesId={selected.seriesId} sessionNumber={selected.sessionNumber} /></div>;
  return <section className="space-y-4" aria-label="Sessions and recordings">
    <header className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-bold">Sessions & Recordings</h2><p className="mt-1 text-sm text-foreground-500">Open a session to review its recording, transcript and attendance.</p></div>
      <button disabled={loading} onClick={() => setRevision(value => value + 1)} className="rounded-lg border bg-white px-3 py-2 text-sm">Refresh</button></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-primary-50 p-4 text-sm">{notice}</p>}
    {loading ? <p role="status">Loading saved sessions…</p> : !data?.series.length ? !error && <p className="rounded-xl border bg-white p-6 text-sm">No Teams sessions are linked to this module yet.</p> : data.series.map(series => <div key={series.id} className="overflow-hidden rounded-xl border bg-white">
      <div className="flex items-center justify-between gap-3 border-b bg-primary-50/40 p-4"><strong>{series.title}</strong><button disabled={Boolean(busy)} onClick={() => void sync(series.id)} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">{busy === series.id ? 'Requesting…' : 'Sync attendance & files'}</button></div>
      {data.jobs.filter(job => job.live_session_id === series.id && job.state !== 'complete').map(job => <p key={job.live_session_id} role="status" className="bg-amber-50 px-4 py-3 text-sm">{job.state === 'failed' ? job.last_error || 'Sync needs retry.' : `Sync ${job.state}. Saved results remain available.`}</p>)}
      <ul className="divide-y">{series.sessions.map(session => <li key={session.id}><button onClick={() => setSelected(session)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-background-50"><span><strong className="block text-sm">Session {session.sessionNumber}</strong><span className="text-xs text-foreground-500">{formatSystemTimestamp(session.startsAt)}</span></span><span className="text-right text-xs"><span className="block font-semibold">{session.reportReady ? 'Attendance report saved' : 'Awaiting attendance report'}</span><span className="text-foreground-500">{session.fileCount || 0} files · Open session →</span></span></button></li>)}</ul>
    </div>)}
  </section>;
}
