import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FileText, ChevronDown } from 'lucide-react';
import { loadSavedCoachingEvidence, invalidateCoachingDetails, type CoachingMeeting, type SavedCoachingEvidence } from '@/api/coachingRecordings';
import SavedEvidencePdf from './SavedEvidencePdf';
import type { EvidenceTab } from './location';
import CompletionNotice from './CompletionNotice';

export default function SavedMeetingEvidence({ evidence, eventKey, reference, category, onPreviewChange, activeTab, onTabChange }: {
  evidence?: SavedCoachingEvidence; eventKey: string; reference?: string; category?: CoachingMeeting['category']; onPreviewChange?: (open: boolean) => void;
  activeTab?: EvidenceTab; onTabChange?: (tab: EvidenceTab) => void;
}) {
  const [loaded, setLoaded] = useState<SavedCoachingEvidence>();
  const data = loaded ?? evidence;
  const analysisState = data?.analysisState ?? data?.state;
  // Keep a verified saved report accessible even when a mixed meeting's title
  // was categorised as Other. Category is a display hint, never an access gate.
  const hasAnalysis = category == null || category === 'MCM' || category === 'PR' || Boolean(data?.analyses.length);
  const [localActive, setLocalActive] = useState<'transcript' | 'analysis' | null>(null);
  const active = activeTab === undefined ? localActive : activeTab === 'recordings' ? null : activeTab;
  const setActive = (kind: 'transcript' | 'analysis' | null) => { setLocalActive(kind); onTabChange?.(kind ?? 'recordings'); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const checkedMicrosoft = useRef(false);
  const id = useId();
  useEffect(() => () => request.current?.abort(), []);
  const load = useCallback((checkMicrosoft: boolean) => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    if (checkMicrosoft) checkedMicrosoft.current = true;
    setBusy(true); setError('');
    void loadSavedCoachingEvidence(eventKey, controller.signal, reference, checkMicrosoft).then(value => {
      if (!controller.signal.aborted) setLoaded(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Saved evidence could not be loaded.');
    }).finally(() => {
      if (!controller.signal.aborted) { setBusy(false); request.current = null; }
    });
  }, [eventKey, reference]);
  useEffect(() => {
    if (active && (active !== 'analysis' || hasAnalysis) && !data && !busy && !error) load(active === 'transcript');
  }, [active, hasAnalysis, data, busy, error, load]);
  const select = (kind: 'transcript' | 'analysis', retry = false) => {
    if (!retry && active === kind) { setActive(null); return; }
    setActive(kind);
    if (retry) invalidateCoachingDetails();
    const checkMicrosoft = kind === 'transcript';
    if (data && !retry && (!checkMicrosoft || data.transcript || data.transcriptCheck)) return;
    load(checkMicrosoft);
  };
  useEffect(() => {
    // If Transcript was selected while the saved AI read was in flight, finish
    // that read first and check Microsoft only if it did not return a transcript.
    if (active === 'transcript' && data && !busy && !error && !data.transcript && !data.transcriptCheck && !checkedMicrosoft.current) load(true);
  }, [active, busy, data, error, load]);
  return <section aria-label="Saved transcript and AI analysis" className="mt-6 space-y-3 border-t border-background-200 pt-4">
    {(['transcript', 'analysis'] as const).map(kind => kind === 'analysis' && !hasAnalysis ?
      <div key={kind} className="rounded-xl border border-background-200 bg-background-50 p-3">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-foreground-700">
          <span className="inline-flex items-center gap-2"><FileText size={16} />AI analysis</span>
          <span className="rounded-full bg-background-100 px-2 py-1 text-[10px] font-medium text-foreground-600">MCM &amp; PR only</span>
        </h4>
        <p className="mt-2 text-xs text-foreground-600">AI analysis is currently available for MCM and PR meetings. Transcripts can still be previewed and downloaded for other meeting types when available.</p>
      </div> : <div key={kind} className="rounded-xl border border-background-200 bg-white">
      <button type="button" aria-expanded={active === kind} aria-controls={`${id}-${kind}`} onClick={() => select(kind)}
        className="flex w-full items-center justify-between gap-2 rounded-xl p-3 text-left text-sm font-semibold text-primary-800 hover:bg-primary-50">
        <span className="inline-flex items-center gap-2"><FileText size={16} />{kind === 'transcript' ? 'Transcript' : 'AI analysis'}</span>
        <ChevronDown size={15} className={active === kind ? 'rotate-180' : ''} />
      </button>
      {active === kind && <div id={`${id}-${kind}`} className="border-t border-background-100 p-3">
        {kind === 'analysis' && <CompletionNotice completion={data?.completion} />}
        {busy && <p role="status" className="text-xs text-foreground-600">Loading {kind === 'transcript' ? 'transcript' : 'saved AI analysis'}…</p>}
        {error && <p role="alert" className="text-xs text-amber-900">{error} <button className="underline" onClick={() => select(kind, true)}>Retry saved evidence</button></p>}
        {!busy && (kind === 'analysis' ? analysisState : data?.state) === 'unavailable' && <p role="alert" className="text-xs text-amber-900">The Coaching Session source could not be checked. <button className="underline" onClick={() => select(kind, true)}>Retry saved evidence</button></p>}
        {!busy && (kind === 'analysis' ? analysisState : data?.state) === 'ambiguous' && <p role="alert" className="text-xs text-amber-900">More than one source meeting matches. Evidence is withheld until the meeting can be confirmed.</p>}
        {!busy && (kind === 'analysis' ? analysisState : data?.state) === 'not-found' && (kind === 'analysis' || !data?.transcriptCheck) && <p className="text-xs text-foreground-600">{kind === 'analysis' ? 'No saved AI report is linked to this occurrence in Coaching Session.' : 'No saved transcript is linked to this occurrence yet.'}</p>}
        {!busy && kind === 'transcript' && !data?.transcript && data?.transcriptCheck?.state === 'missing' && <p className="mt-2 text-xs text-foreground-600">Microsoft has not published a transcript for this occurrence. A recording can be available without a transcript. <button className="underline" onClick={() => select(kind, true)}>Check transcript again</button></p>}
        {!busy && kind === 'transcript' && data?.transcriptCheck?.state === 'unavailable' && <p role="alert" className="mt-2 text-xs text-amber-900">{data.transcript ? 'The saved transcript is available, but additional Microsoft parts could not be checked.' : data.transcriptCheck.code === 'microsoft_access_denied' ? 'Microsoft denied access to this transcript.' : data.transcriptCheck.code === 'meeting_identity_pending' ? 'The verified Microsoft meeting identity is not ready yet.' : 'Microsoft could not return the transcript. The service may be temporarily unavailable.'} <button className="underline" onClick={() => select(kind, true)}>Retry transcript</button></p>}
        {kind === 'transcript' && data && !data.transcript && !data.transcriptCheck && !busy && <button className="mt-2 text-xs font-semibold text-primary-700 underline" onClick={() => select(kind, true)}>Check Microsoft transcript</button>}
        {!busy && data?.state === 'matched' && (kind === 'transcript' || analysisState === 'matched') && (kind === 'transcript' ? data.transcript ? <>
          <SavedEvidencePdf eventKey={eventKey} reference={reference} kind="transcript" onPreviewChange={onPreviewChange} />
          {Boolean(data.transcript.partCount && data.transcript.partCount > 1) && <p className="mt-2 text-xs text-foreground-500">All {data.transcript.partCount} verified transcript parts are included in this PDF.</p>}
          {data.transcript.source === 'microsoft' && <p className="mt-2 text-xs text-foreground-500">Verified transcript from Microsoft for this meeting.</p>}
        </> : !data.transcriptCheck && <p className="text-xs text-foreground-600">No saved transcript is available for this meeting.</p> : <>
          {!data.analyses.length && <div className="space-y-2 text-xs text-foreground-600">
            <p>This meeting is verified, but no saved AI report is linked to it in Coaching Session yet.</p>
            <button type="button" className="font-semibold text-primary-700 underline" onClick={() => select(kind, true)}>Refresh saved AI report</button>
          </div>}
          {data.analyses.map(report => <article key={report.id} className="space-y-3 border-b border-background-100 pb-3 last:border-b-0 last:pb-0">
            <h4 className="text-xs font-semibold">{report.learnerName || 'Saved meeting report'}</h4>
            {report.status === 'completed' && (report.reportAvailable ?? report.report != null)
              ? <SavedEvidencePdf eventKey={eventKey} reference={reference} kind="analysis" analysisId={report.id} onPreviewChange={onPreviewChange} />
              : <p className="text-xs text-foreground-500">Saved analysis: {report.status.replace(/_/g, ' ')}</p>}
          </article>)}
        </>)}
      </div>}
    </div>)}
  </section>;
}
