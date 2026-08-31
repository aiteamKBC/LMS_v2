/**
 * Engagement Command Centre overview — the page the user originally
 * reported as "still showing mock data". Everything rendered here must now
 * come from a real endpoint: stats/overview, leaderboard (all-time +
 * monthly), voucher-claims, and learner-analytics. This guards the
 * regression directly: real stat numbers appear (not the old hardcoded
 * 59/45200/312 literals), and the restored analytics charts render from
 * real learner-analytics data, not the old mock roster.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';

(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchVoucherClaims = vi.fn();
const updateVoucherClaim = vi.fn();
const fetchLeaderboard = vi.fn();
const fetchOverviewStats = vi.fn();
const fetchLearnerAnalytics = vi.fn();
const authValue = vi.fn();
const toastSpies = { success: vi.fn(), warning: vi.fn() };

vi.mock('@/api/engagement', () => ({
  fetchVoucherClaims: (...args: unknown[]) => fetchVoucherClaims(...args),
  updateVoucherClaim: (...args: unknown[]) => updateVoucherClaim(...args),
  fetchLeaderboard: (...args: unknown[]) => fetchLeaderboard(...args),
  fetchOverviewStats: (...args: unknown[]) => fetchOverviewStats(...args),
  fetchLearnerAnalytics: (...args: unknown[]) => fetchLearnerAnalytics(...args),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => toastSpies }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/pages/engagement/LearnerProfilePanel', () => ({
  LearnerProfilePanel: () => null,
}));

const { default: EngagementDashboard } = await import('../page');

const STATS = {
  pointsAwarded: 4520, pointsAwardedThisMonth: 380,
  vouchersClaimed: 12, vouchersClaimedThisMonth: 3,
  activeLearners: 7, eventSeatsBooked: 22,
};

const ALL_TIME_ENTRIES = [
  { rank: 1, learnerId: '61', learner: 'Daniel Walsh', points: 500, cohort: 'Sept 2025 Kent' },
  { rank: 2, learnerId: '62', learner: 'Amelia Brooks', points: 420, cohort: 'Sept 2025 Kent' },
  { rank: 3, learnerId: '63', learner: 'Amir Khan', points: 300, cohort: null },
];

const ANALYTICS_LEARNERS = [
  { id: '61', name: 'Daniel Walsh', programme: 'MSN', cohort: 'Sept 2025 Kent', coach: 'Sam Coach', engagementScore: 88, riskLevel: 'green' as const, overallStatus: 'On track', flags: [], attendanceRate: 95, sessionsAttended: 19, totalSessions: 20, sessionsMissed: 1, consecutiveMissed: 0, lastAttendance: '2026-08-29', otjhHours: 90, otjhTarget: 100, ksbProgress: 85, evidenceSubmitted: 4, evidenceTarget: 5, quizAverage: 90, messageResponse: 80, clubActivity: 1, lastActive: '2026-08-30', points: 500, pointsThisMonth: 40, attendanceAction: null, employerNotified: false, interventionDate: null },
  { id: '62', name: 'Amelia Brooks', programme: 'MSN', cohort: 'Sept 2025 Kent', coach: 'Sam Coach', engagementScore: 40, riskLevel: 'red' as const, overallStatus: 'At risk', flags: [], attendanceRate: 55, sessionsAttended: 5, totalSessions: 10, sessionsMissed: 5, consecutiveMissed: 3, lastAttendance: '2026-08-10', otjhHours: 20, otjhTarget: 100, ksbProgress: 25, evidenceSubmitted: 1, evidenceTarget: 5, quizAverage: 50, messageResponse: 30, clubActivity: 0, lastActive: '2026-08-15', points: 80, pointsThisMonth: 5, attendanceAction: null, employerNotified: false, interventionDate: null },
];

beforeEach(() => {
  fetchVoucherClaims.mockReset();
  updateVoucherClaim.mockReset();
  fetchLeaderboard.mockReset();
  fetchOverviewStats.mockReset();
  fetchLearnerAnalytics.mockReset();
  toastSpies.success.mockReset();
  toastSpies.warning.mockReset();
  authValue.mockReturnValue({ auth: { account: { displayName: 'Rewan Yasser', position: 'Engagement Manager' } } });
  fetchVoucherClaims.mockResolvedValue([]);
  fetchOverviewStats.mockResolvedValue(STATS);
  fetchLearnerAnalytics.mockResolvedValue(ANALYTICS_LEARNERS);
  fetchLeaderboard.mockImplementation((scope: string) =>
    Promise.resolve({ scope, cohort: null, entries: scope === 'monthly' ? ALL_TIME_ENTRIES.map(e => ({ ...e, points: 40 })) : ALL_TIME_ENTRIES }));
});

function renderPage() {
  return render(<MemoryRouter><EngagementDashboard /></MemoryRouter>);
}

describe('engagement overview dashboard', () => {
  it('renders the real staff aggregate stats, not the old hardcoded literals', async () => {
    renderPage();
    // Old mock had activeLearnersThisMonth-style totalLearners:59 and
    // pointsAwarded:45200 hardcoded — these real numbers must replace them.
    await waitFor(() => expect(screen.getByText('4.5k')).toBeTruthy());
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    expect(screen.getByText('22')).toBeTruthy();
    expect(screen.queryByText('59')).toBeNull();
  });

  it('renders the real leaderboard with a podium once 3+ learners have points', async () => {
    renderPage();
    // Each podium learner also appears in the ranked list below it, so these
    // names are expected to render twice — once per section.
    await waitFor(() => expect(screen.getAllByText('Daniel Walsh').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Amelia Brooks').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Amir Khan').length).toBeGreaterThan(0);
    expect(screen.getByText('Champions')).toBeTruthy();
  });

  it('shows an honest empty state instead of a podium when fewer than 3 learners have points', async () => {
    fetchLeaderboard.mockResolvedValue({ scope: 'all-time', cohort: null, entries: ALL_TIME_ENTRIES.slice(0, 2) });
    renderPage();
    await waitFor(() => expect(screen.getByText('Not enough grants yet for a podium')).toBeTruthy());
  });

  it('approves a claim with no client-supplied reviewedBy', async () => {
    const claim = {
      id: 'vc-1', learnerId: '61', learner: 'Daniel Walsh', avatarImg: undefined, programmeCode: '',
      programme: 'MSN', cohort: 'Sept 2025 Kent', rewardId: 'rw-1', reward: 'Costa Voucher', points: 100,
      requestedAt: '31 Aug 2026', status: 'pending' as const, deliveryType: 'digital' as const, deliveryMethod: 'Email',
    };
    fetchVoucherClaims.mockResolvedValue([claim]);
    updateVoucherClaim.mockResolvedValue({ ...claim, status: 'approved' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Costa Voucher')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(updateVoucherClaim).toHaveBeenCalledWith('vc-1', { status: 'approved' }));
  });

  it('restores the analytics charts, now fed by real learner-analytics data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Champions')).toBeTruthy());
    // Charts are back — driven by fetchLearnerAnalytics, not the old mock roster.
    await waitFor(() => expect(fetchLearnerAnalytics).toHaveBeenCalled());
    expect(screen.getByText('Engagement Score Distribution')).toBeTruthy();
    expect(screen.getByText('OTJH Progress')).toBeTruthy();
    expect(screen.getByText('Attendance Risk Breakdown')).toBeTruthy();
    expect(screen.getByText('Engagement Drivers')).toBeTruthy();
    // Both fixture learners share one programme, so the comparison chart
    // (which needs 2+ programmes) is correctly omitted rather than shown empty.
    expect(screen.queryByText('Programme Comparison')).toBeNull();
  });

  it('shows no charts, not broken ones, before analytics has loaded', async () => {
    fetchLearnerAnalytics.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    await waitFor(() => expect(screen.getByText('Champions')).toBeTruthy());
    expect(screen.queryByText('Engagement Score Distribution')).toBeNull();
  });
});
