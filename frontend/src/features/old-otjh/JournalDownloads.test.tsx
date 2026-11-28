import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JournalDownloads } from './JournalDownloads';
import { downloadJournal } from './downloadJournal';
import type { Summary } from './api';

vi.mock('./downloadJournal', () => ({ downloadJournal: vi.fn() }));
const summary = { learner: { id: 1, aptem_id: 42, name: 'Learner' }, months: [{ month: '2026-07' }, { month: '2026-08' }] } as Summary;
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('journal download controls', () => {
  it('downloads the open month and keeps both buttons disabled during preparation', async () => {
    let finish!: () => void;
    vi.mocked(downloadJournal).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<JournalDownloads summary={summary} month="2026-08" aptemId={42} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(screen.getByRole('button', { name: 'Preparing PDF…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download all months' })).toBeDisabled();
    expect(downloadJournal).toHaveBeenCalledWith(expect.objectContaining({ aptemId: 42, months: ['2026-08'] }));
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled());
  });
  it('includes every available month in the all-month request', async () => {
    vi.mocked(downloadJournal).mockResolvedValue();
    render(<JournalDownloads summary={summary} month="2026-08" disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download all months' }));
    await screen.findByText('Your PDF is ready.');
    expect(downloadJournal).toHaveBeenCalledWith(expect.objectContaining({ months: ['2026-07', '2026-08'] }));
  });
  it('shows download failures and lets the user retry', async () => {
    vi.mocked(downloadJournal).mockRejectedValueOnce(new Error('A saved signature could not be loaded.')).mockResolvedValue();
    render(<JournalDownloads summary={summary} month="2026-08" disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A saved signature could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await screen.findByText('Your PDF is ready.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('cancels an outstanding export when the report is unmounted', () => {
    vi.mocked(downloadJournal).mockImplementation(() => new Promise(() => {}));
    const view = render(<JournalDownloads summary={summary} month="2026-08" disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    const signal = vi.mocked(downloadJournal).mock.calls[0][0].signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
