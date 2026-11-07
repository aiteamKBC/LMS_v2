import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { loadRecordingWatch, loadTranscriptCues, recordRecordingWatch, sessionFileUrl, type SessionFile, type SessionLearner, type TranscriptCue, type TranscriptLink } from '@/api/sessionResults';
import { BunnyRecordingVideo } from './BunnyRecordingVideo';
import { isBunnyEmbed, type RecordingMedia } from './bunnyRecordingProtocol';

function cueTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

const WATCH_REPORT_MS = 30000;

function watchedText({ watchedSeconds, durationSeconds }: { watchedSeconds: number; durationSeconds: number }) {
  const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
  if (watchedSeconds < 60) return 'Viewing time saved: under 1 min';
  const seen = durationSeconds > 0 ? Math.min(watchedSeconds, durationSeconds) : watchedSeconds;
  return durationSeconds > 0 ? `Watched ${minutes(seen)} of ${minutes(durationSeconds)} min` : `Watched ${minutes(seen)} min`;
}
// A larger jump between two time updates is a seek, not viewing.
const MAX_PLAYED_STEP_SECONDS = 2;

/** Adds up the seconds the learner actually plays and reports them about every 30 seconds. */
function useWatchTracking(video: RefObject<RecordingMedia | null>, seriesId: string, file: SessionFile,
  learner: SessionLearner | undefined, enabled: boolean) {
  const pending = useRef(0);
  const lastPosition = useRef<number | null>(null);
  const [saved, setSaved] = useState<{ watchedSeconds: number; durationSeconds: number } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [saveError, setSaveError] = useState('');
  const csrfToken = useRef('');
  const fileId = file.id, kind = learner?.kind, learnerId = learner?.id;
  useEffect(() => {
    if (!enabled || !kind || !learnerId) return;
    pending.current = 0; lastPosition.current = null; setSaved(null); setElapsedSeconds(0); setSaveError('');
    const controller = new AbortController();
    void loadRecordingWatch(seriesId, file, { kind, id: learnerId }, controller.signal).then(state => {
      csrfToken.current = state.csrfToken || '';
      setElapsedSeconds(current => Math.max(current, state.watchedSeconds || 0));
      if (state.watchedSeconds > 0) setSaved(state);
    }).catch(reason => { if (!controller.signal.aborted) setSaveError(reason instanceof Error ? reason.message : 'Viewing time is unavailable.'); });
    return () => controller.abort();
    // `file` is identified by its id; a refreshed object for the same recording must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, seriesId, fileId, kind, learnerId]);
  const report = useRef<(keepalive?: boolean) => void>(() => undefined);
  report.current = (keepalive = false) => {
    const seconds = Math.floor(pending.current);
    // Without a token the seconds stay pending and go out with the next report.
    if (!enabled || !learner || seconds < 1 || !csrfToken.current) return;
    pending.current -= seconds;
    const element = video.current;
    void recordRecordingWatch(seriesId, file, learner, {
      watchedSeconds: seconds,
      position: Math.floor(element?.currentTime || 0),
      duration: Number.isFinite(element?.duration) ? Math.floor(element?.duration || 0) : 0,
    }, csrfToken.current, keepalive).then(result => {
      setSaved(result);
      setElapsedSeconds(current => Math.max(current, result.watchedSeconds + pending.current));
      setSaveError('');
    })
      // Viewing time is informational: never interrupt playback, but say it was not saved.
      .catch(reason => setSaveError(reason instanceof Error ? reason.message : 'Viewing time could not be saved.'));
  };
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => report.current(), WATCH_REPORT_MS);
    const leave = () => report.current(true);
    window.addEventListener('pagehide', leave);
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', leave); report.current(true); };
  }, [enabled]);
  return {
    saved, saveError, elapsedSeconds,
    onPlayedTime: () => {
      const element = video.current;
      if (!enabled || !element) return;
      const step = element.currentTime - (lastPosition.current ?? element.currentTime);
      if (!element.paused && !element.seeking && step > 0 && step <= MAX_PLAYED_STEP_SECONDS) {
        pending.current += step;
        setElapsedSeconds(current => current + step);
      }
      lastPosition.current = element.currentTime;
    },
    onSeeked: () => { lastPosition.current = video.current?.currentTime ?? null; },
    onStop: () => report.current(),
  };
}

