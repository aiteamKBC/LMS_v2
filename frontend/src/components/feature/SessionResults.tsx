import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { SessionRecordingPlayer } from './SessionRecordingPlayer';
import { SessionSyncStatus } from './SessionSyncStatus';
import { formatSystemTimestamp } from '@/lib/format';
import {
  linkAttendanceAlias, loadSessionResult, requestSessionSync, sessionAttendanceUrl, sessionFileUrl, setRecordingVisibility,
  type SessionLearner, type SessionPerson, type SessionFile,
} from '@/api/sessionResults';
import { useSavedSessionData } from '@/hooks/useSavedSessionData';

type RawStatus = 'present' | 'absent' | 'pending' | 'review';
type FinalOutcome = 'present' | 'absent' | 'pending' | 'review' | 'absent_excused' | 'made_up';
const rawLabels: Record<RawStatus, string> = {
  present: 'Present', absent: 'Absent', pending: 'Awaiting report', review: 'Identity needs review',
};
const outcomeLabels: Record<FinalOutcome, string> = {
  present: 'Present', absent: 'Absent, unrecovered', pending: 'Awaiting report', review: 'Identity needs review',
  absent_excused: 'Absent, excused — catch-up required', made_up: 'Made up — catch-up completed',
};
const rawStatusOf = (person: SessionPerson): RawStatus => person.rawStatus
  || (person.status === 'recovered' || person.status === 'excused' ? 'absent' : person.status);
const rawAttendanceOf = (person: SessionPerson) => person.rawAttendance
  ?? (person.status === 'recovered' || person.status === 'excused' ? 0 : person.attendance);
const finalOutcomeOf = (person: SessionPerson): FinalOutcome => person.finalOutcome
  || (person.status === 'recovered' ? 'made_up' : person.status === 'excused' ? 'absent_excused' : person.status);
