import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { formatSystemTimestamp } from '@/lib/format';
import {
  loadSessionResult, requestSessionSync, sessionAttendanceUrl, sessionFileUrl,
  type SessionLearner, type SessionPerson, type SessionResult,
} from '@/api/sessionResults';

const labels: Record<SessionPerson['status'], string> = {
  present: 'Present', absent: 'Absent', pending: 'Awaiting report', review: 'Identity needs review',
  excused: 'Excused — catch-up required', recovered: 'Present — catch-up completed',
};
export function SessionResults({ seriesId, sessionNumber, learner, preview = false }: {
  seriesId: string; sessionNumber: number; learner?: SessionLearner; preview?: boolean;
}) {
  const [session, setSession] = useState<SessionResult>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'recordings' | 'attendance' | 'transcripts'>('recordings');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const kind = learner?.kind, learnerId = learner?.id;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSession(undefined); setPage(0); setNotice('');
    loadSessionResult(seriesId, sessionNumber, kind && learnerId ? { kind, id: learnerId } : undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setSession(result.sessions[0]); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load session.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [seriesId, sessionNumber, kind, learnerId, revision]);
  const recordings = session?.artifacts?.filter(file => file.type === 'recording') || [];
  const transcripts = session?.artifacts?.filter(file => file.type === 'transcript') || [];
  const people = (session?.attendance || []).filter(person => `${person.name} ${person.email}`.toLowerCase().includes(query.toLowerCase()));
  const own = learner ? session?.attendance?.[0] : undefined;
  const sync = async () => {
    setSyncing(true); setError(''); setNotice('');
    try { setNotice((await requestSessionSync(seriesId)).message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not request synchronization.'); }
    finally { setSyncing(false); }
  };
  return <section className="overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-sm" aria-label={`Session ${sessionNumber} results`}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-100 bg-primary-50/50 p-5">
      <div><p className="text-xs font-bold uppercase tracking-wider text-primary-600">Session {sessionNumber}</p>
        <h2 className="mt-1 text-lg font-bold">Recording & session results</h2>
        <p className="mt-1 text-xs text-foreground-500">{session?.syncedAt ? `Last saved ${formatSystemTimestamp(session.syncedAt)}` : 'Files appear here when processing finishes.'}</p></div>
      <div className="flex flex-wrap gap-2">
        {!learner && !preview && <button type="button" disabled={loading || syncing || !session || session.archiveReady === false} onClick={() => void sync()} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{syncing ? 'Requesting…' : 'Sync attendance & files'}</button>}
        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Refresh saved results</button>
      </div>
    </header>
    {error && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="m-4 rounded-lg bg-primary-50 p-3 text-sm">{notice}</p>}
    {session?.archiveReady === false && <p role="status" className="m-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{learner || preview
      ? 'Saved recordings and transcripts are not ready for playback yet. Please contact your tutor.'
      : 'Recording storage needs setup. Saved attendance is available below; synchronization and playback are unavailable until setup is complete.'}</p>}
    {loading ? <p role="status" className="p-5 text-sm">Loading saved session…</p> : !session ? !error && <p className="p-5 text-sm">This session has not been linked yet.</p> : <>
      {learner && <div className="m-4 rounded-xl border bg-background-50 p-4 text-sm">
        <strong>Your attendance: {own ? labels[own.status] : session.reportReady ? 'Identity needs review' : 'Awaiting report'}</strong>
        {own && <p className="mt-1 text-foreground-500">{Math.floor(own.seconds / 60)}m {own.seconds % 60}s verified in Teams. Presence requires more than 3 minutes.</p>}
        {own?.attendance === 0 && <Link className="mt-2 inline-block font-semibold text-primary-700 underline" to="/learner/attendance">{own.excused ? 'Book catch-up with your coach' : 'Open attendance and report absence'}</Link>}
      </div>}
      <div className="flex gap-2 border-b px-4" role="tablist" aria-label="Session results">
        {(['recordings', 'attendance', 'transcripts'] as const).filter(value => (!learner && !preview) || value !== 'attendance').map(value =>
          <button key={value} role="tab" type="button" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-3 text-sm font-semibold capitalize ${tab === value ? 'border-primary-600 text-primary-700' : 'border-transparent text-foreground-500'}`}>{value}</button>)}
      </div>
      <div className="p-5" role="tabpanel">
        {tab === 'recordings' && <div className="space-y-5">{!recordings.length && <p className="text-sm text-foreground-500">The recording is not available yet. You can return here after processing finishes.</p>}
          {recordings.map((file, index) => <div key={file.id}><h3 className="mb-2 text-sm font-bold">Recording {index + 1}</h3>
            {file.state === 'ready' ? <video controls playsInline preload="none" className="aspect-video w-full rounded-xl bg-black" src={sessionFileUrl(seriesId, file, learner)} aria-label={`Session recording ${index + 1}`} />
              : <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">{session.archiveReady === false ? 'Teams has a recording for this session. A saved playback copy is not available yet.' : file.state === 'failed' ? 'Saving this recording needs retry. An administrator can request synchronization.' : 'Recording found. Saving a copy for playback…'}</p>}</div>)}
        </div>}
        {tab === 'transcripts' && <div className="space-y-4">{!transcripts.length && <p className="text-sm text-foreground-500">No transcript has been received yet.</p>}
          {transcripts.map((file, index) => <div key={file.id} className="rounded-xl border p-4"><div className="mb-3 flex justify-between gap-3"><h3 className="font-semibold">Transcript {index + 1}</h3>
            {file.state === 'ready' && <a className="text-sm font-semibold text-primary-700 underline" href={sessionFileUrl(seriesId, file, learner, true)}>Download TXT</a>}</div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm leading-7">{file.state === 'ready' ? file.text || 'The transcript contains no spoken text.' : session.archiveReady === false ? 'Teams has a transcript for this session. A saved text copy is not available yet.' : 'Transcript is being saved. Please check again later.'}</pre></div>)}
        </div>}
        {tab === 'attendance' && !learner && !preview && <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><input aria-label="Search attendance" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search name or email" className="rounded-lg border px-3 py-2 text-sm" />
            <a href={sessionAttendanceUrl(session)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white"><AppIcon className="ri-download-line mr-2" />Export attendance CSV</a></div>
          {!session.reportReady && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">Awaiting a completed Teams report. Pending learners are not marked absent.</p>}
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-foreground-500"><th className="p-3">Learner / participant</th><th>Duration</th><th>Attendance</th><th>Status</th></tr></thead><tbody>
            {people.slice(page * 25, page * 25 + 25).map((person, index) => <tr key={person.email || index} className="border-b"><td className="p-3"><p className="font-semibold">{person.name}</p><p className="text-xs text-foreground-500">{person.email || 'Unmatched identity'}</p></td><td>{Math.floor(person.seconds / 60)}m {person.seconds % 60}s</td><td>{person.attendance ?? '—'}</td><td>{labels[person.status]}</td></tr>)}
          </tbody></table></div>
          {people.length > 25 && <div className="flex items-center gap-4 text-sm"><button disabled={!page} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(people.length / 25)}</span><button disabled={(page + 1) * 25 >= people.length} onClick={() => setPage(value => value + 1)}>Next</button></div>}
        </div>}
      </div>
    </>}
  </section>;
}
