import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransferProgress } from './TransferProgress';
import * as api from '@/api/progressTransfer';

vi.mock('@/api/progressTransfer', () => ({ getTransferPreview: vi.fn(), submitTransferRequest: vi.fn() }));
const eligible = [{ courseRef: 'legacy:50', moduleId: 'M1', oldTitle: 'Original module', newTitle: 'Current module' },
  { courseRef: 'legacy:51', moduleId: 'M2', oldTitle: 'Original second', newTitle: 'Current second' }];
const pending: api.ProgressTransferRequest = { requestId: 'R1', status: 'pending', requestedAt: '2026-10-19T09:00:00Z', approvedAt: null,
  modules: eligible.map(item => ({ ...item, percent: 40, hours: 2 })) };
afterEach(() => vi.resetAllMocks());

describe('Transfer Progress', () => {
  it('shows a merge confirmation only for approved transfers', async () => {
    vi.mocked(api.getTransferPreview).mockResolvedValue({ eligible: [], requests: [{ ...pending, status: 'approved' }], csrfToken: 'csrf' });
    render(<TransferProgress kind="commercial" learnerId="7" onRequested={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Progress' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Progress merged.'));
    expect(screen.getByRole('status')).toHaveTextContent('once per component');
    expect(api.submitTransferRequest).not.toHaveBeenCalled();
  });
  it('identifies a rehearsal before the learner confirms it', async () => {
    vi.mocked(api.getTransferPreview).mockResolvedValue({ eligible: [{ ...eligible[0], demoProgress: true }], requests: [], csrfToken: 'csrf' });
    render(<TransferProgress kind="commercial" learnerId="7" onRequested={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Progress' }));
    expect(await screen.findByText(/Demo progress/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    expect(api.submitTransferRequest).not.toHaveBeenCalled();
  });

  it.each(['commercial', 'apprenticeship'] as const)('explains the freeze and confirms all eligible modules for %s', async kind => {
    vi.mocked(api.getTransferPreview).mockResolvedValue({ eligible, requests: [], csrfToken: 'csrf' });
    let finish!: (value: api.ProgressTransferRequest) => void;
    vi.mocked(api.submitTransferRequest).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const refresh = vi.fn();
    render(<TransferProgress kind={kind} learnerId="7" onRequested={refresh} />);
    expect(api.getTransferPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Progress' }));
    expect(await screen.findByText('All 2 eligible modules')).toBeVisible();
    expect(screen.getByText(/From that moment, additional progress/)).toBeVisible();
    expect(screen.getByText(/matching activities already completed in the old LMS stay completed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(api.submitTransferRequest).toHaveBeenCalledWith(kind, '7', 'csrf');
    expect(refresh).not.toHaveBeenCalled();
    finish(pending);
    expect(await screen.findByText(/Request submitted. Awaiting administrator approval/)).toBeVisible();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('keeps the dialog open on failure and allows a safe retry', async () => {
    vi.mocked(api.getTransferPreview).mockResolvedValue({ eligible, requests: [], csrfToken: 'csrf' });
    vi.mocked(api.submitTransferRequest).mockRejectedValueOnce(new Error('Please try again.')).mockResolvedValue(pending);
    const refresh = vi.fn();
    render(<TransferProgress kind="commercial" learnerId="7" onRequested={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('shows an existing pending request without allowing another submission', async () => {
    vi.mocked(api.getTransferPreview).mockResolvedValue({ eligible: [], requests: [pending], csrfToken: 'csrf' });
    render(<TransferProgress kind="commercial" learnerId="7" onRequested={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Progress' }));
    expect(await screen.findByText(/Awaiting administrator approval/)).toBeVisible();
    expect(screen.queryByText(/Progress merged/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(api.submitTransferRequest).not.toHaveBeenCalled();
  });

  it('reports a preview error and closes with Escape without submitting', async () => {
    vi.mocked(api.getTransferPreview).mockRejectedValue(new Error('Unavailable'));
    render(<TransferProgress kind="commercial" learnerId="7" onRequested={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Progress' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.submitTransferRequest).not.toHaveBeenCalled();
  });
});
