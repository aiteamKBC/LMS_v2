import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/progressTransfer';
import ProgressTransfersPage, { TransferRequests } from './page';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: auth } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/api/progressTransfer', () => ({ getTransferRequests: vi.fn(), approveTransferRequest: vi.fn() }));
const request: api.AdminTransfer = { requestId: 'R1', learnerId: '7', learnerKind: 'commercial', learnerName: 'Synthetic learner', programme: 'Programme',
  status: 'pending', requestedAt: '2026-10-19T09:00:00Z', approvedAt: null,
  modules: [{ courseRef: 'legacy:50', moduleId: 'M1', oldTitle: 'Original module', newTitle: 'New module', percent: 40, hours: 2 }] };
afterEach(() => { vi.resetAllMocks(); auth.role = 'admin'; });

describe('admin progress transfers', () => {
  it('requires review then approval, and reloads only after success', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce({ requests: [request], nextOffset: null, csrfToken: 'csrf' })
      .mockResolvedValue({ requests: [{ ...request, status: 'approved', approvedAt: '2026-10-19T10:00:00Z' }], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockResolvedValue({ ...request, status: 'approved' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByText('40% saved')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Original module')).toBeVisible();
    expect(dialog.getByText('New module')).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: 'Approve transfer' }));
    expect(await screen.findByText(/Transfer approved. The learner/)).toBeVisible();
    expect(await within(screen.getByRole('table')).findByText('Approved')).toBeVisible();
    expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R1', 'csrf');
  });

  it('keeps the request pending on approval failure', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Mapping changed.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mapping changed.');
    expect(within(screen.getByRole('dialog')).getByText('Awaiting decision')).toBeVisible();
    expect(screen.queryByText(/Transfer approved/)).not.toBeInTheDocument();
  });

  it.each(['learner', 'staff', 'employer'])('does not load admin data for %s', role => {
    auth.role = role;
    render(<MemoryRouter><ProgressTransfersPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Only administrators');
    expect(api.getTransferRequests).not.toHaveBeenCalled();
  });
});
