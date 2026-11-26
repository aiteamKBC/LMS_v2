import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecordingPlayer } from './SessionRecordingPlayer';
import { loadRecordingWatch, loadTranscriptCues, recordRecordingWatch, type SessionFile } from '@/api/sessionResults';
import { loadRecordingInsights } from '@/api/recordingInsights';

vi.mock('@/api/sessionResults', async importOriginal => ({ ...await importOriginal<typeof import('@/api/sessionResults')>(), loadTranscriptCues: vi.fn(), recordRecordingWatch: vi.fn(), loadRecordingWatch: vi.fn() }));
vi.mock('@/api/recordingInsights', () => ({ loadRecordingInsights: vi.fn() }));
const recording: SessionFile = { id: 'V', type: 'recording', state: 'ready', transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: 2 }] };
const transcript: SessionFile = { id: 'T', type: 'transcript', state: 'ready', timingReady: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadRecordingInsights).mockResolvedValue({ audience: 'learner', highlights: { watched: null, finished: null } });
  vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [
    { start: 0, end: 2, text: 'First phrase', speaker: 'Tutor' },
    { start: 3, end: 5, text: 'Second phrase', speaker: 'Learner' },
  ] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shows learner encouragement without writing viewing time or changing playback', async () => {
  vi.mocked(loadRecordingInsights).mockResolvedValue({ audience: 'learner', highlights: { watched: 124, finished: 28 } });
  render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} learner={{ kind: 'commercial', id: '7' }} label="Recording" />);
  const video = screen.getByLabelText('Recording');
  expect(await screen.findByLabelText('Learning community')).toHaveTextContent('124 learners watched');
  expect(screen.getByLabelText('Recording')).toBe(video);
  expect(recordRecordingWatch).not.toHaveBeenCalled();
});

