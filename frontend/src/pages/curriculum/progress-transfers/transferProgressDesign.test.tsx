import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/progressTransfer';
import { TransferRequests } from './page';

vi.mock('@/api/progressTransfer', () => ({ getTransferRequests: vi.fn(), approveTransferRequest: vi.fn() }));

const module = (id = 'M1', percent = 40, hours = 2): api.TransferModule => ({ courseRef: `legacy:${id}`, moduleId: id, oldTitle: `Old ${id}`, newTitle: `New ${id}`, percent, hours });
const request = (id = 'R1', changes: Partial<api.AdminTransfer> = {}): api.AdminTransfer => ({ requestId: id, learnerId: '7', learnerKind: 'commercial', learnerName: 'Same learner', programme: 'Programme A', status: 'pending', requestedAt: '2026-10-19T09:00:00Z', approvedAt: null, modules: [module()], ...changes });
const approved = (id = 'A1', changes: Partial<api.AdminTransfer> = {}) => request(id, { status: 'approved', approvedAt: '2026-10-20T12:00:00Z', ...changes });
const response = (requests: api.AdminTransfer[], nextOffset: number | null = null, csrfToken = 'csrf'): api.AdminTransfers => ({ requests, nextOffset, csrfToken });
const card = (id = 'R1') => within(screen.getByRole('article', { name: `Request ${id} for Same learner` }));
const show = () => render(<MemoryRouter><TransferRequests /></MemoryRouter>);
const pendingSection = () => within(screen.getByRole('region', { name: 'Pending transfer requests' }));
const history = () => within(screen.getByRole('table'));
const metric = (name: string) => within(screen.getByRole('article', { name }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

afterEach(() => vi.resetAllMocks());

describe('Transfer Progress design and supported operations', () => {
  it('keeps separate request identities, counts full module snapshots and preserves the newest-first service order', async () => {
    const full = request('R2', { modules: [module('M1', 100, 1), module('M2', 40, 2), module('M3', 0, 20)] });
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([full, request('R1')], 50));
    show();
    await screen.findByRole('article', { name: 'Request R2 for Same learner' });
    expect(pendingSection().getAllByRole('article').map(el => el.getAttribute('aria-label'))).toEqual(['Request R2 for Same learner', 'Request R1 for Same learner']);
    expect(metric('Waiting for you').getByText('2')).toBeVisible();
    expect(card('R2').getByText('23h')).toBeVisible();
    expect(card('R2').getByText('+1 more in this request')).toBeVisible();
    expect(card('R2').queryByText('Old M3')).not.toBeInTheDocument();
    expect(card('R2').getByRole('progressbar', { name: 'Saved progress for Old M1' })).toHaveAttribute('aria-valuenow', '100');
    expect(card('R2').getByRole('progressbar', { name: 'Saved progress for Old M2' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText(/counters are not full-list totals/)).toBeVisible();
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('opens the exact request and all saved source/target identities without loading or deciding another record', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request('R1'), request('R2', { learnerId: '8', learnerKind: 'apprenticeship', modules: [module('M2', 100, 12), module('M3', 40, 3), module('M4', 0, 0)] })]));
    show();
    fireEvent.click(await within(await screen.findByRole('article', { name: 'Request R2 for Same learner' })).findByRole('button', { name: 'Review details' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('R2')).toBeVisible();expect(dialog.getByText('8')).toBeVisible();expect(dialog.getByText('Apprenticeship')).toBeVisible();
    expect(dialog.getByText('Old LMS · legacy:M4')).toBeVisible();expect(dialog.getByText('New LMS · M4')).toBeVisible();
    expect(dialog.getByText('100% saved progress')).toBeVisible();expect(dialog.getByText('40% saved progress')).toBeVisible();expect(dialog.getByText('0% saved progress')).toBeVisible();
    expect(api.getTransferRequests).toHaveBeenCalledTimes(1);expect(api.approveTransferRequest).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves demo-progress warnings on both the preview and the full review', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request('R1', { modules: [{ ...module(), demoProgress: true }] })]));
    show();expect(await screen.findByText('Demo progress')).toBeVisible();fireEvent.click(card().getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('Demo progress')).toBeVisible();
  });

  it('distinguishes initial loading, a real empty list and unavailable data', async () => {
    const read = deferred<api.AdminTransfers>();vi.mocked(api.getTransferRequests).mockReturnValue(read.promise);show();
    expect(metric('Waiting for you').getByText('Loading…')).toBeVisible();expect(screen.queryByText('No requests waiting for approval.')).not.toBeInTheDocument();
    await act(async () => read.resolve(response([])));
    expect(metric('Waiting for you').getByText('0')).toBeVisible();expect(screen.getByText('No requests waiting for approval.')).toBeVisible();expect(metric('Hours carried over').getByText('0h')).toBeVisible();
  });

  it('shows an initial read failure and retries without fabricating empty totals', async () => {
    vi.mocked(api.getTransferRequests).mockRejectedValueOnce(new Error('Request list unavailable')).mockResolvedValue(response([request()]));show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Request list unavailable');expect(metric('Waiting for you').getByText('Unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));await screen.findByRole('article', { name: 'Request R1 for Same learner' });expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('does not display missing or invalid hour/progress values as real zeros', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request('R1', { modules: [module('M1', Number.NaN, Number.NaN)] })]));show();
    await screen.findByRole('article', { name: 'Request R1 for Same learner' });expect(card().getAllByText('Unavailable').length).toBeGreaterThan(0);expect(card().queryByRole('progressbar')).not.toBeInTheDocument();expect(card().queryByText('0h')).not.toBeInTheDocument();
  });

  it('loads the next offset on demand and reconciles duplicate IDs without merging different requests by learner', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request('R1'), approved('A1')], 50)).mockResolvedValueOnce(response([request('R1'), request('R2'), approved('A2')]));show();
    await screen.findByRole('article', { name: 'Request R1 for Same learner' });expect(api.getTransferRequests).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }));await screen.findByRole('article', { name: 'Request R2 for Same learner' });
    expect(api.getTransferRequests).toHaveBeenLastCalledWith(50, expect.any(AbortSignal));expect(pendingSection().getAllByRole('article')).toHaveLength(2);expect(history().getAllByRole('row')).toHaveLength(3);expect(metric('Approved').getByText('2')).toBeVisible();
  });

  it('retains existing results on a next-page failure and safely retries the same offset', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request()], 50)).mockRejectedValueOnce(new Error('Next page unavailable')).mockResolvedValueOnce(response([request('R2')]));show();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more requests' }));expect(await screen.findByRole('alert')).toHaveTextContent('Next page unavailable');expect(card().getByText('Same learner')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }));await screen.findByRole('article', { name: 'Request R2 for Same learner' });expect(api.getTransferRequests).toHaveBeenLastCalledWith(50, expect.any(AbortSignal));
  });

  it('searches and filters only loaded history, preserves counts and resets without writes', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request(), approved('A1'), approved('A2', { programme: 'Programme B' })], 50));show();
    await screen.findByText('2 of 2 loaded decisions · More requests may be available');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search loaded history' }), { target: { value: 'A2' } });expect(history().getAllByRole('row')).toHaveLength(2);expect(history().getByText('Request A2')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Programme name' }), { target: { value: 'Programme A' } });expect(history().getByText('No loaded decisions match these filters.')).toBeVisible();
    expect(card().getByText('Same learner')).toBeVisible();expect(metric('Approved').getByText('2')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));expect(history().getAllByRole('row')).toHaveLength(3);expect(api.getTransferRequests).toHaveBeenCalledTimes(1);expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('opens immutable approved module snapshots with their recorded decision date and no approval action', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([approved('A1', { modules: [module('SNAPSHOT', 87, 17.5)] })]));show();
    fireEvent.click(await screen.findByRole('button', { name: 'Details for request A1' }));const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Old SNAPSHOT')).toBeVisible();expect(dialog.getByText('17h 30m')).toBeVisible();expect(dialog.getByText('87% saved progress')).toBeVisible();
    expect(dialog.getByText(/20 Oct 2026/)).toBeVisible();expect(dialog.queryByRole('button', { name: 'Approve transfer' })).not.toBeInTheDocument();expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('does not invent export, decline, overlap deductions or programme versions', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()]));show();await screen.findByRole('article', { name: 'Request R1 for Same learner' });
    expect(screen.getByRole('button', { name: 'Export log' })).toBeDisabled();expect(screen.getByRole('tab', { name: 'Declined' })).toBeDisabled();expect(metric('Declined').getByText('Unavailable')).toBeVisible();
    fireEvent.click(card().getByRole('button', { name: 'Review details' }));const dialog = within(screen.getByRole('dialog'));expect(dialog.getByRole('button', { name: 'Decline unavailable' })).toBeDisabled();expect(dialog.getByText(/Withheld hours and overlapping weeks are not provided/)).toBeVisible();expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('keeps card approval as a review step and prevents duplicate submissions while the service is working', async () => {
    const post = deferred<api.ProgressTransferRequest>();vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()]));vi.mocked(api.approveTransferRequest).mockReturnValue(post.promise);show();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve transfer' }));expect(api.approveTransferRequest).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('dialog'));const confirm = dialog.getByRole('button', { name: 'Approve transfer' });fireEvent.click(confirm);fireEvent.click(confirm);
    expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R1', 'csrf');expect(dialog.getByRole('button', { name: 'Transferring…' })).toBeDisabled();expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => post.resolve(approved('R1')));await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refreshes from offset zero after approval rather than continuing a reordered page', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request()], 50)).mockResolvedValueOnce(response([approved('A1')]));vi.mocked(api.approveTransferRequest).mockResolvedValue(approved('R1'));show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' }));
    await screen.findByText('Transfer approved. The learner can now open the new modules.');await waitFor(() => expect(api.getTransferRequests).toHaveBeenCalledTimes(2));expect(api.getTransferRequests).toHaveBeenLastCalledWith(0, expect.any(AbortSignal));
  });

  it('keeps a committed approval truthful if the reconciliation read fails, then unlocks after a fresh read', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request(), request('R2')], 50)).mockRejectedValueOnce(new Error('Refresh unavailable')).mockResolvedValueOnce(response([request('R2'), approved('R1')]));vi.mocked(api.approveTransferRequest).mockResolvedValue(approved('R1'));show();
    fireEvent.click(await within(await screen.findByRole('article', { name: 'Request R1 for Same learner' })).findByRole('button', { name: 'Review details' }));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' }));
    expect(await screen.findByText('Transfer approved. The learner can now open the new modules.')).toBeVisible();expect(await screen.findByRole('alert')).toHaveTextContent('Refresh unavailable');await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(card('R2').getByRole('button', { name: 'Approve transfer' })).toBeDisabled();expect(screen.getByRole('button', { name: 'Load more requests' })).toBeDisabled();expect(metric('Approved').getByText('1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));await waitFor(() => expect(card('R2').getByRole('button', { name: 'Approve transfer' })).toBeEnabled());expect(api.approveTransferRequest).toHaveBeenCalledTimes(1);
  });

  it('shows a server mapping conflict and retries without any client progress writes', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()]));vi.mocked(api.approveTransferRequest).mockRejectedValueOnce(new Error('A module assignment or course mapping changed. Review it before approving this request.')).mockResolvedValue(approved('R1'));show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('mapping changed');expect(api.getTransferRequests).toHaveBeenCalledTimes(1);expect(card().getByText('Same learner')).toBeVisible();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' }));await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.approveTransferRequest).mock.calls.every(args => args.length === 2 && args[0] === 'R1' && args[1] === 'csrf')).toBe(true);
  });

  it('accepts the authoritative approved result when another administrator already decided the request', async () => {
    const decided = approved('R1');vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request()])).mockResolvedValueOnce(response([decided]));vi.mocked(api.approveTransferRequest).mockResolvedValue(decided);show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(history().getByText('Request R1')).toBeVisible();expect(pendingSection().queryByRole('article')).not.toBeInTheDocument();
  });

  it('does not confirm the wrong request response or pretend an unconfirmed operation succeeded', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()]));vi.mocked(api.approveTransferRequest).mockResolvedValue(approved('WRONG'));show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review details' }));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The service did not confirm this request');expect(screen.queryByText('Transfer approved. The learner can now open the new modules.')).not.toBeInTheDocument();
  });

  it('requires a CSRF-bearing list before approval while still allowing read-only details', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()], null, ''));show();await screen.findByRole('article', { name: 'Request R1 for Same learner' });expect(card().getByRole('button', { name: 'Approve transfer' })).toBeDisabled();
    fireEvent.click(card().getByRole('button', { name: 'Review details' }));expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve transfer' })).toBeDisabled();expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('dismisses a read-only review with Escape and restores the review trigger', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()]));show();const review = await screen.findByRole('button', { name: 'Review details' });review.focus();fireEvent.click(review);
    await userEvent.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(review).toHaveFocus();expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('aborts an outstanding read on unmount and ignores its eventual response', async () => {
    const read = deferred<api.AdminTransfers>();vi.mocked(api.getTransferRequests).mockReturnValue(read.promise);const view = show();const signal = vi.mocked(api.getTransferRequests).mock.calls[0][1]!;
    view.unmount();expect(signal.aborted).toBe(true);await act(async () => read.resolve(response([request()])));expect(screen.queryByRole('article')).not.toBeInTheDocument();expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });
});
