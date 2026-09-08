import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkSignDialog } from './BulkSignDialog';
import { getSigningReview, saveMonthSignatures, type Summary, type MonthState } from './api';

const identity = { role: 'learner', access: 'learner', displayName: 'Test signer' };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: identity } }) }));
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getSigningReview: vi.fn(), saveMonthSignatures: vi.fn() }));
vi.mock('./SignatureCapture', () => ({ SignatureCapture: ({ onSave, confirmationText, busy }: { onSave: (blob: Blob, method: string) => void; confirmationText: string; busy: boolean }) =>
  <div><p>{confirmationText}</p><button disabled={busy} onClick={() => onSave(new Blob(['signature'], { type: 'image/png' }), 'upload')}>Confirm test signature</button></div> }));
const unsigned: MonthState = { month: '2026-07', status: 'needs_review', row_count: 1, planned_hours: 1, actual_hours: 1, not_accepted_hours: 0,
  student_signature: null, coach_signature: null, pending_revisions: 0, can_complete: false, source_finalization: null };
const summary: Summary = { is_legacy: true, state: 'in_progress', can_access_lms: false, months: [unsigned, { ...unsigned, month: '2026-08' }] };
function show(data = summary, aptemId?: number) {
  const onSaved = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter><BulkSignDialog summary={data} aptemId={aptemId} onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>
  </QueryClientProvider>);
  return onSaved;
}
beforeEach(() => {
  identity.role = 'learner'; identity.access = 'learner';
  vi.mocked(getSigningReview).mockImplementation(async month => ({ month, ready: true, snapshot_digest: month }));
  vi.mocked(saveMonthSignatures).mockResolvedValue({ signed_months: ['2026-07', '2026-08'], skipped_months: [], completed_months: [], summary });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('sign all months', () => {
  it('opens signature capture immediately without a material or month preflight', () => {
    show();
    expect(screen.getByRole('button', { name: 'Confirm test signature' })).toBeEnabled();
    expect(screen.getByText(/Save my signature and complete my previous learning record/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(getSigningReview).not.toHaveBeenCalled();
    expect(saveMonthSignatures).not.toHaveBeenCalled();
  });
  it('submits every required month using one capture and one request', async () => {
    const saved = show();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm test signature' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saveMonthSignatures).toHaveBeenCalledWith(['2026-07', '2026-08'], expect.any(Blob), 'upload', undefined);
    expect(getSigningReview).not.toHaveBeenCalled();
  });
  it('includes months with missing activity data and pending revisions without waiting', async () => {
    show({ ...summary, months: [{ ...unsigned, row_count: 0, pending_revisions: 2 }, { ...unsigned, month: '2026-08' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm test signature' }));
    await waitFor(() => expect(saveMonthSignatures).toHaveBeenCalledOnce());
    expect(vi.mocked(saveMonthSignatures).mock.calls[0][0]).toEqual(['2026-07', '2026-08']);
    expect(getSigningReview).not.toHaveBeenCalled();
  });
  it('keeps the entire required scope while the server preserves completed months', async () => {
    show({ ...summary, months: [{ ...unsigned, status: 'complete' }, { ...unsigned, month: '2026-08' }, { ...unsigned, month: '2026-06', is_required: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm test signature' }));
    await waitFor(() => expect(saveMonthSignatures).toHaveBeenCalledOnce());
    expect(vi.mocked(saveMonthSignatures).mock.calls[0][0]).toEqual(['2026-07', '2026-08']);
  });
  it('explains coach signing without claiming to sign as the learner', async () => {
    identity.role = 'staff'; identity.access = 'coach';
    show(summary, 42);
    fireEvent.click(screen.getByText('View included months (2)'));
    expect(screen.getByRole('link', { name: 'July 2026' })).toHaveAttribute('href', '/old-otjh/coach/42/months/2026-07');
    expect(screen.getByText(/this is my coach signature/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm test signature' }));
    await waitFor(() => expect(saveMonthSignatures).toHaveBeenCalledOnce());
    expect(vi.mocked(saveMonthSignatures).mock.calls[0][3]).toBe(42);
  });
  it('keeps the capture open after a saving failure and supports retry', async () => {
    vi.mocked(saveMonthSignatures).mockRejectedValueOnce(new Error('Unable to save.')).mockResolvedValueOnce({ signed_months: ['2026-07', '2026-08'], skipped_months: [], completed_months: ['2026-07', '2026-08'], summary });
    const saved = show();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm test signature' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save.');
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm test signature' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });
});
