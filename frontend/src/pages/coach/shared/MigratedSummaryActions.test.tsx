import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MigratedSummaryActions } from './MigratedSummaryActions';
import { fetchMigratedReviewIntelligence } from '@/api/reviewInstances';

vi.mock('@/api/reviewInstances', () => ({
  fetchMigratedReviewIntelligence: vi.fn(),
  uploadMigratedSummaryTranscript: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const props = {
  instanceId: 'imported-review:synthetic', editable: true, teamsAvailable: true,
  busy: false, unsaved: false, onResult: vi.fn(), onBusyChange: vi.fn(),
};

it('replaces a failed action with authoritative success from another control', async () => {
  vi.mocked(fetchMigratedReviewIntelligence).mockResolvedValue({
    artifacts: [], summaryBinding: { fieldKey: 'recap', generationStatus: 'failed' },
  });
  const { rerender } = render(<MigratedSummaryActions {...props} binding={{ fieldKey: 'recap' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be generated');
  rerender(<MigratedSummaryActions {...props} binding={{
    fieldKey: 'recap', state: 'AI_POPULATED_UNEDITED', status: 'populated', generationStatus: 'ready',
  }} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('AI summary added to the form');
});

it('shows the safe error and support reference after reopening a failed review', () => {
  render(<MigratedSummaryActions {...props} binding={{
    fieldKey: 'recap', generationStatus: 'failed',
    generationError: { code: 'AI_SUMMARY_TIMEOUT', message: 'AI summary generation timed out. Try again.', requestId: 'safe-reference' },
  }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('timed out');
  expect(screen.getByRole('alert')).toHaveTextContent('Reference: safe-reference');
});

it('keeps a new transport failure visible until a newer result arrives', async () => {
  vi.mocked(fetchMigratedReviewIntelligence).mockRejectedValue(new Error('Connection interrupted'));
  const binding = { fieldKey: 'recap', generationStatus: 'ready' as const, generationAttemptedAt: '2026-10-20T08:00:00Z' };
  const { rerender } = render(<MigratedSummaryActions {...props} binding={binding} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
  rerender(<MigratedSummaryActions {...props} binding={{ ...binding }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Connection interrupted');
  rerender(<MigratedSummaryActions {...props} binding={{
    ...binding, generationAttemptedAt: '2026-10-20T08:05:00Z', status: 'populated',
  }} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('gives the latest binding priority over an older intelligence failure', async () => {
  vi.mocked(fetchMigratedReviewIntelligence).mockResolvedValue({
    artifacts: [], summaryBinding: { fieldKey: 'recap', generationStatus: 'ready' },
    intelligence: { attendanceStatus: 'available', recordingStatus: 'unknown', transcriptStatus: 'available',
      summaryStatus: 'failed', errorCodes: [] },
  });
  render(<MigratedSummaryActions {...props} binding={{ fieldKey: 'recap' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate from Teams' }));
  await waitFor(() => expect(props.onResult).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: 'Generate from Teams' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
