import { useEffect, useState } from 'react';

export interface CaptionCue { start: number; end: number; text: string; speaker?: string }

export function captionVtt(cues: CaptionCue[]): string {
  const stamp = (seconds: number) => {
    const millis = Math.round(seconds * 1000);
    return `${String(Math.floor(millis / 3600000)).padStart(2, '0')}:${String(Math.floor(millis / 60000) % 60).padStart(2, '0')}:${String(Math.floor(millis / 1000) % 60).padStart(2, '0')}.${String(millis % 1000).padStart(3, '0')}`;
  };
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `WEBVTT\n\n${cues.filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > Math.max(0, cue.start))
    .map(cue => `${stamp(Math.max(0, cue.start))} --> ${stamp(cue.end)}\n${escape(`${cue.speaker ? `${cue.speaker}: ` : ''}${cue.text}`).split(/\r?\n/).filter(line => line.trim()).join('\n')}\n`).join('\n')}`;
}

/** Private, in-memory caption file; never upload a learner's transcript from the browser. */
export function useCaptionTrack(cues: CaptionCue[]) {
  const [track, setTrack] = useState<{ cues: CaptionCue[]; source: string } | null>(null);
  useEffect(() => {
    setTrack(null);
    if (!cues.length || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(new Blob([captionVtt(cues)], { type: 'text/vtt' }));
    setTrack({ cues, source: url });
    return () => URL.revokeObjectURL(url);
  }, [cues]);
  return track?.cues === cues ? track.source : '';
}
