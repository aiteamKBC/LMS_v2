import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionResults } from './SessionResults';
import { ModuleSessions } from '@/pages/curriculum/module-workspace/ModuleSessions';
import { coachFetch } from '@/lib/coachFetch';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const session = {
  id: 'O1', seriesId: 'S1', sessionNumber: 1, startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T10:00:00Z',
  state: 'completed', reportReady: true, syncedAt: '2026-09-01T11:00:00Z',
  attendance: [{ email: 'learner@example.invalid', name: 'Learner One', seconds: 240, attendance: 1, status: 'present', expected: true, excused: false, catchupCompleted: false }],
  artifacts: [{ id: 'recording-1', type: 'recording', state: 'ready' }, { id: 'transcript-1', type: 'transcript', state: 'ready', text: 'Speaker: Saved lesson.' }],
};
const fetchMock = vi.fn();
const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockImplementation(() => ok({ sessions: [session] })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Saved session results', () => {
  it('loads one saved session and embeds private playback without Graph sync', async () => {
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} /></MemoryRouter>);
    const video = await screen.findByLabelText('Session recording 1');
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('src', '/curriculum_api/curriculum/session-results/S1/artifacts/recording-1/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(coachFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'transcripts' }));
    expect(screen.getByText('Speaker: Saved lesson.')).toBeInTheDocument();
    expect(screen.getByText('Download TXT')).toHaveAttribute('href', expect.stringContaining('?format=txt'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('learner uses the scoped route and cannot access the attendance roster or export', async () => {
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} learner={{ kind: 'commercial', id: '7' }} /></MemoryRouter>);
    await screen.findByText('Your attendance: Present');
    expect(fetchMock.mock.calls[0][0]).toBe('/learner_api/session-results/commercial/7/S1/sessions/1/');
    expect(screen.queryByRole('tab', { name: 'attendance' })).not.toBeInTheDocument();
    expect(screen.queryByText('Export attendance CSV')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Session recording 1')).toHaveAttribute('src', '/learner_api/session-results/commercial/7/S1/artifacts/recording-1/');
  });

  it('shows saved excused absence as zero with the catch-up action', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, attendance: [{ ...session.attendance[0], status: 'excused', attendance: 0, excused: true }] }] }));
    render(<MemoryRouter><SessionResults seriesId="S1" sessionNumber={1} learner={{ kind: 'apprenticeship', id: '7' }} /></MemoryRouter>);
    expect(await screen.findByText(/Your attendance: Excused/)).toBeInTheDocument();
    expect(screen.getByText('Book catch-up with your coach')).toHaveAttribute('href', '/learner/attendance');
  });

  it('shows a failed archive without attempting playback', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, artifacts: [{ id: 'A', type: 'recording', state: 'failed' }] }] }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    expect(await screen.findByText(/Saving this recording needs retry/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument();
  });

  it('keeps network errors visible and supports a read-only retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Saved results unavailable'));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved results unavailable');
    fireEvent.click(screen.getByText('Refresh saved results'));
    expect(await screen.findByLabelText('Session recording 1')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('exports and searches only the opened session', async () => {
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByText('Export attendance CSV')).toHaveAttribute('href', '/curriculum_api/curriculum/session-results/S1/sessions/1/attendance.csv');
    fireEvent.change(screen.getByLabelText('Search attendance'), { target: { value: 'nobody' } });
    expect(screen.queryByText('Learner One')).not.toBeInTheDocument();
  });

  it('queues synchronization from the open admin session without reloading or polling', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ state: 'queued', message: 'Sync requested.' }) } as Response);
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    await screen.findByLabelText('Session recording 1');
    fireEvent.click(screen.getByRole('button', { name: 'Sync attendance & files' }));
    expect(await screen.findByText('Sync requested.')).toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps attendance visible with a precise setup warning when archive storage is missing', async () => {
    fetchMock.mockImplementation(() => ok({ sessions: [{ ...session, archiveReady: false,
      artifacts: session.artifacts.map(file => ({ ...file, state: 'pending' })) }] }));
    render(<SessionResults seriesId="S1" sessionNumber={1} />);
    expect(await screen.findByText(/Recording storage needs setup/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync attendance & files' })).toBeDisabled();
    expect(screen.getByText(/Teams has a recording/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'attendance' }));
    expect(screen.getByText('Learner One')).toBeInTheDocument();
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('previews saved media without exposing the roster or synchronization controls', async () => {
    render(<SessionResults seriesId="S1" sessionNumber={1} preview />);
    await screen.findByLabelText('Session recording 1');
    expect(screen.queryByRole('tab', { name: 'attendance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync attendance & files' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your attendance: Present')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'transcripts' }));
    expect(screen.getByText('Speaker: Saved lesson.')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });
});

describe('Module session index', () => {
  beforeEach(() => { fetchMock.mockImplementation((url: string) => ok(url.includes('/modules/')
    ? { series: [{ id: 'S1', title: 'Example module', sessions: [session] }], jobs: [] }
    : { sessions: [session] })); });

  it('does not fetch session details until opened, then queues sync without waiting on Graph', async () => {
    vi.mocked(coachFetch).mockResolvedValue({ ok: true, json: async () => ({ state: 'queued', message: 'Sync requested. Results will be saved in the background.' }) } as Response);
    render(<ModuleSessions moduleId="M1" />);
    await screen.findByText('Session 1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Sync attendance & files'));
    await screen.findByText('Sync requested. Results will be saved in the background.');
    expect(coachFetch).toHaveBeenCalledWith('/curriculum_api/curriculum/session-results/S1/sync/', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Session 1'));
    await screen.findByLabelText('Session recording 1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the previously selected session when the module changes', async () => {
    const page = render(<ModuleSessions moduleId="M1" />);
    fireEvent.click(await screen.findByText('Session 1'));
    await screen.findByLabelText('Session recording 1');
    page.rerender(<ModuleSessions moduleId="M2" />);
    await waitFor(() => expect(screen.queryByLabelText('Session recording 1')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(call => call[0].includes('/modules/M2/'))).toBe(true);
  });

  it('shows saved sessions and a disabled sync action when setup is incomplete', async () => {
    fetchMock.mockImplementation(() => ok({ series: [{ id: 'S1', title: 'Example module', sessions: [session] }],
      jobs: [], syncAvailable: false, warning: 'Recording storage needs setup.' }));
    render(<ModuleSessions moduleId="M1" />);
    await screen.findByText('Session 1');
    expect(screen.getByText('Recording storage needs setup.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync attendance & files' })).toBeDisabled();
    expect(screen.getByText('Attendance report saved')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });
});