export function SessionRecordingPlayer({ seriesId, file, transcripts, learner, label, sourceUrl, trackWatch = false, onWatchTimeChange, onPlayingChange,
  transcriptLoading = false, transcriptLoadError = '', onTranscriptRetry }: {
  seriesId: string; file: SessionFile; transcripts: SessionFile[]; learner?: SessionLearner; label: string; trackWatch?: boolean;
  sourceUrl?: string;
  onWatchTimeChange?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  transcriptLoading?: boolean;
  transcriptLoadError?: string;
  onTranscriptRetry?: () => void;
}) {
  const video = useRef<RecordingMedia | null>(null);
  const watch = useWatchTracking(video, seriesId, file, learner, trackWatch);
  useEffect(() => {
    if (trackWatch) onWatchTimeChange?.(Math.floor(watch.elapsedSeconds));
  }, [trackWatch, watch.elapsedSeconds, onWatchTimeChange]);
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
  const downloadable = linked.filter(item => item.state === 'ready');
  const pendingTranscript = transcriptLoading || loading;
  const transcriptError = transcriptLoadError || error;
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
  // Follow the latest phrase reached by the playhead. Overlapping speech must
  // not pin scrolling to an earlier, longer cue; silence keeps the preceding phrase.
  const followIndex = useMemo(() => {
    if (!visibleCues.length) return -1;
    const next = visibleCues.findIndex(cue => cue.start > time);
    return next < 0 ? visibleCues.length - 1 : Math.max(0, next - 1);
  }, [visibleCues, time]);
  useEffect(() => {
    if (!follow || followIndex < 0) return;
    const container = panel.current;
    const active = container?.querySelector<HTMLElement>(`[data-cue-index="${followIndex}"]`);
    if (container && active) container.scrollTo?.({ top: Math.max(0, active.offsetTop - container.clientHeight / 2), behavior: 'smooth' });
  }, [followIndex, follow]);
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
    {file.playbackProvider === 'bunny' || isBunnyEmbed(sourceUrl)
      ? <BunnyRecordingVideo seriesId={seriesId} file={file} learner={learner} label={label} sourceUrl={sourceUrl} mediaRef={video}
        onTimeUpdate={() => { readTime(); watch.onPlayedTime(); }} onSeeked={() => { readTime(); watch.onSeeked(); }}
        onPause={() => { readTime(); watch.onStop(); }} onEnded={watch.onStop} onPlayingChange={onPlayingChange} />
      : <video ref={element => { video.current = element; }} controls playsInline preload="none" className="aspect-video w-full rounded-xl bg-black"
      src={sourceUrl || sessionFileUrl(seriesId, file, learner)} aria-label={label}
      onPlaying={() => onPlayingChange?.(true)}
      onWaiting={() => onPlayingChange?.(false)}
      onSeeking={() => onPlayingChange?.(false)}
      onTimeUpdate={() => { readTime(); watch.onPlayedTime(); }} onSeeked={() => { readTime(); watch.onSeeked(); }}
      onLoadedMetadata={readTime} onPause={() => { readTime(); watch.onStop(); onPlayingChange?.(false); }}
      onEnded={() => { watch.onStop(); onPlayingChange?.(false); }} />}
    {trackWatch && (watch.saveError
      ? <p role="status" className="text-xs text-amber-800">{watch.saveError}</p>
      : watch.saved && <p role="status" className="text-xs font-semibold text-primary-700">{watchedText(watch.saved)}</p>)}
    <section className="rounded-xl border bg-background-50" aria-label={`${label} transcript`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-3"><h4 className="text-sm font-semibold">Transcript</h4>
        <div className="flex flex-wrap items-center gap-3">
        {!transcriptLoading && !transcriptLoadError && downloadable.map((item, index) => <a key={item.id}
          href={sessionFileUrl(seriesId, item, learner, true)} download
          className="rounded-lg border bg-white px-3 py-1 text-xs font-semibold text-primary-700">
          Download transcript{downloadable.length > 1 ? ` ${index + 1}` : ''}
        </a>)}
        {visibleCues.length > 0 && <button type="button" aria-label="Follow video" aria-pressed={follow} onClick={() => setFollow(value => !value)}
          className={`rounded-lg border px-3 py-1 text-xs font-semibold ${follow ? 'border-primary-400 bg-primary-50 text-primary-800' : 'bg-white'}`}>
          {follow ? 'Following video' : 'Follow video'}
        </button>}
        </div>
      </header>
      {pendingTranscript && <p role="status" className="p-3 text-sm">Loading saved transcript…</p>}
      {transcriptError && <div role="alert" className="p-3 text-sm text-red-800">{transcriptError} <button type="button" onClick={() => transcriptLoadError ? onTranscriptRetry?.() : setRetry(value => value + 1)} className="underline">Retry transcript</button></div>}
      {!pendingTranscript && !transcriptError && visibleCues.length > 0 && <div ref={panel} className="relative max-h-72 overflow-y-auto p-2">
        <ol className="space-y-1">{visibleCues.map((cue, index) => <li key={`${cue.start}-${index}`}>
          <button type="button" data-cue-index={index} aria-current={cue.start <= time && time < cue.end ? 'true' : undefined}
            onClick={() => seek(cue.start)} className={`flex w-full gap-3 rounded-lg p-3 text-left text-sm ${cue.start <= time && time < cue.end ? 'bg-primary-100 text-primary-900 ring-1 ring-primary-300' : 'hover:bg-background-100'}`}>
            <span className="shrink-0 font-mono text-xs tabular-nums">{cueTime(cue.start)}</span>
            <span dir="auto">{cue.speaker && <strong className="mr-1">{cue.speaker}:</strong>}{cue.text}</span>
          </button>
        </li>)}</ol>
      </div>}
      {!pendingTranscript && !transcriptError && !visibleCues.length && <div className="p-3 text-sm text-foreground-500">
        <p>{!linked.length ? 'No matching transcript has been received for this recording.'
          : linked.some(item => !item.timingReady) ? 'Timed transcript is being prepared. It will appear automatically when saved.'
          : 'No timed speech is available for this recording.'}</p>
        {linked.map(item => item.text && <p key={item.id} dir="auto" className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap">{item.text}</p>)}
      </div>}
    </section>
  </div>;
}
