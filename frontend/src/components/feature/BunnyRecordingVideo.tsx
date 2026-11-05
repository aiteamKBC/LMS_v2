import { useEffect, useRef, useState, type RefObject } from 'react';
import { loadRecordingPlayer, type SessionFile, type SessionLearner } from '@/api/sessionResults';
import { isBunnyEmbed, type RecordingMedia } from './bunnyRecordingProtocol';

/** Player.js protocol: accept events only from this iframe and its exact origin. */
export function BunnyRecordingVideo({ seriesId, file, learner, label, sourceUrl, mediaRef, onTimeUpdate, onSeeked, onPause, onEnded, onPlayingChange }: {
  seriesId: string; file: SessionFile; learner?: SessionLearner; label: string; sourceUrl?: string;
  mediaRef: RefObject<RecordingMedia | null>;
  onTimeUpdate: () => void; onSeeked: () => void; onPause: () => void; onEnded: () => void;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const callbacks = useRef({ onTimeUpdate, onSeeked, onPause, onEnded, onPlayingChange });
  useEffect(() => { callbacks.current = { onTimeUpdate, onSeeked, onPause, onEnded, onPlayingChange }; });
  const kind = learner?.kind, learnerId = learner?.id;
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setUrl('');
    if (isBunnyEmbed(sourceUrl) && retry === 0) setUrl(sourceUrl!);
    else void loadRecordingPlayer(seriesId, { id: file.id, type: 'recording', state: 'ready' },
      kind && learnerId ? { kind, id: learnerId } : undefined, controller.signal)
      .then(result => {
        if (!isBunnyEmbed(result.url)) throw new Error('The recording player address is invalid.');
        if (!controller.signal.aborted) setUrl(result.url);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The video could not be loaded.'); });
    return () => controller.abort();
  }, [seriesId, file.id, kind, learnerId, sourceUrl, retry]);

  const send = (method: string, value?: unknown) => {
    if (!url || !frame.current?.contentWindow) return;
    frame.current.contentWindow.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', method, value }), new URL(url).origin);
  };
  useEffect(() => {
    if (!url) return;
    let position = 0;
    const media: RecordingMedia = {
      get currentTime() { return position; },
      set currentTime(value) {
        if (!Number.isFinite(value)) return;
        position = value; media.seeking = true;
        frame.current?.contentWindow?.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', method: 'setCurrentTime', value }), new URL(url).origin);
      },
      duration: NaN, paused: true, seeking: false,
    };
    mediaRef.current = media;
    const origin = new URL(url).origin;
    let subscribed = false;
    const message = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      let data;
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!data || data.context !== 'player.js') return;
      const notify = callbacks.current;
      if (data.event === 'ready' || data.event === 'getPaused') {
        if (typeof data.value === 'boolean') media.paused = data.value;
        if (subscribed) return;
        subscribed = true;
        ['play', 'pause', 'ended', 'timeupdate', 'error'].forEach(name => {
          frame.current?.contentWindow?.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', method: 'addEventListener', value: name }), origin);
        });
      } else if (data.event === 'play') { media.paused = false; notify.onPlayingChange?.(true); }
      else if (data.event === 'pause' || data.event === 'ended') {
        media.paused = true; notify.onPlayingChange?.(false);
        if (data.event === 'ended') notify.onEnded(); else notify.onPause();
      } else if (data.event === 'timeupdate') {
        if (!Number.isFinite(data.value?.seconds) || data.value.seconds < 0) return;
        position = data.value.seconds;
        if (Number.isFinite(data.value.duration) && data.value.duration > 0) media.duration = data.value.duration;
        if (media.seeking) { media.seeking = false; notify.onSeeked(); }
        notify.onTimeUpdate();
      } else if (data.event === 'error') { media.paused = true; notify.onPlayingChange?.(false); setError('Video playback is unavailable. Please retry.'); }
    };
    window.addEventListener('message', message);
    return () => { window.removeEventListener('message', message); if (mediaRef.current === media) mediaRef.current = null; };
  }, [url, mediaRef]);
  return <div className="space-y-2">
    {error ? <p role="alert" className="p-3 text-sm text-red-800">{error} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>Retry video</button></p>
      : url ? <iframe ref={frame} src={url} title={label} aria-label={label} className="aspect-video w-full rounded-xl border-0 bg-black"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => send('getPaused')} />
        : <p role="status" className="p-3 text-sm">Preparing video…</p>}
    {url && !error && <button type="button" className="text-xs underline" onClick={() => setRetry(value => value + 1)}>Reload video</button>}
  </div>;
}
