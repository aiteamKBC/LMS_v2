import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveSessionArtifacts } from '@/lib/curriculumApi';
import { syncTeamsMeetingArtifacts } from '../../../module-builder/moduleAuthoringData';
import { LiveSessionArtifactsPanel, type LiveSessionArtifactTarget } from '../liveSessionArtifacts';

vi.mock('@/lib/curriculumApi', () => ({
  fetchLiveSessionArtifacts: vi.fn(),
  liveSessionArtifactContentUrl: vi.fn(),
  liveSessionArtifactPreviewUrl: vi.fn(),
}));
vi.mock('../../../module-builder/moduleAuthoringData', () => ({ syncTeamsMeetingArtifacts: vi.fn() }));

const session: LiveSessionArtifactTarget = {
  liveSessionId: 'S1', title: 'Example session', dateIso: '2026-09-16T09:00:00Z',
  date: '2026-09-16', actualStart: '', artifactsSyncedAt: '',
};
const saved = { series: { id: 'S1' }, occurrences: [{ id: 'O1', live_session_id: 'S1', session_number: 1 }] };
const fetchArtifacts = vi.mocked(fetchLiveSessionArtifacts);
const syncArtifacts = vi.mocked(syncTeamsMeetingArtifacts);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  fetchArtifacts.mockResolvedValue(saved);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shared artifact panel with background synchronization', () => {
  it('shows a queued result without rereading stale files or repeating the sync', async () => {
    syncArtifacts.mockResolvedValue({ state: 'queued', message: 'Synchronization queued. Check saved results shortly.' });
    render(<LiveSessionArtifactsPanel session={session} sessionNumber={1} />);
    await screen.findByText('Expected per run');
    expect(syncArtifacts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sync from Teams' }));
    expect(await screen.findByText('Synchronization queued. Check saved results shortly.')).toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(syncArtifacts).toHaveBeenCalledExactlyOnceWith('S1');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved results' }));
    await waitFor(() => expect(fetchArtifacts).toHaveBeenCalledTimes(2));
    expect(fetchArtifacts).toHaveBeenLastCalledWith('S1', { skipCache: true });
    expect(syncArtifacts).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves refresh and partial failure messages for completed legacy sync responses', async () => {
    syncArtifacts.mockResolvedValue({ synced: { attendanceReports: 1, attendanceRecords: 1, transcripts: 0, recordings: 0 },
      partial: true, errors: ['Recording is still processing.'] });
    render(<LiveSessionArtifactsPanel session={session} sessionNumber={1} />);
    await screen.findByText('Expected per run');
    fireEvent.click(screen.getByRole('button', { name: 'Sync from Teams' }));
    expect(await screen.findByText('Recording is still processing.')).toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledTimes(2);
    expect(fetchArtifacts).toHaveBeenLastCalledWith('S1', { skipCache: true });
  });

  it('shows a rejected queue request and leaves saved data available', async () => {
    syncArtifacts.mockRejectedValue(new Error('Could not queue synchronization.'));
    render(<LiveSessionArtifactsPanel session={session} sessionNumber={1} />);
    await screen.findByText('Expected per run');
    fireEvent.click(screen.getByRole('button', { name: 'Sync from Teams' }));
    expect(await screen.findByText('Could not queue synchronization.')).toBeInTheDocument();
    expect(screen.getByText('Expected per run')).toBeInTheDocument();
    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sync from Teams' })).toBeEnabled();
  });
});
