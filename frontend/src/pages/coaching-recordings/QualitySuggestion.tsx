import { useEffect, useState } from 'react';
import { loadCoachingKeywords, loadCoachingQuality, type CoachingKeywordQuality, type CoachingQuality } from '@/api/coachingRecordings';
import { categoryLabels as labels } from './model';

export default function QualitySuggestion({ eventKey, context }: { eventKey: string; context: string }) {
  const [data, setData] = useState<CoachingKeywordQuality | null>(null);
  const [error, setError] = useState('');
  const [prerequisite, setPrerequisite] = useState('');
  const [revision, setRevision] = useState(0);
  const [showAi, setShowAi] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setPrerequisite(''); setShowAi(false);
    void loadCoachingKeywords(eventKey, context, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(reason => {
      if (!controller.signal.aborted) {
        if (reason instanceof Error && reason.name === 'CoachingQualityPrerequisiteError') setPrerequisite(reason.message);
        else setError(reason instanceof Error ? reason.message : 'Keyword analysis could not be loaded.');
      }
    });
    return () => controller.abort();
  }, [eventKey, context, revision]);
  const result = data?.result;
  const weakSignals = result?.keywordSignals.filter(row => !result.types.some(item => item.type === row.type)
    && (row.topicCount > 0 || row.transcriptMentioned || row.titleMentioned)) ?? [];
  return <section aria-label="Keyword meeting type suggestion" className="mt-5 rounded-lg border border-primary-200 bg-primary-50 p-3">
    <h4 className="text-sm font-semibold">Keyword meeting type suggestion</h4>
    <p className="mt-1 text-xs text-foreground-600">Uses the full saved transcript and programme template phrases. No Microsoft or AI requests are made for keyword analysis. Results are suggestions for quality review; booking type, attendance and sanctions stay unchanged.</p>
    {!data && !error && !prerequisite && <p role="status" className="mt-2 text-sm">Checking saved transcript keywords…</p>}
    {prerequisite && <p role="status" className="mt-2 text-xs text-foreground-600">{prerequisite} If the transcript is missing, open Transcript first to check Microsoft, then <button className="font-semibold underline" onClick={() => setRevision(value => value + 1)}>Check keywords again</button>.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error} <button className="font-semibold underline" onClick={() => setRevision(value => value + 1)}>Retry keyword analysis</button></p>}
    {result && <>
      <p className="mt-3 text-sm font-semibold">{result.insufficientEvidence ? 'Keywords are insufficient to suggest a type' : result.mixed ? 'Possible multiple types — review the keyword evidence' : 'Suggested type from keywords'}</p>
      <p className="mt-1 break-words text-xs text-foreground-600">Calendar title: {result.title || 'Untitled'}</p>
      <ul className="mt-3 space-y-3">{result.types.map(item => <li key={item.type}>
        <p className="text-sm font-semibold">{labels[item.type]} · {item.confidence} keyword signal</p>
        <p className="mt-1 text-xs">{item.reason}</p>
        <p className="mt-1 text-xs">Matched phrases: {result.keywordSignals.find(row => row.type === item.type)?.matchedTerms.join(' · ')}</p>
        {item.evidence.map((quote, index) => <blockquote key={index} className="mt-2 break-words border-l-2 border-primary-300 pl-2 text-xs">{quote}</blockquote>)}
      </li>)}</ul>
      {weakSignals.length > 0 && <div className="mt-3 text-xs text-foreground-600"><p className="font-semibold">Weak signals — not enough to classify:</p>
        <ul className="mt-1 space-y-1">{weakSignals.map(row => <li key={row.type}>{labels[row.type]}: {row.topicCount} distinct template topic signals{row.transcriptMentioned ? ' · name mentioned in transcript' : ''}{row.titleMentioned ? ' · name in title' : ''}</li>)}</ul>
      </div>}
      {!result.references.some(row => row.family === 'SUPPORT') && <p className="mt-3 text-xs text-amber-900">No Student Support template is available. A support mention alone is not classified as a separate meeting.</p>}
      {result.unlinkedTranscriptExcluded && <p className="mt-2 text-xs text-amber-900">Transcript segments without verified session dates were excluded.</p>}
      <p className="mt-3 text-xs text-foreground-600">{result.uncertainty}</p>
      <p className="mt-3 text-xs text-foreground-500">Templates: {result.references.map(row => row.name).join(' · ')}</p>
      <button className="mt-3 text-xs font-semibold text-primary-700 underline" onClick={() => setShowAi(value => !value)}>{showAi ? 'Close optional AI review' : 'Open optional AI review'}</button>
      <p className="mt-1 text-xs text-foreground-500">AI is optional. Opening its panel checks saved results; generating a new AI review requires another explicit action.</p>
    </>}
    {showAi && <AiQualitySuggestion eventKey={eventKey} context={context} />}
  </section>;
}

