import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/progressTransfer';
import { TransferRequests } from './page';

vi.mock('@/api/progressTransfer', () => ({ getTransferRequests: vi.fn(), getTransferReview: vi.fn(), approveTransferRequest: vi.fn() }));
const module = (id = 'M1', percent = 40, hours = 2): api.TransferModule => ({ courseRef: `legacy:${id}`, moduleId: id, oldTitle: `Old ${id}`, newTitle: `New ${id}`, percent, hours });
const request = (id = 'R1', changes: Partial<api.AdminTransfer> = {}): api.AdminTransfer => ({ requestId: id, learnerId: '7', learnerKind: 'commercial', learnerName: 'Same learner', programme: 'Programme A', status: 'pending', requestedAt: '2026-10-19T09:00:00Z', approvedAt: null, modules: [module()], ...changes });
const approved = (id = 'A1', changes: Partial<api.AdminTransfer> = {}) => request(id, { status: 'approved', approvedAt: '2026-10-20T12:00:00Z', ...changes });
const response = (requests: api.AdminTransfer[], nextOffset: number | null = null, csrfToken = 'csrf'): api.AdminTransfers => ({ requests, nextOffset, csrfToken });
const row = (id = 'R1') => within(screen.getByRole('row', { name: `Request ${id} for Same learner` }));
const pendingTab = () => screen.getByRole('tab', { name: /^Pending/ });
const approvedTab = () => screen.getByRole('tab', { name: /^Approved/ });
const dialog = () => within(screen.getByRole('dialog'));
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
const show = (url = '/users/progress-transfers') => render(<MemoryRouter initialEntries={[url]}><TransferRequests /><Location /></MemoryRouter>);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const decisions = { reviewToken: 'review', mappings: [] };
const openReview = async (id = 'R1') => fireEvent.click(await screen.findByRole('button', { name: `Review request ${id}` }));
const approveInDialog = async () => { const button = dialog().getByRole('button', { name: 'Approve transfer' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); return button; };
const expandModules = (id = 'R1') => fireEvent.click(row(id).getByText(/^[0-9]+ modules?$/));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
  vi.mocked(api.getTransferReview).mockResolvedValue({ reviewToken: 'review', csrfToken: 'csrf', modules: [] });
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('Transfer Progress list and supported operations', () => {
  it('combines module and UK request-day filters, restores them from the URL, and clears them without losing unrelated parameters', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([
      request('R1', { requestedAt: '2026-10-24T23:30:00Z' }),
      request('R2', { requestedAt: '2026-10-24T20:00:00Z' }),
      request('R3', { requestedAt: '2026-10-25T09:00:00Z', modules: [module('M2')] }),
      request('R4', { requestedAt: null as unknown as string }),
    ]));
    show('/users/progress-transfers?transferModule=legacy%3AM1%3AM1&transferFrom=2026-10-25&transferTo=2026-10-25&keep=example');
    await screen.findByRole('button', { name: 'Review request R1' });
    expect(screen.queryByRole('button', { name: 'Review request R2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review request R3' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review request R4' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Requested from')).toHaveValue('2026-10-25');
    fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'legacy:M2:M2' } });
    expect(screen.getByRole('button', { name: 'Review request R3' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Requested to'), { target: { value: '2026-10-24' } });
    expect(screen.getByText('No requests match your filters.')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getByTestId('location')).toHaveTextContent('?keep=example');
    expect(api.getTransferRequests).toHaveBeenCalledTimes(1);
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('opens Pending first, keeps identities separate and prioritises the oldest request', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request('R2', { requestedAt: '2026-10-22T09:00:00Z' }), request()])); show();
    await screen.findByRole('button', { name: 'Review request R1' });
    expect(pendingTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('row').slice(1).map(el => el.getAttribute('aria-label'))).toEqual(['Request R1 for Same learner', 'Request R2 for Same learner']);
    expect(pendingTab()).toHaveTextContent('2 retrieved'); expect(approvedTab()).toHaveTextContent('0 retrieved');
    expect(screen.getByRole('combobox', { name: 'Sort requests' })).toHaveValue('oldest');
    expect(row().getByText(/19 Oct 2026/)).toBeVisible(); expect(row().getByText('Waiting 19 days')).toBeVisible();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('expands every module with full source/destination identities, saved progress and hours', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request('R2', { modules: [module('M1', 100, 1), module('M2', 40, 2), module('M3', 0, 20)] })])); show();
    await screen.findByRole('button', { name: 'Review request R2' });
    const summary = row('R2').getByText('3 modules').closest('summary')!; summary.focus(); expect(summary).toHaveFocus();
    fireEvent.click(summary);
    const modules = within(screen.getByRole('list', { name: 'Modules in request R2' }));
    expect(modules.getByText('Old M3')).toBeVisible(); expect(modules.getByText('New M3')).toBeVisible();
    expect(modules.getByText('Old LMS · legacy:M3')).toBeVisible(); expect(modules.getByText('New LMS · M3')).toBeVisible();
    expect(modules.getByText('0% saved · 20h')).toBeVisible(); expect(modules.getByText('100% saved · 1h')).toBeVisible();
    expect(api.getTransferReview).not.toHaveBeenCalled(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('opens the exact request and all saved snapshots without deciding another record', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request(), request('R2', { learnerId: '8', learnerKind: 'apprenticeship', modules: [module('M2', 100, 12), module('M3', 40, 3), module('M4', 0, 0)] })])); show();
    await openReview('R2');
    expect(dialog().getByText('R2')).toBeVisible(); expect(dialog().getByText('8')).toBeVisible(); expect(dialog().getByText('Apprenticeship')).toBeVisible();
    expect(dialog().getByText('Old LMS course: M4')).toBeVisible(); expect(dialog().getByText('New LMS module: M4')).toBeVisible();
    for (const value of ['100% saved progress', '40% saved progress', '0% saved progress']) expect(dialog().getByText(value)).toBeVisible();
    expect(api.getTransferReview).toHaveBeenCalledExactlyOnceWith('R2', expect.any(AbortSignal));
    expect(api.getTransferRequests).toHaveBeenCalledTimes(1); expect(api.approveTransferRequest).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves demo-progress warnings on the expanded module list and review', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request('R1', { modules: [{ ...module(), demoProgress: true }] })])); show();
    await screen.findByRole('button', { name: 'Review request R1' }); expandModules(); expect(row().getByText('Demo progress')).toBeVisible();
    await openReview(); expect(dialog().getByText('Demo progress')).toBeVisible();
  });

  it('distinguishes loading, real empty results and unavailable counts', async () => {
    const read = deferred<api.AdminTransfers>(); vi.mocked(api.getTransferRequests).mockReturnValue(read.promise); show();
    expect(pendingTab()).toHaveTextContent('—'); expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.queryByText('No requests waiting for approval.')).not.toBeInTheDocument();
    await act(async () => read.resolve(response([])));
    expect(pendingTab()).toHaveTextContent('0 retrieved'); expect(screen.getByText('No requests waiting for approval.')).toBeVisible();
    fireEvent.click(approvedTab()); expect(screen.getByText('No approved transfers yet.')).toBeVisible();
  });

  it('retries initial read failure without fabricating empty totals', async () => {
    vi.mocked(api.getTransferRequests).mockRejectedValueOnce(new Error('Request list unavailable')).mockResolvedValue(response([request()])); show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Request list unavailable'); expect(pendingTab()).toHaveTextContent('—');
    expect(screen.queryByText('No requests waiting for approval.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' })); await screen.findByRole('button', { name: 'Review request R1' });
    expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('does not turn missing hour/progress values into real zeros', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request('R1', { modules: [module('M1', Number.NaN, Number.NaN)] })])); show();
    await screen.findByRole('button', { name: 'Review request R1' }); expandModules();
    expect(row().getByText('Progress unavailable · Hours unavailable')).toBeVisible(); expect(row().queryByText('0h')).not.toBeInTheDocument();
    await openReview(); expect(dialog().getAllByText('Progress unavailable')).toHaveLength(2);
    dialog().getAllByText('Progress unavailable').forEach(value => expect(value).toBeVisible()); expect(dialog().queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('retrieves every offset before enabling global filters and reconciles duplicate request IDs', async () => {
    const last = deferred<api.AdminTransfers>();
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request(), approved('A1')], 50)).mockReturnValueOnce(last.promise); show();
    await waitFor(() => expect(api.getTransferRequests).toHaveBeenCalledTimes(2));
    expect(pendingTab()).toHaveTextContent('1 loaded'); expect(screen.getByRole('searchbox')).toBeDisabled(); expect(screen.getByRole('combobox', { name: 'Sort requests' })).toBeDisabled();
    await act(async () => last.resolve(response([request(), request('R2'), approved('A2')])));
    expect(pendingTab()).toHaveTextContent('2 retrieved'); expect(screen.getByRole('searchbox')).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /^Review request/ })).toHaveLength(2);
    expect(api.getTransferRequests).toHaveBeenLastCalledWith(50, expect.any(AbortSignal));
    fireEvent.click(approvedTab()); expect(screen.getAllByRole('button', { name: /^Details for request/ })).toHaveLength(2);
  });

  it('retains partial results on a later-page error and continues from the same offset', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request()], 50)).mockRejectedValueOnce(new Error('Next page unavailable')).mockResolvedValueOnce(response([request('R2')])); show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Next page unavailable'); expect(row().getByText('Same learner')).toBeVisible();
    expect(screen.getByRole('searchbox')).toBeDisabled(); expect(pendingTab()).toHaveTextContent('1 loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Continue loading requests' })); await screen.findByRole('button', { name: 'Review request R2' });
    expect(pendingTab()).toHaveTextContent('2 retrieved'); expect(api.getTransferRequests).toHaveBeenLastCalledWith(50, expect.any(AbortSignal));
  });

  it('rejects non-advancing pagination rather than looping or claiming a complete total', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()], 50)); show();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified'); expect(api.getTransferRequests).toHaveBeenCalledTimes(2);
    expect(pendingTab()).toHaveTextContent('1 loaded'); expect(screen.getByRole('searchbox')).toBeDisabled();
  });

  it('combines cross-page search, programme filtering, sorting and local pagination without writes', async () => {
    const many = Array.from({ length: 22 }, (_, i) => request(`R${String(i).padStart(2, '0')}`, { learnerName: `Learner ${String(i).padStart(2, '0')}`, programme: i === 21 ? 'Programme B' : 'Programme A', requestedAt: `2026-10-${String(i + 1).padStart(2, '0')}T09:00:00Z` }));
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response(many.slice(0, 10), 50)).mockResolvedValueOnce(response(many.slice(10))); show();
    await waitFor(() => expect(screen.getByRole('searchbox')).toBeEnabled());
    expect(screen.getByText('Page 1 of 3')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Next request page' }));
    expect(screen.getByText('Page 2 of 3')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Learner 21' } });
    expect(screen.getByRole('button', { name: 'Review request R21' })).toBeVisible(); expect(screen.getByText('Page 1 of 1')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Programme' }), { target: { value: 'Programme A' } });
    expect(screen.getByText('No requests match your filters.')).toBeVisible(); expect(pendingTab()).toHaveTextContent('22 retrieved');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort requests' }), { target: { value: 'newest' } });
    expect(screen.getAllByRole('row')[1]).toHaveAttribute('aria-label', 'Request R21 for Learner 21');
    expect(api.getTransferRequests).toHaveBeenCalledTimes(2); expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('preserves tab, filters, sorting, page and unrelated URL parameters after review', async () => {
    const many = Array.from({ length: 12 }, (_, i) => approved(`A${String(i).padStart(2, '0')}`));
    vi.mocked(api.getTransferRequests).mockResolvedValue(response(many));
    show('/users/progress-transfers?transferStatus=approved&transferQuery=Same&transferProgramme=Programme+A&transferSort=learner&transferPage=2&keep=example');
    fireEvent.click(await screen.findByRole('button', { name: 'Details for request A10' })); fireEvent.click(dialog().getByText('Close', { selector: 'button' }));
    expect(approvedTab()).toHaveAttribute('aria-selected', 'true'); expect(screen.getByRole('searchbox')).toHaveValue('Same');
    expect(screen.getByRole('combobox', { name: 'Programme' })).toHaveValue('Programme A'); expect(screen.getByRole('combobox', { name: 'Sort requests' })).toHaveValue('learner');
    expect(screen.getByText('Page 2 of 2')).toBeVisible(); expect(screen.getByTestId('location')).toHaveTextContent('keep=example'); expect(screen.getByTestId('location')).toHaveTextContent('transferPage=2');
    expect(api.getTransferReview).not.toHaveBeenCalled();
  });

  it('uses linked tab semantics and keyboard navigation without altering filters', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request(), approved()])); show(); await screen.findByRole('button', { name: 'Review request R1' });
    const pending = pendingTab(); pending.focus(); fireEvent.keyDown(pending, { key: 'ArrowRight' });
    expect(approvedTab()).toHaveFocus(); expect(approvedTab()).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel'); expect(approvedTab()).toHaveAttribute('aria-controls', panel.id); expect(panel).toHaveAttribute('aria-labelledby', approvedTab().id);
    fireEvent.keyDown(approvedTab(), { key: 'Home' }); expect(pendingTab()).toHaveFocus(); expect(pendingTab()).toHaveAttribute('aria-selected', 'true');
  });

  it('shows immutable approved snapshots, requested and decision dates without approval actions', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([approved('A1', { modules: [module('SNAPSHOT', 87, 17.5)] })])); show(); fireEvent.click(approvedTab());
    await screen.findByRole('button', { name: 'Details for request A1' }); expect(row('A1').getByText(/19 Oct 2026/)).toBeVisible(); expect(row('A1').getByText(/20 Oct 2026/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details for request A1' }));
    for (const value of ['Old SNAPSHOT', '17h 30m', '87% saved progress']) expect(dialog().getByText(value)).toBeVisible();
    expect(dialog().queryByRole('button', { name: 'Approve transfer' })).not.toBeInTheDocument(); expect(api.getTransferReview).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and prevents duplicate submissions while saving', async () => {
    const post = deferred<api.ProgressTransferRequest>(); vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()])); vi.mocked(api.approveTransferRequest).mockReturnValue(post.promise); show();
    await openReview(); expect(api.approveTransferRequest).not.toHaveBeenCalled(); const confirm = await approveInDialog(); fireEvent.click(confirm);
    expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R1', 'csrf', decisions); expect(dialog().getByRole('button', { name: 'Transferring…' })).toBeDisabled(); expect(dialog().getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => post.resolve(approved('R1'))); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refreshes the entire list from offset zero only after server-confirmed approval', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request()], 50)).mockResolvedValueOnce(response([approved()])).mockResolvedValueOnce(response([approved('R1'), approved()]));
    vi.mocked(api.approveTransferRequest).mockResolvedValue(approved('R1')); show();
    await waitFor(() => expect(screen.getByRole('searchbox')).toBeEnabled()); await openReview(); await approveInDialog();
    await screen.findByText('Transfer approved. The learner can now open the new modules.');
    expect(api.getTransferRequests).toHaveBeenCalledTimes(3); expect(api.getTransferRequests).toHaveBeenLastCalledWith(0, expect.any(AbortSignal));
    expect(pendingTab()).toHaveTextContent('0 retrieved'); expect(approvedTab()).toHaveTextContent('2 retrieved');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(pendingTab()).toHaveFocus();
  });

  it('keeps a committed approval truthful if refresh fails and pauses approval until a fresh list', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request(), request('R2')])).mockRejectedValueOnce(new Error('Refresh unavailable')).mockResolvedValueOnce(response([request('R2'), approved('R1')]));
    vi.mocked(api.approveTransferRequest).mockResolvedValue(approved('R1')); show(); await openReview(); await approveInDialog();
    expect(await screen.findByText('Transfer approved. The learner can now open the new modules.')).toBeVisible(); expect(await screen.findByRole('alert')).toHaveTextContent('Refresh unavailable');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(approvedTab()).toHaveTextContent('1 retrieved');
    await openReview('R2'); await waitFor(() => expect(api.getTransferReview).toHaveBeenCalledTimes(2)); expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeDisabled();
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' })); fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument()); await openReview('R2');
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeEnabled()); expect(api.approveTransferRequest).toHaveBeenCalledTimes(1);
  });

  it('preserves matching context after a recoverable server conflict and retries the same exact request', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()])); vi.mocked(api.approveTransferRequest).mockRejectedValueOnce(new Error('A module assignment or course mapping changed.')).mockResolvedValue(approved('R1')); show();
    await openReview(); await approveInDialog(); expect(await screen.findByRole('alert')).toHaveTextContent('mapping changed');
    expect(api.getTransferRequests).toHaveBeenCalledTimes(1); expect(dialog().getByText('R1')).toBeVisible();
    fireEvent.click(dialog().getByRole('button', { name: 'Approve transfer' })); await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.approveTransferRequest).mock.calls.every(args => args.length === 3 && args[0] === 'R1' && args[1] === 'csrf' && args[2]?.reviewToken === 'review')).toBe(true);
  });

  it('accepts an authoritative approved response when another administrator already decided the request', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValueOnce(response([request()])).mockResolvedValueOnce(response([approved('R1')])); vi.mocked(api.approveTransferRequest).mockResolvedValue(approved('R1')); show();
    await openReview(); await approveInDialog(); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pendingTab()).toHaveTextContent('0 retrieved'); fireEvent.click(approvedTab()); expect(row().getByText('Request R1')).toBeVisible();
  });

  it('does not claim success for a different request response', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()])); vi.mocked(api.approveTransferRequest).mockResolvedValue(approved('OTHER')); show();
    await openReview(); await approveInDialog(); expect(await screen.findByRole('alert')).toHaveTextContent('did not confirm this request');
    expect(screen.queryByText(/Transfer approved/)).not.toBeInTheDocument(); expect(dialog().getByText('R1')).toBeVisible();
  });

  it('requires a CSRF-bearing list for approval while still permitting read-only review', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()], null, '')); show(); await openReview();
    expect(await dialog().findByText('Refresh requests before approving this transfer.')).toBeVisible(); expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeDisabled(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('dismisses read-only review with Escape and restores its trigger', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()])); show(); const trigger = await screen.findByRole('button', { name: 'Review request R1' }); trigger.focus(); fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(trigger).toHaveFocus(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('ignores a late matching response from a previously opened request', async () => {
    const old = deferred<api.TransferReview>(); vi.mocked(api.getTransferRequests).mockResolvedValue(response([request(), request('R2')]));
    vi.mocked(api.getTransferReview).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ reviewToken: 'new-review', csrfToken: 'new-csrf', modules: [] }); show();
    await openReview(); const oldSignal = vi.mocked(api.getTransferReview).mock.calls[0][1]!; fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    await openReview('R2'); await waitFor(() => expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeEnabled());
    await act(async () => old.resolve({ reviewToken: 'old-review', csrfToken: 'old-csrf', modules: [] })); expect(oldSignal.aborted).toBe(true);
    vi.mocked(api.approveTransferRequest).mockRejectedValue(new Error('Synthetic refusal')); fireEvent.click(dialog().getByRole('button', { name: 'Approve transfer' }));
    expect(api.approveTransferRequest).toHaveBeenCalledExactlyOnceWith('R2', 'new-csrf', { reviewToken: 'new-review', mappings: [] });
  });

  it('invalidates matching immediately during an explicit reload', async () => {
    const reload = deferred<api.TransferReview>(); vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()]));
    vi.mocked(api.getTransferReview).mockResolvedValueOnce({ reviewToken: 'first', csrfToken: 'csrf', modules: [] }).mockReturnValueOnce(reload.promise); show(); await openReview();
    await waitFor(() => expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeEnabled()); fireEvent.click(dialog().getByRole('button', { name: 'Reload component matches' }));
    expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeDisabled(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
    await act(async () => reload.resolve({ reviewToken: 'second', csrfToken: 'csrf', modules: [] })); expect(dialog().getByRole('button', { name: 'Approve transfer' })).toBeEnabled();
  });

  it('aborts outstanding list reads and ignores their response after unmount', async () => {
    const read = deferred<api.AdminTransfers>(); vi.mocked(api.getTransferRequests).mockReturnValue(read.promise); const view = show(); const signal = vi.mocked(api.getTransferRequests).mock.calls[0][1]!;
    view.unmount(); expect(signal.aborted).toBe(true); await act(async () => read.resolve(response([request()]))); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.approveTransferRequest).not.toHaveBeenCalled();
  });

  it('keeps the general explanation collapsed and reserves primary approval for the review', async () => {
    vi.mocked(api.getTransferRequests).mockResolvedValue(response([request()])); show(); await screen.findByRole('button', { name: 'Review request R1' });
    const summary = screen.getByText('How transfers work').closest('summary')!; expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('button', { name: 'Approve transfer' })).not.toBeInTheDocument(); fireEvent.click(summary);
    expect(screen.getByText(/Confirm inside the review/)).toBeVisible(); await openReview(); expect(dialog().getByText(/Existing completions and matched old completions count once/)).toBeVisible();
  });
});
