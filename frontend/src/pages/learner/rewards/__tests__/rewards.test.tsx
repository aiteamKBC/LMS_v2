/**
 * Learner rewards page — the wallet display and the claim flow.
 *
 * The thing worth protecting here: `available` (spendable balance) and
 * `earned` (lifetime) are two different numbers from the same
 * `fetchMyPoints()` summary, and a claim must optimistically decrement the
 * former without touching the latter — a regression here silently shows a
 * learner the wrong balance, which is exactly the kind of bug this build
 * pass exists to catch (see the `earned` TS2304 this test file guards).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppIcon } from '@/components/feature/AppIcon';

// unplugin-auto-import injects `AppIcon` as a bare global at Vite build time;
// Vitest's transform pipeline doesn't run that plugin, so every page relying
// on the bare identifier needs it supplied here.
(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchLearnerDetail = vi.fn();
const fetchRewards = vi.fn();
const fetchVoucherClaims = vi.fn();
const fetchRecognitions = vi.fn();
const fetchPointsGrants = vi.fn();
const fetchMyPoints = vi.fn();
const createVoucherClaim = vi.fn();

vi.mock('@/api/learnerDetail', () => ({
  fetchLearnerDetail: (...args: unknown[]) => fetchLearnerDetail(...args),
}));
vi.mock('@/api/engagement', () => ({
  fetchRewards: (...args: unknown[]) => fetchRewards(...args),
  fetchVoucherClaims: (...args: unknown[]) => fetchVoucherClaims(...args),
  fetchRecognitions: (...args: unknown[]) => fetchRecognitions(...args),
  fetchPointsGrants: (...args: unknown[]) => fetchPointsGrants(...args),
  fetchMyPoints: (...args: unknown[]) => fetchMyPoints(...args),
  createVoucherClaim: (...args: unknown[]) => createVoucherClaim(...args),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: LearnerRewardsPage } = await import('../page');

const REWARD = {
  id: 'rw-1', name: 'Costa Voucher', description: 'A £5 voucher', points: 100,
  category: 'Food', deliveryType: 'digital' as const, stock: 10, totalClaimed: 0,
  image: '', popular: false, active: true,
};

function resolvesTo(overrides: { balance?: number; earned?: number; rewards?: typeof REWARD[] } = {}) {
  fetchLearnerDetail.mockResolvedValue({ id: '19', name: 'Sophie Williams', programme: 'MSN' });
  fetchRewards.mockResolvedValue(overrides.rewards ?? [REWARD]);
  fetchVoucherClaims.mockResolvedValue([]);
  fetchRecognitions.mockResolvedValue([]);
  fetchPointsGrants.mockResolvedValue([]);
  fetchMyPoints.mockResolvedValue({ learnerId: '19', earned: overrides.earned ?? 250, committed: 50, balance: overrides.balance ?? 200 });
}

beforeEach(() => {
  fetchLearnerDetail.mockReset();
  fetchRewards.mockReset();
  fetchVoucherClaims.mockReset();
  fetchRecognitions.mockReset();
  fetchPointsGrants.mockReset();
  fetchMyPoints.mockReset();
  createVoucherClaim.mockReset();
});

function renderPage() {
  return render(<LearnerRewardsPage />);
}

describe('learner rewards page', () => {
  it('shows the spendable balance and lifetime earned as two distinct numbers', async () => {
    resolvesTo({ balance: 200, earned: 250 });
    renderPage();
    await waitFor(() => expect(screen.getByText('200')).toBeTruthy());
    expect(screen.getByText('250')).toBeTruthy();
    expect(screen.getByText('Lifetime earned')).toBeTruthy();
  });

  it('claims a reward and optimistically decrements only the available balance', async () => {
    resolvesTo({ balance: 200, earned: 250 });
    createVoucherClaim.mockResolvedValue({
      id: 'vc-1', learnerId: '19', learner: 'Sophie Williams', rewardId: 'rw-1', reward: 'Costa Voucher',
      points: 100, requestedAt: '2026-08-31', status: 'pending', deliveryType: 'digital', deliveryMethod: 'Email',
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Costa Voucher')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Claim reward/i }));
    await user.click(screen.getByRole('button', { name: /Confirm claim/i }));

    await waitFor(() => expect(createVoucherClaim).toHaveBeenCalledWith({ rewardId: 'rw-1' }));
    // Balance drops by the claim's points; lifetime earned is untouched.
    await waitFor(() => expect(screen.getByText('100')).toBeTruthy());
    expect(screen.getByText('250')).toBeTruthy();
  });

  it('disables claiming a reward the learner cannot afford', async () => {
    resolvesTo({ balance: 10, rewards: [REWARD] });
    renderPage();
    await waitFor(() => expect(screen.getByText('Costa Voucher')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Need 90 more points/i })).toBeDisabled();
  });

  it('shows a load failure banner rather than a blank page', async () => {
    fetchLearnerDetail.mockResolvedValue({ id: '19', name: 'Sophie Williams', programme: 'MSN' });
    fetchRewards.mockRejectedValue(new Error('Could not reach the server.'));
    fetchVoucherClaims.mockResolvedValue([]);
    fetchRecognitions.mockResolvedValue([]);
    fetchPointsGrants.mockResolvedValue([]);
    fetchMyPoints.mockResolvedValue({ learnerId: '19', earned: 0, committed: 0, balance: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());
  });

  it('shows an empty state, not a blank list, when there are no rewards', async () => {
    resolvesTo({ rewards: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('No rewards found')).toBeTruthy());
  });
});
