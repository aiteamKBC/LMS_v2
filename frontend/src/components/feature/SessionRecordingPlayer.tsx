import { useEffect, useMemo, useRef, useState } from 'react';
import { loadTranscriptCues, sessionFileUrl, type SessionFile, type SessionLearner, type TranscriptCue, type TranscriptLink } from '@/api/sessionResults';

function cueTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function SessionRecordingPlayer({ seriesId, file, transcripts, learner, label }: {
  seriesId: string; file: SessionFile; transcripts: SessionFile[]; learner?: SessionLearner; label: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Infinity);
  const [follow, setFollow] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const kind = learner?.kind, learnerId = learner?.id;
  const linksKey = JSON.stringify((file.transcriptLinks || []).filter(link => transcripts.some(item => item.id === link.id)));
  const linked = transcripts.filter(item => (file.transcriptLinks || []).some(link => link.id === item.id));
  useEffect(() => {
    const controller = new AbortController();
    const links = (JSON.parse(linksKey) as TranscriptLink[]).filter(link => link.timingReady && link.offsetSeconds !== null);
    setCues([]); setError(''); setLoading(links.length > 0);
    if (links.length) {
      void Promise.all(links.map(async link => {
        const result = await loadTranscriptCues(seriesId, link.id, kind && learnerId ? { kind, id: learnerId } : undefined, controller.signal);
        const offset = link.offsetSeconds as number;
        return result.cues.map(cue => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
      })).then(groups => {
        if (!controller.signal.aborted) {
          const seen = new Set<string>();
          setCues(groups.flat().filter(cue => {
            const key = JSON.stringify([cue.start, cue.end, cue.speaker, cue.text]);
            if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= Math.max(0, cue.start) || seen.has(key)) return false;
            seen.add(key); return true;
          }).map(cue => ({ ...cue, start: Math.max(0, cue.start) })).sort((a, b) => a.start - b.start));
        }
      }).catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the saved transcript.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [seriesId, file.id, linksKey, kind, learnerId, retry]);
  const visibleCues = useMemo(() => cues.filter(cue => cue.start < duration), [cues, duration]);
  const activeIndex = visibleCues.findIndex(cue => cue.start <= time && time < cue.end);
  useEffect(() => {
    if (!follow || activeIndex < 0) return;
    const container = panel.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (container && active) container.scrollTo?.({ top: Math.max(0, active.offsetTop - container.clientHeight / 2), behavior: 'smooth' });
  }, [activeIndex, follow]);
  const readTime = () => {
    if (!video.current) return;
    setTime(video.current.currentTime);
    if (Number.isFinite(video.current.duration)) setDuration(video.current.duration);
  };
  const seek = (seconds: number) => {
    if (!video.current) return;
    video.current.currentTime = Math.min(duration, Math.max(0, seconds));
    setTime(video.current.currentTime);
  };
  return <div className="space-y-3">
    <video ref={video} controls playsInline preload="none" className="aspect-video w-full rounded-xl bg-black"
      src={sessionFileUrl(seriesId, file, learner)} aria-label={label}
      onTimeUpdate={readTime} onSeeked={readTime} onLoadedMetadata={readTime} onPause={readTime} />
    <section className="rounded-xl border bg-background-50" aria-label={`${label} transcript`}>
      <header className="flex items-center justify-between gap-3 border-b p-3"><h4 className="text-sm font-semibold">Transcript</h4>
        {visibleCues.length > 0 && <button type="button" aria-pressed={follow} onClick={() => setFollow(value => !value)} className="rounded-lg border bg-white px-3 py-1 text-xs font-semibold">Follow video</button>}
      </header>
      {loading && <p role="status" className="p-3 text-sm">Loading saved transcript…</p>}
      {error && <div role="alert" className="p-3 text-sm text-red-800">{error} <button type="button" onClick={() => setRetry(value => value + 1)} className="underline">Retry transcript</button></div>}
      {!loading && !error && visibleCues.length > 0 && <div ref={panel} className="relative max-h-72 overflow-y-auto p-2">
        <ol className="space-y-1">{visibleCues.map((cue, index) => <li key={`${cue.start}-${index}`}>
          <button type="button" aria-current={cue.start <= time && time < cue.end ? 'true' : undefined}
            onClick={() => seek(cue.start)} className={`flex w-full gap-3 rounded-lg p-3 text-left text-sm ${cue.start <= time && time < cue.end ? 'bg-primary-100 text-primary-900 ring-1 ring-primary-300' : 'hover:bg-background-100'}`}>
            <span className="shrink-0 font-mono text-xs tabular-nums">{cueTime(cue.start)}</span>
            <span dir="auto">{cue.speaker && <strong className="mr-1">{cue.speaker}:</strong>}{cue.text}</span>
          </button>
        </li>)}</ol>
      </div>}
      {!loading && !error && !visibleCues.length && <div className="p-3 text-sm text-foreground-500">
        <p>{!linked.length ? 'No matching transcript has been received for this recording.'
          : linked.some(item => !item.timingReady) ? 'Timed transcript is being prepared. It will appear automatically when saved.'
          : 'No timed speech is available for this recording.'}</p>
        {linked.map(item => item.text && <p key={item.id} dir="auto" className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap">{item.text}</p>)}
      </div>}
    </section>
  </div>;
}
