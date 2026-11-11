import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRecordingPlayer } from './SessionRecordingPlayer';
import { loadRecordingPlayer, loadRecordingWatch, loadTranscriptCues, recordRecordingWatch } from '@/api/sessionResults';

vi.mock('@/api/sessionResults', () => ({
  loadRecordingPlayer: vi.fn(), loadRecordingWatch: vi.fn(), loadTranscriptCues: vi.fn(), recordRecordingWatch: vi.fn(), sessionFileUrl: vi.fn(),
}));
vi.mock('@/api/recordingInsights', () => ({ loadRecordingInsights: vi.fn(async () => ({ audience: 'learner', highlights: { watched: null, finished: null } })) }));
const url = 'https://player.mediadelivery.net/embed/798153/c1c2c3c4-1234-5678-abcd-123456789abc?token=synthetic&expires=9999999999';
const file = { id: 'A', type: 'recording' as const, state: 'ready' as const, playbackProvider: 'bunny' as const };
const learner = { kind: 'commercial' as const, id: '7' };
const message = (frame: HTMLIFrameElement, event: string, value?: unknown, origin = 'https://player.mediadelivery.net', source = frame.contentWindow) =>
  fireEvent(window, new MessageEvent('message', { origin, source, data: JSON.stringify({ context: 'player.js', version: '0.0.11', event, value }) }));

describe('Bunny live-session playback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadRecordingPlayer).mockResolvedValue({ url, provider: 'bunny' });
    vi.mocked(loadRecordingWatch).mockResolvedValue({ watchedSeconds: 0, durationSeconds: 0, csrfToken: 'synthetic-csrf' });
    vi.mocked(recordRecordingWatch).mockResolvedValue({ watchedSeconds: 2, durationSeconds: 600 });
  });

  it('loads a signed iframe from the authorized LMS endpoint and preserves genuine viewing time', async () => {
    const { container } = render(<SessionRecordingPlayer seriesId="S" file={file} transcripts={[]} learner={learner} label="Lecture" trackWatch />);
    const frame = await screen.findByTitle('Lecture') as HTMLIFrameElement;
    expect(frame.src).toBe(url);
    expect(container.querySelector('video')).toBeNull();
    expect(loadRecordingPlayer).toHaveBeenCalledWith('S', expect.objectContaining({ id: 'A' }), learner, expect.any(AbortSignal));
    await act(async () => undefined);
    message(frame, 'play');
    [0, 1, 2, 100].forEach(seconds => message(frame, 'timeupdate', { seconds, duration: 600 }));
    message(frame, 'pause');
    await waitFor(() => expect(recordRecordingWatch).toHaveBeenCalledWith('S', file, learner,
      { watchedSeconds: 2, position: 100, duration: 600 }, 'synthetic-csrf', false));
  });

  it('ignores forged viewing events from another origin or another iframe', async () => {
    render(<SessionRecordingPlayer seriesId="S" file={file} transcripts={[]} learner={learner} label="Lecture" trackWatch />);
    const frame = await screen.findByTitle('Lecture') as HTMLIFrameElement;
    await act(async () => undefined);
    for (const origin of ['https://evil.invalid', 'https://player.mediadelivery.net']) {
      const source = origin.includes('evil') ? frame.contentWindow : window;
      message(frame, 'play', undefined, origin, source);
      [0, 1, 2].forEach(seconds => message(frame, 'timeupdate', { seconds, duration: 600 }, origin, source));
      message(frame, 'pause', undefined, origin, source);
    }
    expect(recordRecordingWatch).not.toHaveBeenCalled();
  });

  it('keeps transcript seeking inside the Bunny player', async () => {
    vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [{ start: 25, end: 30, text: 'Saved phrase', speaker: '' }] });
    render(<SessionRecordingPlayer seriesId="S" file={{ ...file, transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: 0 }] }}
      transcripts={[{ id: 'T', type: 'transcript', state: 'ready' }]} label="Lecture" />);
    const frame = await screen.findByTitle('Lecture') as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, 'postMessage');
    fireEvent.click(await screen.findByRole('button', { name: /Saved phrase/ }));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('"method":"setCurrentTime","value":25'), 'https://player.mediadelivery.net');
  });

  it('follows later overlapping speech from verified Bunny time updates without seeking or recording watch time', async () => {
    vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [
      { start: 0, end: 90, text: 'Opening contribution', speaker: '' },
      { start: 30, end: 40, text: 'Latest contribution', speaker: '' },
    ] });
    render(<SessionRecordingPlayer seriesId="S" file={{ ...file, transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: 0 }] }}
      transcripts={[{ id: 'T', type: 'transcript', state: 'ready' }]} label="Lecture" />);
    const frame = await screen.findByTitle('Lecture') as HTMLIFrameElement;
    const first = await screen.findByRole('button', { name: /Opening contribution/ });
    const second = screen.getByRole('button', { name: /Latest contribution/ });
    const panel = first.closest('ol')!.parentElement!;
    const scrollTo = vi.fn();
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(panel, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(first, 'offsetTop', { configurable: true, value: 100 });
    Object.defineProperty(second, 'offsetTop', { configurable: true, value: 600 });
    const send = vi.spyOn(frame.contentWindow!, 'postMessage');
    message(frame, 'timeupdate', { seconds: 31, duration: 100 });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: 'smooth' });
    expect(second).toHaveAttribute('aria-current', 'true');
    expect(send).not.toHaveBeenCalledWith(expect.stringContaining('setCurrentTime'), expect.anything());
    expect(recordRecordingWatch).not.toHaveBeenCalled();
  });

  it('shows an access error and retries without falling back to Azure', async () => {
    vi.mocked(loadRecordingPlayer).mockRejectedValueOnce(new Error('Bunny playback security key is not configured.'))
      .mockResolvedValueOnce({ url, provider: 'bunny' });
    const { container } = render(<SessionRecordingPlayer seriesId="S" file={file} transcripts={[]} label="Lecture" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('security key');
    expect(container.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry video' }));
    expect(await screen.findByTitle('Lecture')).toHaveAttribute('src', url);
  });
});
