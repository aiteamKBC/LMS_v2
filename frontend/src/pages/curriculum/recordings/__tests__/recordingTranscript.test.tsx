import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSessionResult, loadTranscriptCues, resolveRecordingUrl, type SessionResult } from '@/api/sessionResults';
import RecordingItem from '../components/RecordingItem';
import type { Lecture, Recording } from '../types';

vi.mock('@/api/sessionResults', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/sessionResults')>(),
  loadSessionResult: vi.fn(), loadTranscriptCues: vi.fn(), resolveRecordingUrl: vi.fn(),
}));

const recording: Recording = { id: 'R', label: 'Recording', status: 'ready', source: {
  id: 'R', seriesId: 'S', occurrenceId: 'O', sessionNumber: 2, startsAt: '2026-10-14T08:00:00Z',
  recordedAt: '2026-10-14T08:00:00Z', endsAt: '2026-10-14T10:00:00Z', state: 'ready', status: 'available',
  duplicateCount: 0, hiddenFromLearners: false,
} };
const lecture: Lecture = { id: 'M:O', moduleId: 'M', seriesId: 'S', occurrenceId: 'O', sessionNumber: 2,
  title: 'Synthetic lecture', date: '2026-10-14', startTime: '09:00', endTime: '11:00',
  programme: 'Level 4', cohort: 'October', group: 'Group A', module: 'Data', week: 2, weekTitle: 'Introduction',
  archived: false, programmeActive: true, status: 'ready', recordings: [recording] };
const session: SessionResult = { id: 'O', seriesId: 'S', sessionNumber: 2, startsAt: '2026-10-14T08:00:00Z',
  endsAt: '2026-10-14T10:00:00Z', state: 'completed', reportReady: true, artifacts: [
    { id: 'R', type: 'recording', state: 'ready', transcriptLinks: [{ id: 'T', timingReady: true, offsetSeconds: 0 }] },
    { id: 'T', type: 'transcript', state: 'ready', timingReady: true },
    { id: 'other', type: 'transcript', state: 'ready', text: 'Unrelated transcript' },
  ] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveRecordingUrl).mockResolvedValue('https://storage.invalid/saved-video');
  vi.mocked(loadSessionResult).mockResolvedValue({ sessions: [session] });
  vi.mocked(loadTranscriptCues).mockResolvedValue({ cues: [{ start: 0, end: 5, speaker: 'Tutor', text: 'Saved speech' }] });
});
afterEach(() => cleanup());
const item = (isPlaying = true, value = recording) => <RecordingItem lecture={lecture} recording={value} isPlaying={isPlaying} onPlay={vi.fn()} />;

describe('Delivery recording transcript', () => {
  it('uses the same saved Bunny recording and timed transcript in tutor quality without another upload', async () => {
    const url = 'https://player.mediadelivery.net/embed/798153/c1c2c3c4-1234-5678-abcd-123456789abc?token=synthetic&expires=9999999999';
    vi.mocked(resolveRecordingUrl).mockResolvedValue(url);
    vi.mocked(loadSessionResult).mockResolvedValue({ sessions: [{ ...session, artifacts: session.artifacts!.map(file =>
      file.id === 'R' ? { ...file, playbackProvider: 'bunny' as const } : file) }] });
    const { container } = render(item(true, { ...recording, source: { ...recording.source, playbackProvider: 'bunny' } }));
    expect(await screen.findByTitle(lecture.title)).toHaveAttribute('src', url);
    expect(container.querySelector('video')).toBeNull();
    expect(resolveRecordingUrl).toHaveBeenCalledWith('S', 'R', false, expect.any(AbortSignal));
    expect(await screen.findByRole('button', { name: /Saved speech/ })).toBeInTheDocument();
    expect(loadTranscriptCues).toHaveBeenCalledWith('S', 'T', undefined, expect.any(AbortSignal));
    expect(screen.queryByText('Unrelated transcript')).not.toBeInTheDocument();
  });

  it('loads saved metadata only on playback and downloads only this recording’s linked transcript', async () => {
    const view = render(item(false));
    expect(loadSessionResult).not.toHaveBeenCalled();
    view.rerender(item());
    expect(await screen.findByRole('link', { name: 'Download transcript' })).toHaveAttribute('href', '/curriculum_api/curriculum/session-results/S/artifacts/T/?format=txt');
    expect(loadSessionResult).toHaveBeenCalledWith('S', 2, undefined, expect.any(AbortSignal), 'M');
    expect(await screen.findByRole('button', { name: /Saved speech/ })).toBeInTheDocument();
    expect(loadTranscriptCues).toHaveBeenCalledWith('S', 'T', undefined, expect.any(AbortSignal));
    expect(screen.queryByText('Unrelated transcript')).not.toBeInTheDocument();
  });

  it('keeps video playback available during a failed transcript read and retries independently', async () => {
    vi.mocked(loadSessionResult).mockRejectedValueOnce(new Error('Saved transcript temporarily unavailable'));
    render(item());
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved transcript temporarily unavailable');
    const video = screen.getByLabelText(lecture.title);
    expect(video).toHaveAttribute('src', 'https://storage.invalid/saved-video');
    expect(screen.queryByText(/No matching transcript/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry transcript' }));
    await screen.findByRole('link', { name: 'Download transcript' });
    expect(screen.getByLabelText(lecture.title)).toBe(video);
    expect(resolveRecordingUrl).toHaveBeenCalledTimes(1);
  });

  it('does not turn pending metadata into a missing-transcript claim', async () => {
    let finish!: (value: { sessions: SessionResult[] }) => void;
    vi.mocked(loadSessionResult).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(item());
    expect(await screen.findByText('Loading saved transcript…')).toBeInTheDocument();
    expect(screen.queryByText(/No matching transcript/)).not.toBeInTheDocument();
    await act(async () => finish({ sessions: [session] }));
    await screen.findByRole('link', { name: 'Download transcript' });
  });

  it('rejects a different occurrence even if the response contains the recording id', async () => {
    vi.mocked(loadSessionResult).mockResolvedValue({ sessions: [{ ...session, id: 'OTHER' }] });
    render(item());
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be linked');
    expect(screen.queryByRole('link', { name: /Download transcript/ })).not.toBeInTheDocument();
    expect(loadTranscriptCues).not.toHaveBeenCalled();
  });

  it('ignores a stale response after switching recordings', async () => {
    let finish!: (value: { sessions: SessionResult[] }) => void;
    vi.mocked(loadSessionResult).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(item());
    await waitFor(() => expect(loadSessionResult).toHaveBeenCalledTimes(1));
    vi.mocked(loadSessionResult).mockResolvedValue({ sessions: [{ ...session, id: 'O2', artifacts: [
      { id: 'R2', type: 'recording', state: 'ready', transcriptLinks: [{ id: 'T2', timingReady: false, offsetSeconds: null }] },
      { id: 'T2', type: 'transcript', state: 'ready', text: 'Second recording speech' },
    ] }] });
    view.rerender(item(true, { ...recording, id: 'R2', source: { ...recording.source, id: 'R2', occurrenceId: 'O2', sessionNumber: 3 } }));
    expect(await screen.findByRole('link', { name: 'Download transcript' })).toHaveAttribute('href', expect.stringContaining('/artifacts/T2/'));
    await act(async () => finish({ sessions: [session] }));
    expect(screen.getByRole('link', { name: 'Download transcript' })).toHaveAttribute('href', expect.stringContaining('/artifacts/T2/'));
  });
});
