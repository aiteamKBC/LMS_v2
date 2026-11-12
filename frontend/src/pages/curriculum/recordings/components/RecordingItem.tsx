import { useEffect, useState } from 'react';
import type { Lecture, Recording } from "@/pages/curriculum/recordings/types";
import { STATUS_META } from "@/pages/curriculum/recordings/utils";
import StatusBadge from "@/pages/curriculum/recordings/components/StatusBadge";
import { loadSessionResult, resolveRecordingUrl, type SessionFile } from '@/api/sessionResults';
import { SessionRecordingPlayer } from '@/components/feature/SessionRecordingPlayer';
import RecordingDownloadButton from './RecordingDownloadButton';
import styles from '../Recordings.module.css';

interface RecordingItemProps {
  lecture: Lecture;
  recording: Recording;
  isPlaying: boolean;
  onPlay: (lecture: Lecture, recording: Recording) => void;
}

export default function RecordingItem({
  lecture,
  recording,
  isPlaying,
  onPlay,
}: RecordingItemProps) {
  const meta = STATUS_META[recording.status];
  const isReady = recording.status === "ready";
  const file: SessionFile = { id: recording.source.id, type: 'recording', state: recording.source.state,
    createdAt: recording.source.recordedAt ?? undefined, playbackProvider: recording.source.playbackProvider };
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [playError, setPlayError] = useState('');
  const [savedMedia, setSavedMedia] = useState<{ file: SessionFile; transcripts: SessionFile[] } | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const [transcriptRetry, setTranscriptRetry] = useState(0);
  const { moduleId } = lecture;
  const { seriesId, id: artifactId, occurrenceId, sessionNumber } = recording.source;
  useEffect(() => {
    if (!isPlaying || !isReady) return;
    const controller = new AbortController();
    setPlaybackUrl('');
    setPlayError('');
    void resolveRecordingUrl(recording.source.seriesId, recording.source.id, false, controller.signal)
      .then(url => { if (!controller.signal.aborted) setPlaybackUrl(url); })
      .catch(reason => { if (!controller.signal.aborted) setPlayError(reason instanceof Error ? reason.message : 'The recording could not be played.'); });
    return () => controller.abort();
  }, [isPlaying, isReady, recording.source.seriesId, recording.source.id]);
  useEffect(() => {
    setSavedMedia(null); setTranscriptError(''); setTranscriptLoading(false);
    if (!isPlaying || !isReady || !sessionNumber) return;
    const controller = new AbortController();
    setTranscriptLoading(true);
    void loadSessionResult(seriesId, sessionNumber, undefined, controller.signal, moduleId)
      .then(result => {
        if (controller.signal.aborted) return;
        const session = result.sessions.find(item => (!occurrenceId || item.id === occurrenceId)
          && item.artifacts?.some(artifact => artifact.id === artifactId && artifact.type === 'recording'));
        const savedFile = session?.artifacts?.find(item => item.id === artifactId && item.type === 'recording');
        if (!session?.artifacts || !savedFile) throw new Error('Saved transcript details could not be linked to this recording.');
        setSavedMedia({ file: savedFile, transcripts: session.artifacts.filter(item => item.type === 'transcript') });
      }).catch(reason => {
        if (!controller.signal.aborted) setTranscriptError(reason instanceof Error ? reason.message : 'Saved transcript details could not be loaded.');
      }).finally(() => { if (!controller.signal.aborted) setTranscriptLoading(false); });
    return () => controller.abort();
  }, [isPlaying, isReady, seriesId, artifactId, occurrenceId, sessionNumber, moduleId, transcriptRetry]);

  return (
    <div className={`${styles.recordingCard} rounded-lg border border-background-200 bg-background-50 p-3.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-sm font-bold text-foreground-950">{recording.label}</p>
          {isReady ? (
            <p className="mt-1 text-xs text-foreground-600">
              {recording.durationLabel ? <span>{recording.durationLabel}</span> : null}
              {recording.durationLabel && recording.sizeLabel ? <span> · </span> : null}
              {recording.sizeLabel ? <span>{recording.sizeLabel}</span> : null}
            </p>
          ) : null}
        </div>
        <StatusBadge status={recording.status} />
      </div>

      {recording.note ? (
        <p className="mt-2 text-xs leading-relaxed text-foreground-600">{recording.note}</p>
      ) : null}

      {isReady ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onPlay(lecture, recording)}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-primary-300 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-800 transition-colors hover:bg-primary-100"
          >
            <i className={isPlaying ? "ri-close-line" : "ri-play-line"} aria-hidden="true"></i>
            {isPlaying ? "Close player" : "Play"}
          </button>
          <RecordingDownloadButton seriesId={recording.source.seriesId} artifactId={recording.source.id}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-700 disabled:opacity-60" />
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-background-100 px-3 py-2.5">
          <i className={`${meta.icon} mt-0.5 text-base ${meta.textClass}`} aria-hidden="true"></i>
          <p className="text-xs leading-relaxed text-foreground-700">
            {meta.description} There is no saved file to play or download yet.
          </p>
        </div>
      )}

      {isReady && isPlaying ? (
        <div className="mt-3 overflow-hidden rounded-md">
          {playError && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{playError}</p>}
          {!playError && !playbackUrl && <p role="status" className="p-3 text-sm">Preparing video preview…</p>}
          {playbackUrl && <SessionRecordingPlayer seriesId={seriesId} file={savedMedia?.file || file} transcripts={savedMedia?.transcripts || []}
            label={lecture.title} sourceUrl={playbackUrl} transcriptLoading={transcriptLoading} transcriptLoadError={transcriptError}
            onTranscriptRetry={() => setTranscriptRetry(value => value + 1)} />}
        </div>
      ) : null}
    </div>
  );
}
