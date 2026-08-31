/**
 * LeaderboardTab — the real-data replacement for the old hardcoded "SW"/
 * "You" mock row. What matters here: the session learner is highlighted by
 * matching the real `learnerId` the backend returns (not a name guess), and
 * spend never affects rank (the component only ever renders `points`, the
 * earned total — there is nothing in props for a spendable balance).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppIcon } from '@/components/feature/AppIcon';

(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchLeaderboard = vi.fn();
const fetchLearnerDetail = vi.fn();

vi.mock('@/api/engagement', () => ({
  fetchLeaderboard: (...args: unknown[]) => fetchLeaderboard(...args),
}));
vi.mock('@/api/learnerDetail', () => ({
  fetchLearnerDetail: (...args: unknown[]) => fetchLearnerDetail(...args),
}));

const { LeaderboardTab } = await import('../LeaderboardTab');

// useMyLearner() falls back to this default ({kind:'commercial', id:'19'})
// whenever localStorage has no override — jsdom's localStorage is empty by
// default in each fresh test, so the session learner is always id '19'.
const SESSION_LEARNER_ID = '19';

const ENTRIES = [
  { rank: 1, learnerId: '61', learner: 'Daniel Walsh', points: 500, cohort: 'Sept 2025 Kent' },
  { rank: 2, learnerId: SESSION_LEARNER_ID, learner: 'Sophie Williams', points: 420, cohort: 'Sept 2025 Kent' },
  { rank: 3, learnerId: '7', learner: 'Amir Khan', points: 300, cohort: null },
];

beforeEach(() => {
  fetchLeaderboard.mockReset();
  fetchLearnerDetail.mockReset();
  fetchLearnerDetail.mockResolvedValue({ id: SESSION_LEARNER_ID, name: 'Sophie Williams', cohort: 'Sept 2025 Kent' });
  localStorage.clear();
});

describe('LeaderboardTab', () => {
  it('highlights the session learner by real learnerId, not by name', async () => {
    fetchLeaderboard.mockResolvedValue({ scope: 'monthly', cohort: null, entries: ENTRIES });
    render(<LeaderboardTab />);
    await waitFor(() => expect(screen.getByText('You are Rank #2')).toBeTruthy());
    expect(screen.getByText('420 points earned')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('renders an honest empty state when nobody has earned points yet', async () => {
    fetchLeaderboard.mockResolvedValue({ scope: 'monthly', cohort: null, entries: [] });
    render(<LeaderboardTab />);
    await waitFor(() => expect(screen.getByText('No points earned in this ranking yet.')).toBeTruthy());
  });

  it('surfaces a load failure rather than an empty board', async () => {
    fetchLeaderboard.mockRejectedValue(new Error('Could not reach the server.'));
    render(<LeaderboardTab />);
    await waitFor(() => expect(screen.getByText('Could not reach the server.')).toBeTruthy());
  });

  it('says so when the cohort ranking has no cohort to scope to, instead of silently showing everyone', async () => {
    fetchLearnerDetail.mockResolvedValue({ id: SESSION_LEARNER_ID, name: 'Sophie Williams', cohort: '' });
    fetchLeaderboard.mockResolvedValue({ scope: 'monthly', cohort: null, entries: ENTRIES });
    const user = userEvent.setup();
    render(<LeaderboardTab />);
    await waitFor(() => expect(fetchLearnerDetail).toHaveBeenCalled());
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /Cohort Rankings/i }));

    await waitFor(() => expect(screen.getByText(/Your cohort isn't set yet/)).toBeTruthy());
    // Must not silently fall back to an unscoped fetchLeaderboard call.
    expect(fetchLeaderboard).toHaveBeenCalledTimes(1);
  });
});
