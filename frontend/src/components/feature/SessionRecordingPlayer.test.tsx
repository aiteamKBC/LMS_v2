import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecordingPlayer } from './SessionRecordingPlayer';
import { loadRecordingWatch, loadTranscriptCues, recordRecordingWatch, type SessionFile } from '@/api/sessionResults';

vi.mock('@/api/sessionResults', async importOriginal => ({ ...await importOriginal<typeof import('@/api/sessionResults')>(), loadTranscriptCues: vi.fn(), recordRecordingWatch: vi.fn(), loadRecordingWatch: vi.fn() }));
const recording: SessionFile = { id: 'V', type: 'recording', state: 'ready', transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: 2 }] };
const transcript: SessionFile = { id: 'T', type: 'transcript', state: 'ready', timingReady: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [
    { start: 0, end: 2, text: 'First phrase', speaker: 'Tutor' },
    { start: 3, end: 5, text: 'Second phrase', speaker: 'Learner' },
  ] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('recording watch tracking', () => {
  const learner = { kind: 'apprenticeship' as const, id: '101' };
  beforeEach(() => {
    vi.mocked(loadRecordingWatch).mockResolvedValue({ watchedSeconds: 0, durationSeconds: 0, csrfToken: 'token-1' });
  });
  const play = (video: HTMLVideoElement, times: number[]) => {
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'seeking', { configurable: true, value: false });
    times.forEach(time => { video.currentTime = time; fireEvent.timeUpdate(video); });
  };

  it('reports only seconds actually played, not a jump ahead, when the learner pauses', async () => {
    vi.mocked(recordRecordingWatch).mockResolvedValue({ watchedSeconds: 4, durationSeconds: 0 });
    const onWatchTimeChange = vi.fn();
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} learner={learner} label="Recording" trackWatch onWatchTimeChange={onWatchTimeChange} />);
    await waitFor(() => expect(loadRecordingWatch).toHaveBeenCalled());
    await act(async () => undefined);
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    play(video, [0, 1.5, 3, 100, 101]);
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    fireEvent.pause(video);
    expect(recordRecordingWatch).toHaveBeenCalledTimes(1);
    expect(recordRecordingWatch).toHaveBeenCalledWith('S', recording, learner,
      { watchedSeconds: 4, position: 101, duration: 0 }, 'token-1', false);
    await waitFor(() => expect(onWatchTimeChange).toHaveBeenLastCalledWith(4));
    expect(await screen.findByText('Viewing time saved: under 1 min')).toBeInTheDocument();
  });

  it('reports zero viewing time before the learner starts the recording', async () => {
    const onWatchTimeChange = vi.fn();
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} learner={learner} label="Recording" trackWatch onWatchTimeChange={onWatchTimeChange} />);
    await waitFor(() => expect(onWatchTimeChange).toHaveBeenCalledWith(0));
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('shows the saved total and says when viewing time could not be saved', async () => {
    vi.mocked(recordRecordingWatch).mockResolvedValueOnce({ watchedSeconds: 2820, durationSeconds: 7200 })
      .mockRejectedValueOnce(new Error('Viewing time could not be saved (403).'));
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} learner={learner} label="Recording" trackWatch />);
    await act(async () => undefined);
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    play(video, [0, 1, 2]);
    fireEvent.pause(video);
    expect(await screen.findByText('Watched 47 of 120 min')).toBeInTheDocument();
    play(video, [3, 4, 5]);
    fireEvent.pause(video);
    expect(await screen.findByText('Viewing time could not be saved (403).')).toBeInTheDocument();
  });

  it('shows viewing saved earlier as soon as the recording opens', async () => {
    vi.mocked(loadRecordingWatch).mockResolvedValue({ watchedSeconds: 600, durationSeconds: 7200, csrfToken: 'token-1' });
    const onWatchTimeChange = vi.fn();
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} learner={learner} label="Recording" trackWatch onWatchTimeChange={onWatchTimeChange} />);
    expect(await screen.findByText('Watched 10 of 120 min')).toBeInTheDocument();
    await waitFor(() => expect(onWatchTimeChange).toHaveBeenLastCalledWith(600));
  });

  it('does not report viewing for staff previews', () => {
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} learner={learner} label="Recording" />);
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    play(video, [0, 1, 2, 3]);
    fireEvent.pause(video);
    expect(recordRecordingWatch).not.toHaveBeenCalled();
    expect(loadRecordingWatch).not.toHaveBeenCalled();
  });
});

