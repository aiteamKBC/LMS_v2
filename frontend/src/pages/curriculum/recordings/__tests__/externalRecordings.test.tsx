import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { learningFetch } from '@/lib/personalLearning';
import ExternalRecordings from '../components/ExternalRecordings';
import CalendarMatchesPanel from '../components/CalendarMatchesPanel';

vi.mock('@/lib/personalLearning', () => ({ learningFetch: vi.fn() }));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
describe('Recordings without an LMS link', () => {
  beforeEach(() => vi.mocked(learningFetch).mockReset());

  it('checks on demand and downloads through the authenticated local endpoint', async () => {
    vi.mocked(learningFetch).mockResolvedValue(response({ recordings: [{ id: 'R/1&2', startsAt: '2026-10-15T08:00:00Z', endsAt: '2026-10-15T10:00:00Z' }] }));
    render(<ExternalRecordings reference="signed&reference" />);
    expect(learningFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check recordings' }));
    const link = await screen.findByRole('link', { name: 'Download Teams recording 1' });
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/curriculum_api/curriculum/session-recordings/external-recordings/');
    expect(url.searchParams.get('reference')).toBe('signed&reference');
    expect(url.searchParams.get('recording')).toBe('R/1&2');
    expect(learningFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
    expect(screen.getByText(/Not matched to LMS/)).toBeInTheDocument();
  });

  it('reports no recording without fabricating a download', async () => {
    vi.mocked(learningFetch).mockResolvedValue(response({ recordings: [] }));
    render(<ExternalRecordings reference="ref" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check recordings' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No recording is available');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows permission failure and supports retry', async () => {
    vi.mocked(learningFetch).mockResolvedValueOnce(response({ error: 'Microsoft denied recording access' }, 503))
      .mockResolvedValueOnce(response({ recordings: [] }));
    render(<ExternalRecordings reference="ref" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check recordings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft denied recording access');
    fireEvent.click(screen.getByRole('button', { name: 'Check recordings' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No recording is available');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('aborts stale requests when the calendar event changes', async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(learningFetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockResolvedValue(response({ recordings: [] }));
    const { rerender } = render(<ExternalRecordings reference="old" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check recordings' }));
    const signal = vi.mocked(learningFetch).mock.calls[0][1]?.signal;
    rerender(<ExternalRecordings reference="new" />);
    expect(signal?.aborted).toBe(true);
    resolve(response({ recordings: [{ id: 'STALE' }] }));
    await screen.findByRole('status');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers recording access alongside the unmatched calendar event and its date', async () => {
    vi.mocked(learningFetch).mockResolvedValue(response({ recordings: [] }));
    render(<CalendarMatchesPanel error="" onChoose={vi.fn()} onRetry={vi.fn()} data={{
      status: 'verified', start: '2026-10-15', end: '2026-10-15', timeZone: 'Africa/Cairo', mailbox: 'calendar@example.invalid',
      accounts: ['calendar@example.invalid'], matched: [], unmatched: [{ title: 'Portfolio', date: '2026-10-15', startTime: '11:00', endTime: '13:00', cancelled: false,
        reason: 'This Teams meeting is not linked to an LMS module.', recordingsReference: 'signed-reference' }],
    }} />);
    fireEvent.click(screen.getByText('Calendar events not matched to LMS (1)'));
    expect(screen.getByText('Portfolio')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check recordings' }));
    await waitFor(() => expect(learningFetch).toHaveBeenCalledTimes(1));
    await screen.findByRole('status');
  });
});
