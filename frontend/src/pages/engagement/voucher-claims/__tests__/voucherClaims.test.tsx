/**
 * Staff voucher-claims page — the reviewer identity is server-derived now
 * (see engagement.ts's trimmed VoucherClaimPatch), so the regression this
 * guards is a stray client-side `reviewedBy` creeping back into the PATCH
 * body, and the claim rows showing real programme/cohort (joined from the
 * enrolment directory) rather than the blank strings the old mock-free
 * `toClaim()` left behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';

(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchVoucherClaims = vi.fn();
const updateVoucherClaim = vi.fn();
const fetchEnrolmentUsers = vi.fn();
const authValue = vi.fn();
const toastSpies = { success: vi.fn(), warning: vi.fn() };

vi.mock('@/api/engagement', () => ({
  fetchVoucherClaims: (...args: unknown[]) => fetchVoucherClaims(...args),
  updateVoucherClaim: (...args: unknown[]) => updateVoucherClaim(...args),
  fetchPointsGrants: vi.fn().mockResolvedValue([]),
  fetchRecognitions: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/api/enrolmentUsers', () => ({
  fetchEnrolmentUsers: (...args: unknown[]) => fetchEnrolmentUsers(...args),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => toastSpies }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: VoucherClaimsPage } = await import('../page');

const CLAIM = {
  id: 'vc-1', learnerId: '61', learner: 'Daniel Walsh', avatarImg: undefined,
  programmeCode: '', programme: '', cohort: '', rewardId: 'rw-1', reward: 'Costa Voucher',
  points: 100, requestedAt: '31 Aug 2026', status: 'pending' as const, reviewedBy: undefined, reviewedAt: undefined,
  deliveryType: 'digital' as const, deliveryMethod: 'Email', deliveryDetail: undefined, deliveryInstructions: undefined,
};

const DIRECTORY_USER = { id: '61', uuid: 'u-61', name: 'Daniel Walsh', type: 'User', email: 'daniel@kbc.test', group: 'apprenticeship', subscriptionStatus: 'FullUser', subscriptionVerified: true, learningPlan: false, programme: 'MSN', cohort: 'Sept 2025 Kent' };

beforeEach(() => {
  fetchVoucherClaims.mockReset();
  updateVoucherClaim.mockReset();
  fetchEnrolmentUsers.mockReset();
  toastSpies.success.mockReset();
  toastSpies.warning.mockReset();
  authValue.mockReturnValue({ auth: { account: { displayName: 'Rewan Yasser', position: 'Engagement Manager' } } });
  fetchEnrolmentUsers.mockResolvedValue([DIRECTORY_USER]);
});

function renderPage() {
  return render(<MemoryRouter><VoucherClaimsPage /></MemoryRouter>);
}

describe('staff voucher claims page', () => {
  it('enriches a claim with the real directory programme and cohort', async () => {
    fetchVoucherClaims.mockResolvedValue([CLAIM]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());
    expect(screen.getByText(/MSN.*Sept 2025 Kent/)).toBeTruthy();
  });

  it('approves a claim with no client-supplied reviewedBy', async () => {
    fetchVoucherClaims.mockResolvedValue([CLAIM]);
    updateVoucherClaim.mockResolvedValue({ ...CLAIM, status: 'approved', reviewedBy: 'Rewan Yasser' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(updateVoucherClaim).toHaveBeenCalledWith('vc-1', { status: 'approved' }));
  });

  it('rejects a claim with no client-supplied reviewedBy', async () => {
    fetchVoucherClaims.mockResolvedValue([CLAIM]);
    updateVoucherClaim.mockResolvedValue({ ...CLAIM, status: 'rejected', reviewedBy: 'Rewan Yasser' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(updateVoucherClaim).toHaveBeenCalledWith('vc-1', { status: 'rejected' }));
  });

  it('shows an empty state, not a blank grid, when nothing matches', async () => {
    fetchVoucherClaims.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText('No claims match this view')).toBeTruthy());
  });

  it('surfaces a load failure as a toast, not a silent blank page', async () => {
    fetchVoucherClaims.mockRejectedValue(new Error('Could not reach the server.'));
    renderPage();
    await waitFor(() => expect(toastSpies.warning).toHaveBeenCalledWith('Could not load claims', 'Could not reach the server.'));
  });
});
