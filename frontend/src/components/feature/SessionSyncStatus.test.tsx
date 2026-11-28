import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionSyncStatus } from './SessionSyncStatus';
import type { SessionSyncJob } from '@/api/sessionResults';

const job: SessionSyncJob = {
  live_session_id: 'S1', state: 'running', last_error: '',
  progress: { filesReady: 1, totalFiles: 3, transfer: {
    phase: 'downloading', bytesTransferred: 50 * 1024 * 1024, totalBytes: 100 * 1024 * 1024,
    updatedAt: new Date().toISOString(), type: 'recording', sessionNumber: 12,
  } },
};
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('session sync progress', () => {
  it('labels the real per-stage percentage and exact session without calling it overall completion', () => {
    const { rerender } = render(<SessionSyncStatus job={job} />);
    expect(screen.getByRole('progressbar', { name: 'Downloading recording' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('50% downloaded')).toBeInTheDocument();
    expect(screen.getByText('50.0 MB of 100.0 MB')).toBeInTheDocument();
    expect(screen.getByText('Downloading recording · Session 12')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 discovered files saved')).toBeInTheDocument();
    rerender(<SessionSyncStatus job={{ ...job, progress: { ...job.progress!, transfer: {
      ...job.progress!.transfer!, phase: 'uploading', bytesTransferred: 10 * 1024 * 1024,
    } } }} />);
    expect(screen.getByRole('progressbar', { name: 'Uploading recording to Azure' })).toHaveAttribute('aria-valuenow', '10');
    expect(screen.getByText('10% uploaded')).toBeInTheDocument();
    expect(screen.queryByText(/Sync pass complete/)).not.toBeInTheDocument();
  });

  it('shows bytes with an indeterminate bar when the total size is unavailable', () => {
    render(<SessionSyncStatus job={{ ...job, progress: { ...job.progress!, transfer: {
      ...job.progress!.transfer!, totalBytes: null,
    } } }} />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText(/50.0 MB transferred · Total size not available/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('does not reuse an old attempt percentage while queued and supports older servers', () => {
    const { rerender } = render(<SessionSyncStatus job={{ ...job, state: 'queued' }} />);
    expect(screen.getByRole('progressbar', { name: 'Waiting to start' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText('50% downloaded')).not.toBeInTheDocument();
    rerender(<SessionSyncStatus job={{ ...job, progress: undefined }} />);
    expect(screen.getByRole('progressbar', { name: 'Waiting for a transfer progress update' })).not.toHaveAttribute('aria-valuenow');
  });

  it('identifies stale telemetry without pretending the transfer failed or advanced', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-17T12:00:00Z');
    render(<SessionSyncStatus job={{ ...job, progress: { ...job.progress!, transfer: {
      ...job.progress!.transfer!, updatedAt: '2026-09-17T12:00:00Z',
    } } }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(screen.getByText(/No new transfer update for over a minute/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows failed partial progress and marks only a completed pass as finished', () => {
    const { rerender } = render(<SessionSyncStatus job={{ ...job, state: 'failed', last_error: 'Storage unavailable.' }} />);
    // An older server sends no categories: plain wording, raw text only under Technical details.
    expect(screen.getByRole('alert')).toHaveTextContent('Part of the sync did not finish');
    expect(screen.getByText('Storage unavailable.').closest('details')).not.toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    rerender(<SessionSyncStatus job={{ ...job, state: 'complete' }} />);
    expect(screen.getByRole('progressbar', { name: 'Sync pass complete' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/Files not yet available from Teams will be checked again automatically/)).toBeInTheDocument();
  });

  const failedJob = (issues: SessionSyncJob['issues'], filesReady = 17, totalFiles = 18): SessionSyncJob => ({
    live_session_id: 'S1', state: 'failed', finished_at: '2026-10-20T09:01:00Z',
    last_error: 'Could not archive recording ART-404 during downloading (HTTPStatusError, HTTP 404). Check worker logs and access.',
    issues, progress: { filesReady, totalFiles, transfer: null },
  });
  const issue = (overrides: Partial<NonNullable<SessionSyncJob['issues']>[number]>) => ({
    category: 'not_found' as const, fileType: 'recording' as const, artifactId: 'ART-404', sessionNumber: 3,
    httpStatus: 404, stage: 'downloading', errorType: 'HTTPStatusError', occurredAt: '2026-10-20T09:00:00Z',
    detail: 'Could not archive recording ART-404 during downloading (HTTPStatusError, HTTP 404). Check worker logs and access.',
    ...overrides,
  });

  it('explains a missing recording as possible causes with next steps and partial counts', () => {
    render(<SessionSyncStatus job={failedJob([issue({ week: { number: 3, title: 'Programme governance' }, sessionTitle: 'Week 03 | Join the LIVE session' })])} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sync partly completed');
    expect(alert).toHaveTextContent('Sync status: 17 of 18 files saved. 1 recording requires attention.');
    expect(alert).toHaveTextContent('Files already saved are kept and are not downloaded again.');
    expect(screen.getByText('Recording could not be saved · Week 03 | Join the LIVE session (Session 3, Week 3: Programme governance)')).toBeInTheDocument();
    expect(screen.getByText('Possible reasons')).toBeInTheDocument();
    expect(alert).toHaveTextContent('may have been deleted, moved, or expired');
    expect(alert).toHaveTextContent('Open the recording in Microsoft Teams or Stream');
    expect(alert).not.toHaveTextContent(/was deleted|has expired/);
    // Diagnostics stay inside the collapsed section, not the main text.
    const details = screen.getByText('Technical details').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('ART-404');
    expect(details).toHaveTextContent('HTTP status404');
    expect(details).toHaveTextContent('Downloading from Microsoft');
    expect(screen.queryByText(/discovered files saved/)).not.toBeInTheDocument();
  });

  it('gives permission guidance for 403 and retry guidance for temporary errors, without unrelated reasons', () => {
    const { rerender } = render(<SessionSyncStatus job={failedJob([issue({ category: 'access_denied', httpStatus: 403 })])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft denied access to the recording');
    expect(screen.getByRole('alert')).toHaveTextContent('Syncing again will not help until access is fixed.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('deleted, moved');
    rerender(<SessionSyncStatus job={failedJob([issue({ category: 'rate_limited', httpStatus: 429 })])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft is limiting requests');
    expect(screen.getByRole('alert')).toHaveTextContent('Wait a while, then press Sync attendance & files');
    expect(screen.queryByText('Possible reasons')).not.toBeInTheDocument();
    rerender(<SessionSyncStatus job={failedJob([issue({ category: 'service_unavailable', httpStatus: 503 })])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft Teams had a temporary problem');
    rerender(<SessionSyncStatus job={failedJob([issue({ category: 'storage', stage: 'uploading', httpStatus: null, errorType: 'ServiceResponseError' })])} />);
    expect(screen.getByRole('alert')).toHaveTextContent('was retrieved from Microsoft Teams, but the LMS could not save it');
  });

  it('groups files with the same problem and distinguishes complete failure', () => {
    render(<SessionSyncStatus job={failedJob([
      issue({}), issue({ artifactId: 'ART-5', sessionNumber: 5, week: { number: 5, title: 'Week 05: Benefits' } }),
      issue({ category: 'network', fileType: 'transcript', artifactId: 'T-2', sessionNumber: 2, httpStatus: null, errorType: 'ReadTimeout' }),
    ], 0, 3)} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Sync could not save any files');
    expect(alert).toHaveTextContent('0 of 3 files saved. 2 recordings and 1 transcript require attention.');
    // No linked week for session 3: it is left out, never guessed.
    expect(screen.getByText('Recording could not be saved · Session 3; Session 5 (Week 05: Benefits)')).toBeInTheDocument();
    expect(screen.getByText('The transcript download did not finish · Session 2')).toBeInTheDocument();
  });

  it('shows no failure once a later sync completes', () => {
    render(<SessionSyncStatus job={{ ...failedJob([]), state: 'complete', last_error: '' }} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('17 of 18 discovered files saved')).toBeInTheDocument();
  });
});