describe('recording transcript', () => {
  it('highlights and seeks using media time plus the stored offset, preserving pause', async () => {
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} label="Recording" />);
    const first = await screen.findByRole('button', { name: /First phrase/ });
    const second = screen.getByRole('button', { name: /Second phrase/ });
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    video.currentTime = 2.5; fireEvent.timeUpdate(video);
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(second).not.toHaveAttribute('aria-current');
    video.currentTime = 4; fireEvent.seeked(video);
    expect(first).not.toHaveAttribute('aria-current');
    fireEvent.click(second);
    expect(video.currentTime).toBe(5);
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(video.paused).toBe(true);
    video.currentTime = 2.1; fireEvent.seeked(video);
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(loadTranscriptCues).toHaveBeenCalledTimes(1);
  });

  it('keeps separate recordings and transcripts independent across saved-result refreshes', async () => {
    const second: SessionFile = { ...recording, id: 'V2', transcriptLinks: [{ id: 'T2', timingReady: true, offsetSeconds: 0 }] };
    const make = () => <><SessionRecordingPlayer seriesId="S" file={{ ...recording }} transcripts={[{ ...transcript }]} label="Recording 1" />
      <SessionRecordingPlayer seriesId="S" file={second} transcripts={[{ ...transcript, id: 'T2' }]} label="Recording 2" /></>;
    const view = render(make());
    await waitFor(() => expect(loadTranscriptCues).toHaveBeenCalledTimes(2));
    const video = screen.getByLabelText('Recording 1') as HTMLVideoElement;
    video.currentTime = 5; fireEvent.timeUpdate(video);
    expect(within(screen.getByRole('region', { name: 'Recording 1 transcript' })).getByRole('button', { name: /Second phrase/ })).toHaveAttribute('aria-current', 'true');
    expect(within(screen.getByRole('region', { name: 'Recording 2 transcript' })).getByRole('button', { name: /Second phrase/ })).not.toHaveAttribute('aria-current');
    view.rerender(make());
    expect(loadTranscriptCues).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Recording 1')).toBe(video);
    expect(video.currentTime).toBe(5);
  });

  it('requests learner-scoped cues and clips speech before and after this recording', async () => {
    vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [
      { start: 0, end: 3, text: 'Earlier recording', speaker: '' },
      { start: 6, end: 8, text: 'Current recording', speaker: '' },
      { start: 30, end: 40, text: 'Later recording', speaker: '' },
    ] });
    render(<SessionRecordingPlayer seriesId="S" file={{ ...recording, transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: -5 }] }}
      transcripts={[transcript]} label="Recording" learner={{ kind: 'apprenticeship', id: '7' }} />);
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 10 }); fireEvent.loadedMetadata(video);
    await screen.findByRole('button', { name: /Current recording/ });
    expect(screen.queryByRole('button', { name: /Earlier recording|Later recording/ })).not.toBeInTheDocument();
    expect(loadTranscriptCues).toHaveBeenCalledWith('S', 'T', { kind: 'apprenticeship', id: '7' }, expect.any(AbortSignal));
  });

  it('never guesses a transcript when no association or timing exists', async () => {
    const page = render(<SessionRecordingPlayer seriesId="S" file={{ ...recording, transcriptLinks: [] }} transcripts={[transcript]} label="Recording" />);
    expect(screen.getByText(/No matching transcript/)).toBeInTheDocument();
    expect(loadTranscriptCues).not.toHaveBeenCalled();
    page.rerender(<SessionRecordingPlayer seriesId="S" file={{ ...recording, transcriptLinks: [{ id: 'T', timingReady: false, offsetSeconds: 0 }] }}
      transcripts={[{ ...transcript, timingReady: false, text: 'Saved plain text' }]} label="Recording" />);
    expect(screen.getByText('Saved plain text')).toBeInTheDocument();
    expect(screen.getByText(/being prepared/)).toBeInTheDocument();
    await act(async () => {});
    expect(loadTranscriptCues).not.toHaveBeenCalled();
  });

  it('reports failed cue reads and allows retry without replacing the video', async () => {
    vi.mocked(loadTranscriptCues).mockRejectedValueOnce(new Error('Saved transcript unavailable'));
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} label="Recording" />);
    const video = screen.getByLabelText('Recording');
    await screen.findByText('Saved transcript unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry transcript' }));
    await screen.findByRole('button', { name: /First phrase/ });
    expect(screen.getByLabelText('Recording')).toBe(video);
  });
});
