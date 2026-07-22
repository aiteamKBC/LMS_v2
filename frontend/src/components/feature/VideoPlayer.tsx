import { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════
   VIDEO PLAYER — renders the right player for a URL and
   reports real playback progress (duration, currentTime,
   ended) upward. Supports:
     - YouTube  (via the IFrame Player API — real duration/time/end)
     - Vimeo    (plain iframe; no progress events -> onUnsupported)
     - direct file .mp4/.webm/... (HTML5 <video> — native events)
   ═══════════════════════════════════════════════════════ */

export type PlaybackKind = 'youtube' | 'vimeo' | 'file';

export interface ParsedVideo {
  kind: PlaybackKind;
  youTubeId?: string;
  src: string;                 // embed src (vimeo) or file url
}

/** Classify a provider URL and extract the id/src needed to play it. */
export function parseVideoUrl(url: string): ParsedVideo {
  const clean = url.trim();
  const yt =
    clean.match(/(?:youtu\.be\/)([\w-]{6,})/) ||
    clean.match(/[?&]v=([\w-]{6,})/) ||
    clean.match(/youtube\.com\/embed\/([\w-]{6,})/);
  if (yt) return { kind: 'youtube', youTubeId: yt[1], src: `https://www.youtube.com/embed/${yt[1]}` };
  const vm = clean.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(clean)) return { kind: 'file', src: clean };
  // Unknown — best-effort iframe, treated like vimeo (no progress events).
  return { kind: 'vimeo', src: clean };
}

interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: unknown) => {
    getDuration: () => number;
    getCurrentTime: () => number;
    destroy: () => void;
  };
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Load the YouTube IFrame API once; resolve when window.YT is ready. */
let ytApiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

export function VideoPlayer({
  parsed, title, onDuration, onProgress, onEnded, onUnsupported,
}: {
  parsed: ParsedVideo;
  title: string;
  onDuration?: (seconds: number) => void;   // real total length, once known
  onProgress?: (currentSeconds: number) => void; // real elapsed within the video
  onEnded?: () => void;                      // playback reached the end
  onUnsupported?: () => void;                // no progress events available (Vimeo/unknown)
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef({ onDuration, onProgress, onEnded, onUnsupported });
  cbRef.current = { onDuration, onProgress, onEnded, onUnsupported };

  // ── YouTube: IFrame Player API ──
  useEffect(() => {
    if (parsed.kind !== 'youtube' || !parsed.youTubeId || !mountRef.current) return;
    let player: { getDuration: () => number; getCurrentTime: () => number; destroy: () => void } | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return;
      const host = document.createElement('div');
      mountRef.current.appendChild(host);
      player = new YT.Player(host, {
        videoId: parsed.youTubeId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            const d = player?.getDuration() ?? 0;
            if (d > 0) cbRef.current.onDuration?.(Math.round(d));
          },
          onStateChange: (e: { data: number }) => {
            // Duration is reliable only once playback starts.
            if (e.data === YT.PlayerState.PLAYING) {
              const d = player?.getDuration() ?? 0;
              if (d > 0) cbRef.current.onDuration?.(Math.round(d));
            }
            if (e.data === YT.PlayerState.ENDED) cbRef.current.onEnded?.();
          },
        },
      });
      // Poll current time for a smooth countdown (state events alone are too coarse).
      poll = setInterval(() => {
        const t = player?.getCurrentTime?.();
        if (typeof t === 'number') cbRef.current.onProgress?.(t);
      }, 500);
    });

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      try { player?.destroy(); } catch { /* player may not be constructed yet */ }
    };
  }, [parsed.kind, parsed.youTubeId]);

  // ── Vimeo / unknown: plain iframe, no progress events ──
  useEffect(() => {
    if (parsed.kind === 'vimeo') cbRef.current.onUnsupported?.();
  }, [parsed.kind]);

  if (parsed.kind === 'youtube') {
    return <div ref={mountRef} className="absolute inset-0 w-full h-full [&>div]:w-full [&>div]:h-full" />;
  }

  if (parsed.kind === 'file') {
    return (
      <video
        src={parsed.src}
        controls
        className="absolute inset-0 w-full h-full bg-black"
        onLoadedMetadata={(e) => onDuration?.(Math.round((e.target as HTMLVideoElement).duration))}
        onTimeUpdate={(e) => onProgress?.((e.target as HTMLVideoElement).currentTime)}
        onEnded={() => onEnded?.()}
      >
        Your browser does not support the video tag.
      </video>
    );
  }

  // Vimeo / unknown — plain embed (progress tracked via onUnsupported fallback).
  return (
    <iframe
      src={parsed.src}
      title={title}
      className="absolute inset-0 w-full h-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}