const recoveryLabel = (person: SessionPerson) => {
  if (rawStatusOf(person) !== 'absent') return '—';
  if (person.recoveryStatus === 'completed' || person.catchupCompleted) return 'Catch-up completed';
  if (person.recoveryStatus === 'catchup_booked') return 'Catch-up booked';
  if (person.recoveryStatus === 'requested') return 'Recovery requested';
  return 'Not requested';
};
export function SessionResults({ seriesId, sessionNumber, learner, preview = false }: {
  seriesId: string; sessionNumber: number; learner?: SessionLearner; preview?: boolean;
}) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState('');
  const [tab, setTab] = useState<'recordings' | 'attendance' | 'transcripts'>('recordings');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [aliasChoices, setAliasChoices] = useState<Record<string, string>>({});
  const [aliasBusy, setAliasBusy] = useState('');
  const kind = learner?.kind, learnerId = learner?.id;
  const load = useCallback((signal: AbortSignal) =>
    loadSessionResult(seriesId, sessionNumber, kind && learnerId ? { kind, id: learnerId } : undefined, signal),
  [seriesId, sessionNumber, kind, learnerId]);
  const saved = useSavedSessionData(load, true, data => ['queued', 'running'].includes(data?.job?.state || ''));
  const session = saved.data?.sessions[0];
  const loading = saved.loading;
  useEffect(() => {
    setError(''); setPage(0); setNotice(''); setTab('recordings');
    setUnmatchedOpen(false); setAliasChoices({}); setAliasBusy('');
  }, [seriesId, sessionNumber, kind, learnerId]);
  const files = session?.artifacts?.filter(file => (!learner && !preview) || !file.hiddenFromLearners) || [];
  const recordings = files.filter(file => file.type === 'recording');
  const transcripts = files.filter(file => file.type === 'transcript');
  const people = (session?.attendance || []).filter(person => `${person.name} ${person.email}`.toLowerCase().includes(query.toLowerCase()));
  const own = learner ? session?.attendance?.[0] : undefined;
  const ownRawStatus = own ? rawStatusOf(own) : undefined;
  const ownFinalOutcome = own ? finalOutcomeOf(own) : undefined;
  const sync = async () => {
    setSyncing(true); setError(''); setNotice('');
    try { setNotice((await requestSessionSync(seriesId)).message); saved.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not request synchronization.'); }
    finally { setSyncing(false); }
  };
  const toggleVisibility = async (file: SessionFile) => {
    setVisibilityBusy(file.id); setError('');
    try { await setRecordingVisibility(seriesId, file.id, !file.hiddenFromLearners); saved.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update visibility.'); }
    finally { setVisibilityBusy(''); }
  };
  const identityKey = (person: SessionPerson) => person.email || (person.sourceRecordIds || []).join('|');
  const selectedLearnerId = (person: SessionPerson) => {
    const key = identityKey(person);
    return Object.prototype.hasOwnProperty.call(aliasChoices, key)
      ? aliasChoices[key]
      : String(person.suggestedLearnerProfileId || '');
  };
  const linkAlias = async (person: SessionPerson) => {
    const key = identityKey(person);
    const learnerProfileId = Number(selectedLearnerId(person) || 0);
    if (!learnerProfileId) return;
    setAliasBusy(key); setError(''); setNotice('');
    try {
      const linked = await linkAttendanceAlias(seriesId, sessionNumber, person.email, learnerProfileId, person.sourceRecordIds || []);
      setNotice(`${linked.aliasEmail || person.name} is now matched to ${linked.learnerName}. Saved attendance was recalculated.`);
      await saved.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not link the reported email.');
    } finally { setAliasBusy(''); }
  };
  return <section className="overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-sm" aria-label={`Session ${sessionNumber} results`}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-100 bg-primary-50/50 p-5">
      <div><p className="text-xs font-bold uppercase tracking-wider text-primary-600">Session {sessionNumber}</p>
        <h2 className="mt-1 text-lg font-bold">Recording & session results</h2>
        {session?.title && <p className="mt-1 font-semibold">{session.title}</p>}
        {session?.startsAt && <p className="mt-1 text-xs text-foreground-500">Scheduled: {formatSystemTimestamp(session.startsAt, { dateStyle: 'medium', timeStyle: 'short' })} (UK time)</p>}
        {session?.actualStartsAt && <p className="mt-1 text-xs text-foreground-500">Recorded meeting: {formatSystemTimestamp(session.actualStartsAt, { dateStyle: 'medium', timeStyle: 'short' })} (UK time)</p>}
        <p className="mt-1 text-xs text-foreground-500">{session?.syncedAt ? `Last saved ${formatSystemTimestamp(session.syncedAt)}` : 'No saved results for this session yet.'}</p></div>
      <div className="flex flex-wrap gap-2">
        {!learner && !preview && <button type="button" disabled={loading || syncing || !session || session.archiveReady === false} onClick={() => void sync()} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{syncing ? 'Requesting…' : 'Sync attendance & files'}</button>}
        <button type="button" disabled={loading || saved.refreshing} aria-busy={saved.refreshing} onClick={saved.refresh} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60">{saved.refreshing && !loading ? 'Refreshing…' : 'Refresh saved results'}</button>
      </div>
    </header>
    {(error || saved.error) && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error || saved.error}</p>}
    {notice && !saved.data?.job && <p role="status" className="m-4 rounded-lg bg-primary-50 p-3 text-sm">{notice}</p>}
    {!learner && !preview && <SessionSyncStatus job={saved.data?.job} />}
    {session?.archiveReady === false && <p role="status" className="m-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{learner || preview
      ? 'Saved recordings and transcripts are not ready for playback yet. Please contact your tutor.'
      : 'Recording storage needs setup. Saved attendance is available below; synchronization and playback are unavailable until setup is complete.'}</p>}
    {loading ? <p role="status" className="p-5 text-sm">Loading saved session…</p> : !session ? !error && !saved.error && <p className="p-5 text-sm">This session has not been linked yet.</p> : <>
      {learner && !preview && <div className="m-4 rounded-xl border bg-background-50 p-4 text-sm">
        <strong>Your original attendance: {ownRawStatus ? rawLabels[ownRawStatus] : session.reportReady ? 'Identity needs review' : 'Awaiting report'}</strong>
        {own && <p className="mt-1 text-foreground-500">{Math.floor(own.seconds / 60)}m {own.seconds % 60}s verified in Teams. Presence requires more than 3 minutes.</p>}
        {ownFinalOutcome && ownRawStatus && ownFinalOutcome !== ownRawStatus && <p className="mt-1 font-semibold text-primary-700">Effective outcome: {outcomeLabels[ownFinalOutcome]}</p>}
        {own?.attendance === 0 && !own.catchupCompleted && <Link className="mt-2 inline-block font-semibold text-primary-700 underline" to="/learner/attendance">{own.absenceReported ? 'View recovery plan' : 'Open attendance and report absence'}</Link>}
      </div>}
      <div className="flex gap-2 border-b px-4" role="tablist" aria-label="Session results">
        {(['recordings', 'attendance', 'transcripts'] as const).filter(value => (!learner && !preview) || value !== 'attendance').map(value =>
          <button key={value} role="tab" type="button" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-3 text-sm font-semibold capitalize ${tab === value ? 'border-primary-600 text-primary-700' : 'border-transparent text-foreground-500'}`}>{value}</button>)}
      </div>
      <div className="p-5" role="tabpanel">
        {tab === 'recordings' && <div className="space-y-5">{!recordings.length && <p className="text-sm text-foreground-500">No recording is saved for this session. Check the session date; other sessions may have recordings. New saved results appear automatically.</p>}
          {recordings.map((file, index) => <div key={file.id}><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Recording {index + 1}{file.hiddenFromLearners ? ' · Hidden from learners' : ''}</h3>
            {!learner && !preview && <button type="button" disabled={Boolean(visibilityBusy)} onClick={() => void toggleVisibility(file)} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{visibilityBusy === file.id ? 'Updating…' : file.hiddenFromLearners ? 'Show to learners' : 'Hide from learners'}</button>}</div>
            {file.state === 'ready' ? <SessionRecordingPlayer seriesId={seriesId} file={file} transcripts={transcripts} learner={learner} label={`Session recording ${index + 1}`} />
              : <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">{session.archiveReady === false ? 'Teams has a recording for this session. A saved playback copy is not available yet.' : file.state === 'failed' ? 'Saving this recording needs retry. An administrator can request synchronization.' : 'Recording found. Saving a copy for playback…'}</p>}</div>)}
        </div>}
        {tab === 'transcripts' && <div className="space-y-4">{!transcripts.length && <p className="text-sm text-foreground-500">No transcript has been received yet.</p>}
          {transcripts.map((file, index) => <div key={file.id} className="rounded-xl border p-4"><div className="mb-3 flex justify-between gap-3"><h3 className="font-semibold">Transcript {index + 1}</h3>
            {file.state === 'ready' && <a className="text-sm font-semibold text-primary-700 underline" href={sessionFileUrl(seriesId, file, learner, true)}>Download TXT</a>}</div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm leading-7">{file.state === 'ready' ? file.text || 'The transcript contains no spoken text.' : session.archiveReady === false ? 'Teams has a transcript for this session. A saved text copy is not available yet.' : 'Transcript is being saved. Please check again later.'}</pre></div>)}
        </div>}
        {tab === 'attendance' && !learner && !preview && <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><input aria-label="Search attendance" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search name or email" className="rounded-lg border px-3 py-2 text-sm" />
            <div className="flex flex-wrap gap-2"><a href={sessionAttendanceUrl(session)} className="rounded-lg border px-4 py-2 text-sm font-semibold"><AppIcon className="ri-download-line mr-2" />Export attendance CSV</a>
              <a href={sessionAttendanceUrl(session, 'pdf')} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white"><AppIcon className="ri-download-line mr-2" />Export attendance PDF</a></div></div>
          {!session.reportReady && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">Awaiting a completed Teams report. Pending learners are not marked absent.</p>}
          {!!session.unmatchedAttendance?.length && <div className="rounded-xl border border-amber-200 bg-amber-50/60">
            <button type="button" aria-expanded={unmatchedOpen} onClick={() => setUnmatchedOpen(value => !value)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-semibold text-amber-950">
              <span><AppIcon className="ri-user-search-line mr-2" />Review unmatched participants ({session.unmatchedAttendance.length})</span>
              <AppIcon className={unmatchedOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </button>
            {unmatchedOpen && <div className="space-y-3 border-t border-amber-200 p-4">
              <p className="text-sm text-amber-900">These Teams identities are not assigned to a learner in this module. Link only an identity you have verified.</p>
              {session.unmatchedAttendance.map(person => { const key = identityKey(person); return <div key={key} className="grid gap-3 rounded-lg border bg-white p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <div><p className="font-semibold">{person.name}</p><p className="text-xs text-foreground-500">{person.email || 'Unverified Teams identity'}</p><p className="mt-1 text-xs">{Math.floor(person.seconds / 60)}m {person.seconds % 60}s in Teams</p></div>
                <label className="text-xs font-semibold text-foreground-600">Match to module learner
                  <select aria-label={`Match ${person.email || person.name} to learner`} value={selectedLearnerId(person)}
                    onChange={event => setAliasChoices(value => ({ ...value, [key]: event.target.value }))}
                    className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal">
                    <option value="">Choose learner…</option>
                    {(session.attendanceCandidates || []).map(candidate => <option key={candidate.learnerProfileId} value={candidate.learnerProfileId}>{candidate.name} · {candidate.email}</option>)}
                  </select>
                  {person.suggestedLearnerProfileId && !Object.prototype.hasOwnProperty.call(aliasChoices, key) && <span className="mt-1 block font-normal text-primary-700">Suggested from the Teams name — confirm before linking.</span>}
                </label>
                <button type="button" disabled={aliasBusy === key || !selectedLearnerId(person)}
                  onClick={() => void linkAlias(person)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {aliasBusy === key ? 'Linking…' : 'Link identity'}
                </button>
              </div>})}
            </div>}
          </div>}
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-foreground-500"><th className="p-3">Learner</th><th>Duration</th><th>Attendance</th><th>Recovery</th></tr></thead><tbody>
            {people.slice(page * 25, page * 25 + 25).map((person, index) => <tr key={person.email || index} className="border-b"><td className="p-3"><p className="font-semibold">{person.name}</p><p className="text-xs text-foreground-500">{person.email || 'Unmatched identity'}</p></td><td>{Math.floor(person.seconds / 60)}m {person.seconds % 60}s</td><td>{rawLabels[rawStatusOf(person)]}</td><td>{recoveryLabel(person)}</td></tr>)}
          </tbody></table></div>
          {people.length > 25 && <div className="flex items-center gap-4 text-sm"><button disabled={!page} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(people.length / 25)}</span><button disabled={(page + 1) * 25 >= people.length} onClick={() => setPage(value => value + 1)}>Next</button></div>}
        </div>}
      </div>
    </>}
  </section>;
}
