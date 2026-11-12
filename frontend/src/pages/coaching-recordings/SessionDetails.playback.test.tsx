import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadCoachingSession, type CoachingSessionDetails } from '@/api/coachingRecordings';
import { prepareRecordingPlayback } from './recordingPlayback';
import SessionDetails from './SessionDetails';

vi.mock('@/api/coachingRecordings', async () => ({
  ...await vi.importActual<typeof import('@/api/coachingRecordings')>('@/api/coachingRecordings'), loadCoachingSession: vi.fn(),
}));
vi.mock('./recordingPlayback', () => ({ prepareRecordingPlayback: vi.fn() }));
vi.mock('./SavedMeetingEvidence', () => ({ default: () => null }));
const occurrence = { id: 'a'.repeat(32), startsAt: '2026-11-03T10:00:00Z', endsAt: '2026-11-03T11:00:00Z', timeZone: 'UTC' };
const details: CoachingSessionDetails = { eventKey: 'coach-calendar:synthetic', partial: false,
  media: { state: 'ready', readyCount: 1, recordings: [{ id: 'file', state: 'ready' }] },
  attendance: { state: 'pending', reportCount: 0, rows: [] } };
const props = { eventKey: '', reference: 'expired-reference', occurrence };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCoachingSession).mockResolvedValue(details);
  vi.mocked(prepareRecordingPlayback).mockResolvedValue({ url: '/video?reference=fresh', reference: 'fresh' });
});

it('pauses a hidden player and preserves its prepared source and attendance when changing tabs', async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  try {
    const view = render(<SessionDetails {...props} section="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
    const player = await screen.findByLabelText('Coaching recording player');
    expect(player).toBeVisible();
    expect(screen.getByText(/Attendance remains pending/)).not.toBeVisible();
    view.rerender(<SessionDetails {...props} section="attendance" />);
    expect(pause).toHaveBeenCalledOnce();
    expect(player).not.toBeVisible();
    expect(screen.getByText(/Attendance remains pending/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Play recording 1' })).not.toBeInTheDocument();
    view.rerender(<SessionDetails {...props} section="recordings" />);
    expect(screen.getByLabelText('Coaching recording player')).toBe(player);
    expect(player).toBeVisible();
    expect(prepareRecordingPlayback).toHaveBeenCalledOnce();
    expect(loadCoachingSession).toHaveBeenCalledOnce();
  } finally { pause.mockRestore(); }
});

it('prepares the chosen occurrence before mounting an autoplaying video', async () => {
  let finish!: (value: { url: string; reference: string }) => void;
  vi.mocked(prepareRecordingPlayback).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<SessionDetails {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
  expect(screen.getByText('Preparing recording…')).toBeInTheDocument();
  expect(screen.queryByLabelText('Coaching recording player')).not.toBeInTheDocument();
  expect(prepareRecordingPlayback).toHaveBeenCalledWith({ eventKey: details.eventKey, recordingId: 'file', reference: props.reference, occurrence }, expect.any(AbortSignal));
  await act(async () => finish({ url: '/video?reference=fresh', reference: 'fresh' }));
  expect(screen.getByLabelText('Coaching recording player')).toHaveAttribute('autoplay');
  expect(screen.getByLabelText('Coaching recording player')).toHaveAttribute('src', '/video?reference=fresh');
  expect(screen.getByRole('link', { name: 'Download recording 1' })).toHaveAttribute('href', expect.stringContaining('reference=fresh'));
});

it('does not autoplay a recording that finishes preparing after its tab was hidden', async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let finish!: (value: { url: string; reference: string }) => void;
  vi.mocked(prepareRecordingPlayback).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  try {
    const view = render(<SessionDetails {...props} section="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
    view.rerender(<SessionDetails {...props} section="attendance" />);
    await act(async () => finish({ url: '/video?reference=fresh', reference: 'fresh' }));
    const player = screen.getByLabelText('Coaching recording player');
    expect(player).not.toBeVisible();
    expect(player).not.toHaveAttribute('autoplay');
    expect(pause).toHaveBeenCalledOnce();
    expect(screen.getByText(/Attendance remains pending/)).toBeVisible();
  } finally { pause.mockRestore(); }
});

it('recreates the same video and renews preparation on retry after a media failure', async () => {
  render(<SessionDetails {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
  const first = await screen.findByLabelText('Coaching recording player');
  fireEvent.error(first);
  fireEvent.click(screen.getByRole('button', { name: 'Retry playback' }));
  const second = await screen.findByLabelText('Coaching recording player');
  expect(second).not.toBe(first);
  expect(prepareRecordingPlayback).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('shows a rejected access check without starting video and allows an explicit retry', async () => {
  vi.mocked(prepareRecordingPlayback).mockRejectedValueOnce(new Error('You no longer have access to this recording.'));
  render(<SessionDetails {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer have access');
  expect(screen.queryByLabelText('Coaching recording player')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Play recording 1' })).toBeEnabled();
});

it('cancels playback preparation when the drawer closes', async () => {
  vi.mocked(prepareRecordingPlayback).mockReturnValueOnce(new Promise(() => {}));
  const view = render(<SessionDetails {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
  await waitFor(() => expect(prepareRecordingPlayback).toHaveBeenCalledOnce());
  const signal = vi.mocked(prepareRecordingPlayback).mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it('loads English captions through the same authorised endpoint and retries without restarting video', async () => {
  render(<SessionDetails {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play recording 1' }));
  const video = await screen.findByLabelText('Coaching recording player');
  const track = video.querySelector('track')!;
  expect(track).toHaveAttribute('srclang', 'en');
  expect(track).toHaveAttribute('src', '/video?reference=fresh&format=captions&captionRetry=0');
  fireEvent.error(track);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry captions' }));
  expect(screen.getByLabelText('Coaching recording player')).toBe(video);
  expect(video.querySelector('track')).toHaveAttribute('src', expect.stringContaining('captionRetry=1'));
  expect(prepareRecordingPlayback).toHaveBeenCalledOnce();
});
