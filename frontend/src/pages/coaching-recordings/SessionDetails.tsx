import { useEffect, useState } from 'react';
import { coachingRecordingUrl, coachingEvidenceUrl, invalidateCoachingPdfs, invalidateCoachingDetails, loadCoachingSession, type CoachingMeeting, type CoachingSessionDetails } from '@/api/coachingRecordings';
import { recordingLabels } from './model';
import QualitySuggestion from './QualitySuggestion';
import SavedMeetingEvidence from './SavedMeetingEvidence';
import { Download, Play, RefreshCw } from 'lucide-react';
import type { EvidenceTab } from './location';

function durationLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)} min ${value % 60} sec`;
}
function recordedSeconds(files: CoachingSessionDetails['media']['recordings']) {
  const intervals = files.flatMap(file => file.startsAt && file.endsAt ? [[Date.parse(file.startsAt), Date.parse(file.endsAt)]] : [])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start).sort((a, b) => a[0] - b[0]);
  let total = 0, previousEnd = -Infinity;
  for (const [start, end] of intervals) { total += Math.max(0, end - Math.max(start, previousEnd)); previousEnd = Math.max(previousEnd, end); }
  return total / 1000;
}

export default function SessionDetails({ eventKey, analysisContext, analysisEventKey, reference, category, onPreviewChange, activeTab, onTabChange }: { eventKey: string; analysisContext?: string; analysisEventKey?: string; reference?: string; category?: CoachingMeeting['category']; onPreviewChange?: (open: boolean) => void; activeTab?: EvidenceTab; onTabChange?: (tab: EvidenceTab) => void }) {
  const [data, setData] = useState<CoachingSessionDetails | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState('');
  const [playError, setPlayError] = useState(false);
  const [showTypeReview, setShowTypeReview] = useState(false);
  const [attendancePaused, setAttendancePaused] = useState(false);
  const refresh = () => { invalidateCoachingPdfs(); invalidateCoachingDetails(); setRevision(value => value + 1); };
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setPlaying(''); setPlayError(false); setShowTypeReview(false); setAttendancePaused(false);
    void loadCoachingSession(eventKey, controller.signal, reference, 'attendance')
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Session details could not be loaded.'); });
    return () => controller.abort();
  }, [eventKey, revision, reference]);

  const attendancePending = data?.attendance.state === 'pending';
  useEffect(() => {
    if (!attendancePending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const check = async () => {
      try {
        const value = await loadCoachingSession(eventKey, controller.signal, reference, 'attendance');
        if (controller.signal.aborted) return;
        setData(value);
        if (value.attendance.state === 'pending') {
          if (++attempts < 2) timer = setTimeout(check, 20000);
          else setAttendancePaused(true);
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Attendance could not be refreshed.');
      }
    };
    timer = setTimeout(check, 20000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attendancePending, eventKey, reference, revision]);

  return <section aria-label="Recordings and attendance" className="mt-4 border-t border-background-200 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Recordings</h3>
      <button onClick={refresh} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700"><RefreshCw size={12} />Refresh details</button></div>
    {!data && !error && <p role="status" className="mt-3 text-sm">Loading saved recordings and attendance…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-800">{error} <button onClick={refresh} className="font-semibold underline">Retry details</button></p>}
    {data && <>
      {data.partial && <p role="alert" className="mt-3 text-sm text-amber-900">Some saved evidence could not be checked. Refresh details to try again.</p>}
      {!data.media.recordings.length && <p className="mt-3 text-xs text-foreground-600">{recordingLabels[data.media.state]}</p>}
      {data.media.recordings.length > 0 && <p className="mt-3 text-xs text-foreground-600">{data.media.recordings.length} recording {data.media.recordings.length === 1 ? 'part' : 'parts'}{recordedSeconds(data.media.recordings) > 0 && ` · ${durationLabel(recordedSeconds(data.media.recordings))} recorded in total`}. Recording time can be shorter than attendance when recording starts late or stops early.</p>}
      <ul className="mt-3 space-y-3">{data.media.recordings.map((file, index) => {
        const duration = file.startsAt && file.endsAt ? (Date.parse(file.endsAt) - Date.parse(file.startsAt)) / 1000 : null;
        return <li key={file.id} className="rounded-xl border border-background-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">Recording {index + 1}</span>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${file.state === 'ready' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{file.state === 'ready' ? 'Ready' : recordingLabels[file.state]}</span></div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-foreground-500">{duration !== null && duration > 0 && <span>{durationLabel(duration)} recorded</span>}
            {file.source === 'microsoft' && <span>SharePoint recording</span>}</div>
          {file.state === 'ready' && <div className="mt-3 flex flex-wrap gap-2">
            <button aria-label={`Play recording ${index + 1}`} aria-pressed={playing === file.id} className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50" onClick={() => { setPlaying(file.id); setPlayError(false); }}><Play size={13} />Play</button>
            <a aria-label={`Download recording ${index + 1}`} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700" href={coachingRecordingUrl(data.eventKey, file.id, false, reference)} target="_blank" rel="noopener noreferrer"><Download size={13} />Download</a>
          </div>}
        </li>;
      })}</ul>
      {playing && data.media.recordings.some(file => file.id === playing && file.state === 'ready') && <div className="mt-4">
        <video key={playing} aria-label="Coaching recording player" className="aspect-video w-full rounded-lg bg-black" controls preload="metadata"
          src={coachingRecordingUrl(data.eventKey, playing, true, reference)} onError={() => setPlayError(true)} />
        {playError && <p role="alert" className="mt-2 text-sm text-rose-800">This recording could not be played. Refresh details and retry.</p>}
      </div>}
      <h3 className="mt-6 border-t border-background-200 pt-4 text-sm font-bold">Attendance</h3>
      {data.attendance.source === 'coaching-session' && <p className="mt-1 text-xs text-foreground-500">From the saved Coaching Session attendance report.</p>}
      {data.attendance.state === 'available' && reference && <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-700" href={coachingEvidenceUrl(data.eventKey, 'attendance', reference)}><Download size={12} />Download attendance</a>}
      {data.attendance.state === 'pending' && <p className="mt-2 text-sm text-foreground-600">The attendance report is not available yet. Attendance remains pending.</p>}
      {attendancePending && attendancePaused && <p className="mt-2 text-xs text-foreground-500">Automatic checks have stopped. Use Refresh details to check again.</p>}
      {data.attendance.state === 'unavailable' && <p role="alert" className="mt-2 text-sm text-amber-900">Saved attendance could not be loaded. No absence is inferred.</p>}
      {data.attendance.state === 'available' && <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs"><caption className="sr-only">Saved meeting attendance</caption>
          <thead><tr className="border-b border-background-200"><th className="py-2 pr-3">Participant</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Status</th><th className="py-2">Time present</th></tr></thead>
          <tbody>{data.attendance.rows.map((row, index) => <tr key={`${row.email || row.name}:${index}`} className="border-b border-background-100">
            <td className="max-w-40 break-words py-2 pr-3">{row.name || row.displayName || row.email || 'Unidentified participant'}</td><td className="py-2 pr-3">{row.role || '—'}</td>
            <td className="py-2 pr-3">{row.status || 'pending'}</td><td className="py-2">{row.totalAttendanceSeconds == null ? '—' : `${Math.floor(row.totalAttendanceSeconds / 60)} min ${row.totalAttendanceSeconds % 60} sec`}</td>
          </tr>)}</tbody></table>
        {!data.attendance.rows.length && <p className="mt-2 text-sm">No participant rows are available in the saved report.</p>}
      </div>}
      <SavedMeetingEvidence key={`${data.eventKey}:${reference ?? ''}:${revision}`} evidence={data.evidence} eventKey={data.eventKey} reference={reference} category={category} onPreviewChange={onPreviewChange} activeTab={activeTab} onTabChange={onTabChange} />
      {analysisContext && <div className="mt-5 border-t border-background-200 pt-4">
        <button className="text-xs font-semibold text-primary-700 underline" aria-expanded={showTypeReview} onClick={() => setShowTypeReview(value => !value)}>{showTypeReview ? 'Close optional meeting type check' : 'Optional meeting type check'}</button>
        {showTypeReview && <QualitySuggestion key={`${eventKey}:${analysisContext}`} eventKey={analysisEventKey || eventKey} context={analysisContext} />}
      </div>}
    </>}
  </section>;
}
