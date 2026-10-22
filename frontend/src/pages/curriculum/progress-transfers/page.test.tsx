import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/progressTransfer';
import ProgressTransfersPage, { TransferRequests } from './page';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: auth } }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/api/progressTransfer', () => ({ getTransferRequests: vi.fn(), getTransferReview: vi.fn(), approveTransferRequest: vi.fn() }));
const request: api.AdminTransfer = { requestId: 'R1', learnerId: '7', learnerKind: 'commercial', learnerName: 'Synthetic learner', programme: 'Programme',
  status: 'pending', requestedAt: '2026-10-19T09:00:00Z', approvedAt: null,
  modules: [{ courseRef: 'legacy:50', moduleId: 'M1', oldTitle: 'Original module', newTitle: 'New module', percent: 40, hours: 2 }] };
const pendingRequests = () => within(screen.getByRole('region', { name: 'Pending transfer requests' }));
const history = () => within(screen.getByRole('table'));
const dialog = () => within(screen.getByRole('dialog'));
afterEach(() => { vi.resetAllMocks(); auth.role = 'admin'; });
beforeEach(() => { vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [] }); });

describe('admin progress transfers', () => {
  it('requires review then approval, and reloads only after success', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce({ requests: [request], nextOffset: null, csrfToken: 'csrf' })
      .mockResolvedValue({ requests: [{ ...request, status: 'approved', approvedAt: '2026-10-19T10:00:00Z' }], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockResolvedValue({ ...request, status: 'approved' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByText('40% saved')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    expect(dialog().getByText('Original module')).toBeVisible();
    expect(dialog().getByText('New module')).toBeVisible();
    expect(dialog().getByText('40% saved progress')).toBeVisible();
    const approve = dialog().getByRole('button', { name: 'Approve transfer' });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    expect(await screen.findByText(/Transfer approved. The learner/)).toBeVisible();
    expect(await history().findByText('Approved')).toBeVisible();
    expect(pendingRequests().queryByText('Synthetic learner')).not.toBeInTheDocument();
    expect(screen.getByText('No requests waiting for approval.')).toBeVisible();
    expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R1', 'csrf', { reviewToken: 'review', mappings: [] });
  });

  it('keeps the request pending on approval failure', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Mapping changed.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));
    const approve = dialog().getByRole('button', { name: 'Approve transfer' });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    expect(await screen.findByRole('alert')).toHaveTextContent('Mapping changed.');
    expect(dialog().getByText('Awaiting decision')).toBeVisible();
    expect(screen.queryByText(/Transfer approved/)).not.toBeInTheDocument();
  });

  it('separates pending and approved requests and opens approved details without an approval action', async () => {
    const approved: api.AdminTransfer = {
      ...request, requestId: 'R2', learnerName: 'Approved learner', status: 'approved', approvedAt: '2026-10-20T10:00:00Z',
      modules: [...request.modules, { ...request.modules[0], courseRef: 'legacy:51', oldTitle: 'Second original', newTitle: 'Second current', demoProgress: true,
        componentMatches: [{ sourceActivityRef: 'material:7', sourceTitle: 'Original reading', targetComponentId: 'A', targetTitle: 'New reading A', manual: true, plannedHours: 1.5 }] }],
    };
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [approved, request], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await pendingRequests().findByText('Synthetic learner')).toBeVisible();
    expect(pendingRequests().queryByText('Approved learner')).not.toBeInTheDocument();
    expect(history().getByText('Approved learner')).toBeVisible();
    expect(history().queryByText('Synthetic learner')).not.toBeInTheDocument();
    expect(history().getByText('2 modules')).toBeVisible();
    expect(history().queryByRole('button', { name: 'Review details' })).not.toBeInTheDocument();
    fireEvent.click(history().getByRole('button', { name: 'Details for request R2' }));
    expect(dialog().getByText('Second original')).toBeVisible();
    // Named in the module list and again over its approved component matches.
    expect(dialog().getAllByText('Second current')).toHaveLength(2);
    expect(dialog().getByText('Demo progress')).toBeVisible();
    expect(dialog().getByText('Hours carried over')).toBeVisible();
    const matches = within(dialog().getByRole('region', { name: 'Approved component matches' }));
    expect(matches.getByText('New reading A')).toBeVisible();
    expect(matches.getByText('Manual match')).toBeVisible();
    expect(matches.getByText(/New component planned hours: 1h 30m/)).toHaveTextContent('Actual transferred hours are unchanged.');
    expect(dialog().queryByRole('button', { name: 'Approve transfer' })).not.toBeInTheDocument();
    expect(api.getTransferReview).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByText('Close', { selector: 'button' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('keeps both sections and useful empty states when there are no requests', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByText('No requests waiting for approval.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Pending transfer requests' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Transfer history' })).toBeVisible();
    expect(history().getByText('No approved decisions in the loaded requests.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review details' })).not.toBeInTheDocument();
  });

  it('groups later pages without losing or duplicating loaded requests', async () => {
    const approved = { ...request, requestId: 'R2', learnerName: 'Approved learner', status: 'approved' as const, approvedAt: '2026-10-20T10:00:00Z' };
    vi.mocked(api.getTransferRequests)
      .mockResolvedValueOnce({ requests: [request], nextOffset: 20, csrfToken: 'csrf' })
      .mockResolvedValueOnce({ requests: [request, approved], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more requests' }));
    expect(await history().findByText('Approved learner')).toBeVisible();
    expect(pendingRequests().getAllByText('Synthetic learner')).toHaveLength(1);
    expect(history().getAllByText('Approved learner')).toHaveLength(1);
    expect(api.getTransferRequests).toHaveBeenLastCalledWith(20, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: 'Load more requests' })).not.toBeInTheDocument();
  });

  it('shows a failed initial load without suggesting there are no requests', async () => {
    vi.mocked(api.getTransferRequests).mockRejectedValue(new Error('Requests unavailable.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Requests unavailable.');
    expect(screen.queryByText('No requests waiting for approval.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it.each(['learner', 'staff', 'employer'])('does not load admin data for %s', role => {
    auth.role = role;
    render(<MemoryRouter><ProgressTransfersPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Only administrators');
    expect(api.getTransferRequests).not.toHaveBeenCalled();
    expect(api.getTransferReview).not.toHaveBeenCalled();
  });

  it('requires every manual match, prevents duplicate destinations and shows planned hours without changing actual credit', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'scoped-review', csrfToken: 'review-csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [
        { sourceActivityRef: 'material:7', title: 'Original reading', type: 'reading', week: 'Week 1', automaticTargetId: null },
        { sourceActivityRef: 'material:8', title: 'Another reading', type: 'reading', week: 'Week 2', automaticTargetId: null },
        { sourceActivityRef: 'material:9', title: 'Automatic reading', type: 'reading', week: 'Week 3', automaticTargetId: 'AUTO' },
      ], targets: ['A', 'B', 'AUTO'].map(componentId => ({ componentId, title: `New reading ${componentId}`, type: 'reading', week: 'Week 1', plannedHours: 1.5 })),
    }] });
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Component matches changed.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));
    expect(await screen.findByText(/2 completed old components have no automatic match/)).toBeVisible();
    const confirm = dialog().getByRole('button', { name: 'Approve transfer' });
    expect(confirm).toBeDisabled();
    const first = screen.getByRole('combobox', { name: 'Match Original reading (material:7) in New module' });
    const second = screen.getByRole('combobox', { name: 'Match Another reading (material:8) in New module' });
    expect(within(first).getByRole('option', { name: /New reading AUTO/ })).toBeDisabled();
    fireEvent.change(first, { target: { value: 'A' } });
    expect(within(second).getByRole('option', { name: /New reading A \(/ })).toBeDisabled();
    expect(screen.getByText(/New component planned hours: 1h 30m/)).toHaveTextContent('Actual transferred hours are unchanged.');
    expect(confirm).toBeDisabled();
    fireEvent.change(second, { target: { value: 'B' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('Component matches changed.');
    expect(first).toHaveValue('A');
    expect(api.approveTransferRequest).toHaveBeenCalledWith('R1', 'review-csrf', { reviewToken: 'scoped-review', mappings: [
      { moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'A' },
      { moduleId: 'M1', sourceActivityRef: 'material:8', targetComponentId: 'B' },
    ] });
  });

  it('keeps approval disabled if matching cannot load and permits a retry', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockRejectedValueOnce(new Error('Matching unavailable.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Matching unavailable.');
    expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry matching' }));
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeEnabled());
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });
});
