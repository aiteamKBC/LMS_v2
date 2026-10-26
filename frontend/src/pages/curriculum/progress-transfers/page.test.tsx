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
afterEach(() => { vi.resetAllMocks(); auth.role = 'admin'; });
beforeEach(() => { vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [] }); });

describe('admin progress transfers', () => {
  it('distinguishes missing source text from unavailable target content', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [{ sourceActivityRef: 'material:7', title: 'Old quiz', type: 'quiz', week: '', automaticTargetId: null,
        contentAvailable: false, contentScores: [{ componentId: 'A', score: null, contentAvailable: true }, { componentId: 'B', score: null, contentAvailable: false }] }],
      targets: ['A', 'B'].map(componentId => ({ componentId, title: `Quiz ${componentId}`, type: 'quiz', week: '', plannedHours: null })),
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const select = await screen.findByRole('combobox');
    expect(screen.getByText(/Source content is unavailable for comparison/)).toBeVisible();
    expect(within(select).getByRole('option', { name: /Quiz A/ })).not.toHaveTextContent('unavailable');
    expect(within(select).getByRole('option', { name: /Quiz B/ })).toHaveTextContent('Target content unavailable');
    expect(within(select).queryByRole('option', { name: /^Recommended/ })).not.toBeInTheDocument();
  });

  it('suggests within each module without selecting or approving, and updates reserved options', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    const title = 'Project Fundamentals and Value Delivery';
    vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [{
      moduleId: 'M1', courseRef: 'legacy:50', title: 'New module',
      sources: [7, 8].map(id => ({ sourceActivityRef: `material:${id}`, title, type: 'quiz', week: '', automaticTargetId: null, contentAvailable: true, contentScores: [{ componentId: 'A', score: 0.95 }, { componentId: 'B', score: 0.1 }] })),
      targets: [
        { componentId: 'B', title: 'Programme overview', type: 'quiz', week: '', plannedHours: null },
        { componentId: 'A', title, type: 'quiz', week: '', plannedHours: null },
        { componentId: 'WRONG', title, type: 'reading', week: '', plannedHours: null },
      ],
    }, {
      moduleId: 'M2', courseRef: 'legacy:51', title: 'Other module', sources: [],
      targets: [{ componentId: 'OTHER', title, type: 'quiz', week: '', plannedHours: null }],
    }] });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    const first = await screen.findByRole('combobox', { name: `Match ${title} (material:7) in New module` });
    const second = screen.getByRole('combobox', { name: `Match ${title} (material:8) in New module` });
    expect(within(first).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', 'A', 'B']);
    expect(within(first).getByRole('option', { name: /^Recommended/ })).toHaveValue('A');
    expect(first).toHaveValue('');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    fireEvent.change(first, { target: { value: 'A' } });
    expect(first).toHaveValue('A');
    expect(second).toHaveValue('');
    expect(within(second).queryByRole('option', { name: /^Recommended/ })).not.toBeInTheDocument();
    expect(within(second).getByRole('option', { name: /\(quiz · A\)/ })).toBeDisabled();
    fireEvent.change(first, { target: { value: '' } });
    expect(within(second).getByRole('option', { name: /^Recommended/ })).toHaveValue('A');
  });

  it('requires review then Confirm, and reloads only after success', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce({ requests: [request], nextOffset: null, csrfToken: 'csrf' })
      .mockResolvedValue({ requests: [{ ...request, status: 'approved', approvedAt: '2026-10-19T10:00:00Z' }], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockResolvedValue({ ...request, status: 'approved' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByText('Synthetic learner')).toBeVisible();
    const pending = within(screen.getByRole('table', { name: 'Pending requests' }));
    expect(pending.getByText('Synthetic learner')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Original module')).toBeVisible();
    expect(dialog.getByText('New module')).toBeVisible();
    expect(dialog.getByText('40%')).toBeVisible();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Transfer approved. The learner/)).toBeVisible();
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Approved requests' })).getByText('Synthetic learner')).toBeVisible());
    expect(pending.queryByText('Synthetic learner')).not.toBeInTheDocument();
    expect(screen.getByText('No pending requests')).toBeVisible();
    expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R1', 'csrf', { reviewToken: 'review', mappings: [] });
  });

  it('keeps the request pending on approval failure', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Mapping changed.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeEnabled());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mapping changed.');
    expect(screen.getByText('Pending approval')).toBeVisible();
    expect(screen.queryByText(/Transfer approved/)).not.toBeInTheDocument();
  });

  it('separates pending and approved requests and opens approved details without a Confirm action', async () => {
    const approved: api.AdminTransfer = {
      ...request, requestId: 'R2', learnerName: 'Approved learner', status: 'approved', approvedAt: '2026-10-20T10:00:00Z',
      modules: [...request.modules, { ...request.modules[0], courseRef: 'legacy:51', oldTitle: 'Second original', newTitle: 'Second current', demoProgress: true }],
    };
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [approved, request], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    const pendingTable = within(await screen.findByRole('table', { name: 'Pending requests' }));
    const approvedTable = within(screen.getByRole('table', { name: 'Approved requests' }));
    expect(pendingTable.getByText('Synthetic learner')).toBeVisible();
    expect(pendingTable.queryByText('Approved learner')).not.toBeInTheDocument();
    expect(approvedTable.getByText('Approved learner')).toBeVisible();
    expect(approvedTable.queryByText('Synthetic learner')).not.toBeInTheDocument();
    expect(approvedTable.getByText('2 modules')).toBeVisible();
    expect(approvedTable.getByText('Demo progress')).toBeVisible();
    expect(approvedTable.queryByRole('button', { name: 'Review transfer' })).not.toBeInTheDocument();
    fireEvent.click(approvedTable.getByRole('button', { name: 'View details' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Second original')).toBeVisible();
    expect(dialog.getByText('Second current')).toBeVisible();
    expect(dialog.getByText(/percentages and hours saved at the time of transfer/)).toBeVisible();
    expect(dialog.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByText('Close', { selector: 'button' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('keeps both table headings and useful empty states when there are no requests', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByRole('table', { name: 'Pending requests' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Approved requests' })).toBeVisible();
    expect(screen.getByText('No pending requests')).toBeVisible();
    expect(screen.getByText('No approved requests yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review transfer' })).not.toBeInTheDocument();
  });

  it('groups later pages without losing or duplicating loaded requests', async () => {
    const approved = { ...request, requestId: 'R2', learnerName: 'Approved learner', status: 'approved' as const, approvedAt: '2026-10-20T10:00:00Z' };
    vi.mocked(api.getTransferRequests)
      .mockResolvedValueOnce({ requests: [request], nextOffset: 20, csrfToken: 'csrf' })
      .mockResolvedValueOnce({ requests: [request, approved], nextOffset: null, csrfToken: 'csrf' });
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Approved learner')).toBeVisible();
    expect(within(screen.getByRole('table', { name: 'Pending requests' })).getAllByText('Synthetic learner')).toHaveLength(1);
    expect(within(screen.getByRole('table', { name: 'Approved requests' })).getAllByText('Approved learner')).toHaveLength(1);
    expect(api.getTransferRequests).toHaveBeenLastCalledWith(20);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows a failed initial load without suggesting there are no requests', async () => {
    vi.mocked(api.getTransferRequests).mockRejectedValue(new Error('Requests unavailable.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Requests unavailable.');
    expect(screen.queryByText('No pending requests')).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByText(/2 completed old components have no automatic match/)).toBeVisible();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' });
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

  it('keeps confirmation disabled if matching cannot load and permits a retry', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue({ requests: [request], nextOffset: null, csrfToken: 'csrf' });
    vi.mocked(api.getTransferReview).mockRejectedValueOnce(new Error('Matching unavailable.'));
    render(<MemoryRouter><TransferRequests /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Matching unavailable.');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry matching' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })).toBeEnabled());
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });
});