it('attaches the existing timed transcript as a private English caption track', async () => {
  const revoke = vi.fn();
  class CaptionURL extends URL {
    static createObjectURL = vi.fn(() => 'blob:private-caption');
    static revokeObjectURL = revoke;
  }
  vi.stubGlobal('URL', CaptionURL);
  const view = render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} label="Recording" />);
  await waitFor(() => expect(screen.getByLabelText('Recording').querySelector('track')).toHaveAttribute('src', 'blob:private-caption'));
  const track = screen.getByLabelText('Recording').querySelector('track')!;
  expect(track).toHaveAttribute('srclang', 'en');
  expect(track).toHaveAttribute('kind', 'captions');
  expect(track).toHaveAttribute('default');
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:private-caption');
});

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
  function transcriptScroll(first: HTMLElement, second: HTMLElement) {
    const panel = first.closest('ol')!.parentElement!;
    const scrollTo = vi.fn();
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(panel, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(first, 'offsetTop', { configurable: true, value: 100 });
    Object.defineProperty(second, 'offsetTop', { configurable: true, value: 600 });
    return scrollTo;
  }

  it('follows the latest spoken cue when transcript time ranges overlap', async () => {
    vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [
      { start: 0, end: 90, text: 'Long opening contribution', speaker: 'Tutor' },
      { start: 30, end: 40, text: 'Current contribution', speaker: 'Learner' },
    ] });
    render(<SessionRecordingPlayer seriesId="S" file={{ ...recording, transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: 0 }] }}
      transcripts={[transcript]} label="Recording" />);
    const first = await screen.findByRole('button', { name: /Long opening contribution/ });
    const second = screen.getByRole('button', { name: /Current contribution/ });
    const scrollTo = transcriptScroll(first, second);
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    video.currentTime = 31;
    fireEvent.timeUpdate(video);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'smooth' });
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(recordRecordingWatch).not.toHaveBeenCalled();
  });

  it('follows the nearest preceding cue after seeking into a silent gap without starting playback', async () => {
    vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [
      { start: 0, end: 2, text: 'Opening contribution', speaker: '' },
      { start: 30, end: 32, text: 'Nearest contribution', speaker: '' },
    ] });
    render(<SessionRecordingPlayer seriesId="S" file={{ ...recording, transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: 0 }] }}
      transcripts={[transcript]} label="Recording" />);
    const first = await screen.findByRole('button', { name: /Opening contribution/ });
    const second = screen.getByRole('button', { name: /Nearest contribution/ });
    const scrollTo = transcriptScroll(first, second);
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    video.currentTime = 45;
    fireEvent.seeked(video);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'smooth' });
    expect(second).not.toHaveAttribute('aria-current');
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(45);
    expect(recordRecordingWatch).not.toHaveBeenCalled();
  });

  it('shows whether following is enabled and resumes at the current paused video position', async () => {
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} label="Recording" />);
    const first = await screen.findByRole('button', { name: /First phrase/ });
    const second = screen.getByRole('button', { name: /Second phrase/ });
    // Finish the initial follow before observing scrolling after the user's toggle.
    await act(async () => undefined);
    const scrollTo = transcriptScroll(first, second);
    const follow = screen.getByRole('button', { name: 'Follow video' });
    expect(follow).toHaveAttribute('aria-pressed', 'true');
    expect(follow).toHaveTextContent('Following video');
    fireEvent.click(follow);
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    expect(follow).toHaveTextContent('Follow video');
    const video = screen.getByLabelText('Recording') as HTMLVideoElement;
    video.currentTime = 5.5;
    fireEvent.seeked(video);
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(follow);
    expect(follow).toHaveAttribute('aria-pressed', 'true');
    expect(follow).toHaveTextContent('Following video');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'smooth' });
    expect(video.currentTime).toBe(5.5);
    expect(video.paused).toBe(true);
    expect(recordRecordingWatch).not.toHaveBeenCalled();
  });

  it.each([undefined, { kind: 'commercial' as const, id: '7' }, { kind: 'apprenticeship' as const, id: '8' }])('downloads the saved linked text through the current viewer endpoint (%j)', async learner => {
    render(<SessionRecordingPlayer seriesId="S" file={recording} transcripts={[transcript]} learner={learner} label="Recording" />);
    const download = screen.getByRole('link', { name: 'Download transcript' });
    const path = learner ? `/learner_api/session-results/${learner.kind}/${learner.id}/S` : '/curriculum_api/curriculum/session-results/S';
    expect(download).toHaveAttribute('href', `${path}/artifacts/T/?format=txt`);
    expect(download).toHaveAttribute('download');
    await screen.findByRole('button', { name: /First phrase/ });
  });

  it('offers each ready linked part without exposing unrelated or pending transcripts', () => {
    render(<SessionRecordingPlayer seriesId="S" file={{ ...recording, transcriptLinks: [
      { id: 'T', timingReady: false, offsetSeconds: null }, { id: 'T2', timingReady: false, offsetSeconds: null },
      { id: 'pending', timingReady: false, offsetSeconds: null },
    ] }} transcripts={[{ ...transcript, timingReady: false, text: 'Saved text' }, { ...transcript, id: 'T2' },
      { ...transcript, id: 'pending', state: 'pending' }, { ...transcript, id: 'unrelated' }]} label="Recording" />);
    expect(screen.getByRole('link', { name: 'Download transcript 1' })).toHaveAttribute('href', expect.stringContaining('/artifacts/T/?format=txt'));
    expect(screen.getByRole('link', { name: 'Download transcript 2' })).toHaveAttribute('href', expect.stringContaining('/artifacts/T2/?format=txt'));
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(loadTranscriptCues).not.toHaveBeenCalled();
  });

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
    expect(screen.queryByRole('link', { name: /Download transcript/ })).not.toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'Download transcript' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry transcript' }));
    await screen.findByRole('button', { name: /First phrase/ });
    expect(screen.getByLabelText('Recording')).toBe(video);
  });
});
