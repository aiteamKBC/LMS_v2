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
    expect(screen.getByRole('alert')).toHaveTextContent('Storage unavailable.');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    rerender(<SessionSyncStatus job={{ ...job, state: 'complete' }} />);
    expect(screen.getByRole('progressbar', { name: 'Sync pass complete' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/Files not yet available from Teams will be checked again automatically/)).toBeInTheDocument();
  });
});
