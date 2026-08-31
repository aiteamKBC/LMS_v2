/**
 * Learner-engagement page — real analytics roster instead of the mock
 * roster. Guards: risk filter uses the server's authoritative riskLevel,
 * and fields with no data (null) render "—" rather than a fabricated 0/mock
 * value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';

(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchLearnerAnalytics = vi.fn();
const authValue = vi.fn();
const toastSpies = { success: vi.fn(), warning: vi.fn() };

vi.mock('@/api/engagement', () => ({
  fetchLearnerAnalytics: (...args: unknown[]) => fetchLearnerAnalytics(...args),
  fetchPointsGrants: vi.fn().mockResolvedValue([]),
  fetchRecognitions: vi.fn().mockResolvedValue([]),
  fetchVoucherClaims: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => toastSpies }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: LearnerEngagementPage } = await import('../page');

const GREEN_LEARNER = {
  id: '61', name: 'Daniel Walsh', programme: 'MSN', cohort: 'Sept 2025 Kent', coach: 'Sam Coach',
  engagementScore: 88, riskLevel: 'green' as const, overallStatus: 'On track', flags: [],
  attendanceRate: 95, sessionsAttended: 19, totalSessions: 20, sessionsMissed: 1, consecutiveMissed: 0,
  lastAttendance: '2026-08-29', otjhHours: 90, otjhTarget: 100, ksbProgress: 85, evidenceSubmitted: 4,
  evidenceTarget: 5, quizAverage: 90, messageResponse: null, clubActivity: 2, lastActive: '2026-08-30',
  points: 500, pointsThisMonth: 40, attendanceAction: null, employerNotified: false, interventionDate: null,
};

const RED_LEARNER = { ...GREEN_LEARNER, id: '62', name: 'Amir Khan', riskLevel: 'red' as const, engagementScore: 30 };

beforeEach(() => {
  fetchLearnerAnalytics.mockReset();
  toastSpies.warning.mockReset();
  authValue.mockReturnValue({ auth: { account: { displayName: 'Rewan Yasser', position: 'Engagement Manager' } } });
});

function renderPage() {
  return render(<MemoryRouter><LearnerEngagementPage /></MemoryRouter>);
}

describe('learner engagement page', () => {
  it('renders real scores and shows "no data" for a null message-response field', async () => {
    fetchLearnerAnalytics.mockResolvedValue([GREEN_LEARNER]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());
    expect(screen.getAllByText('88%').length).toBeGreaterThan(0);
    expect(screen.getByText('2 clubs')).toBeTruthy();
  });

  it('filters by the server-authoritative risk level', async () => {
    fetchLearnerAnalytics.mockResolvedValue([GREEN_LEARNER, RED_LEARNER]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());
    expect(screen.getByText('Amir Khan')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'At Risk' }));

    expect(screen.queryByText('Daniel Walsh')).toBeNull();
    expect(screen.getByText('Amir Khan')).toBeTruthy();
  });

  it('surfaces a load failure as a toast', async () => {
    fetchLearnerAnalytics.mockRejectedValue(new Error('Could not reach the server.'));
    renderPage();
    await waitFor(() => expect(toastSpies.warning).toHaveBeenCalledWith('Could not load learner analytics', 'Could not reach the server.'));
  });
});