export function AiQualitySuggestion({ eventKey, context }: { eventKey: string; context: string }) {
  const [data, setData] = useState<CoachingQuality | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(''); setData(null);
    void loadCoachingQuality(eventKey, context, false, controller.signal).then(value => {
      if (!controller.signal.aborted) { setData(value); setRetryAt(value.retryAfter ? Date.now() + value.retryAfter * 1000 : 0); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analysis could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [eventKey, context, revision]);
  useEffect(() => {
    if (!data || !['failed', 'running'].includes(data.state)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data]);
  const generate = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const value = await loadCoachingQuality(eventKey, context, true);
      setData(value); setRetryAt(value.retryAfter ? Date.now() + value.retryAfter * 1000 : 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Analysis failed.'); }
    finally { setBusy(false); }
  };
  const result = data?.result;
  return <section aria-label="Meeting type suggestion" className="mt-5 rounded-lg border border-primary-200 bg-primary-50 p-3">
    <h4 className="text-sm font-semibold">Meeting type suggestion</h4>
    <p className="mt-1 text-xs text-foreground-600">Quality review only. Suggestions may include several types. Confidence is an AI estimate. Booking type, attendance and sanctions stay unchanged.</p>
    {busy && <p role="status" className="mt-2 text-sm">{data ? 'Analysing meeting…' : 'Loading saved analysis…'}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-rose-800">{error}</p>}
    {data?.state === 'not-analysed' && <p className="mt-2 text-xs">Analyse the calendar title and saved transcript against this programme’s templates. The result is saved and reused.</p>}
    {data?.state === 'running' && <p role="status" className="mt-2 text-sm">An analysis is already in progress. Check the saved result shortly.</p>}
    {data?.state === 'failed' && <p role="alert" className="mt-2 text-sm text-rose-800">The last analysis did not return a verified result. No classification was saved. You can retry after the short cooldown.</p>}
    {data?.sampled && <p className="mt-2 text-xs font-semibold text-amber-900">Long transcript: the analysis uses samples across the meeting. Missing content is not proof of absence.</p>}
    {data?.unlinkedTranscriptExcluded && <p className="mt-2 text-xs text-amber-900">Transcript segments without verified session dates were excluded.</p>}
    {result && <>
      <p className="mt-3 text-sm font-semibold">{result.insufficientEvidence ? 'Insufficient evidence to suggest a type' : result.mixed ? 'Multiple types suggested — needs human review' : 'Suggested type'}</p>
      <p className="mt-1 break-words text-xs text-foreground-600">Calendar title: {result.title || 'Untitled'}</p>
      <ul className="mt-3 space-y-3">{result.types.map(item => <li key={item.type}>
        <p className="text-sm font-semibold">{labels[item.type]} · {item.confidence} confidence</p>
        <p className="mt-1 text-xs">{item.reason}</p>
        {!item.templateBased && <p className="mt-1 text-xs text-amber-900">Tentative topic only: no Student Support template was available.</p>}
        {item.evidence.map((quote, index) => <blockquote key={index} className="mt-2 break-words border-l-2 border-primary-300 pl-2 text-xs">{quote}</blockquote>)}
      </li>)}</ul>
      {result.uncertainty && <p className="mt-3 text-xs text-foreground-600">Limitations: {result.uncertainty}</p>}
      <p className="mt-3 text-xs text-foreground-500">Templates: {result.references.map(row => `${row.name}${row.linked ? ' (linked review)' : ''}`).join(' · ')}</p>
    </>}
    <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-primary-700">
      {!busy && data && data.state !== 'complete' && (data.state !== 'running' || retryAt <= now) && <button disabled={retryAt > now} onClick={() => void generate()} className="underline disabled:opacity-50">{data.state === 'running' ? 'Retry interrupted analysis' : data.state === 'failed' ? 'Retry analysis' : 'Analyse meeting type'}</button>}
      {!busy && <button onClick={() => setRevision(value => value + 1)} className="underline">Check saved analysis</button>}
    </div>
  </section>;
}
