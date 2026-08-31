/**
 * Attendance-risk page — now driven entirely by real bulk learner analytics
 * instead of the mock roster. Guards: real riskLevel/engagementScore drive
 * the filters (not a re-derived client-side score), and "Take Action" now
 * writes a real intervention instead of doing nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';

(globalThis as unknown as { AppIcon: typeof AppIcon }).AppIcon = AppIcon;

const fetchLearnerAnalytics = vi.fn();
const createAttendanceIntervention = vi.fn();
const authValue = vi.fn();
const toastSpies = { success: vi.fn(), warning: vi.fn() };

vi.mock('@/api/engagement', () => ({
  fetchLearnerAnalytics: (...args: unknown[]) => fetchLearnerAnalytics(...args),
  createAttendanceIntervention: (...args: unknown[]) => createAttendanceIntervention(...args),
  fetchPointsGrants: vi.fn().mockResolvedValue([]),
  fetchRecognitions: vi.fn().mockResolvedValue([]),
  fetchVoucherClaims: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue() }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => toastSpies }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { default: AttendanceRiskPage } = await import('../page');

const RISK_LEARNER = {
  id: '61', name: 'Daniel Walsh', programme: 'MSN', cohort: 'Sept 2025 Kent', coach: 'Sam Coach',
  engagementScore: 42, riskLevel: 'red' as const, overallStatus: 'At risk', flags: [],
  attendanceRate: 60, sessionsAttended: 6, totalSessions: 10, sessionsMissed: 4, consecutiveMissed: 3,
  lastAttendance: '2026-08-20', otjhHours: 20, otjhTarget: 100, ksbProgress: 30, evidenceSubmitted: 2,
  evidenceTarget: 5, quizAverage: 55, messageResponse: 40, clubActivity: 0, lastActive: '2026-08-25',
  points: 120, pointsThisMonth: 10, attendanceAction: null, employerNotified: false, interventionDate: null,
};

const ON_TRACK_LEARNER = { ...RISK_LEARNER, id: '62', name: 'Amelia Brooks', riskLevel: 'green' as const, engagementScore: 88 };

beforeEach(() => {
  fetchLearnerAnalytics.mockReset();
  createAttendanceIntervention.mockReset();
  toastSpies.success.mockReset();
  toastSpies.warning.mockReset();
  authValue.mockReturnValue({ auth: { account: { displayName: 'Rewan Yasser', position: 'Engagement Manager' } } });
});

function renderPage() {
  return render(<MemoryRouter><AttendanceRiskPage /></MemoryRouter>);
}

describe('attendance risk page', () => {
  it('renders real attendance/KSB/OTJH/quiz fields from the analytics endpoint', async () => {
    fetchLearnerAnalytics.mockResolvedValue([RISK_LEARNER, ON_TRACK_LEARNER]);
    renderPage();
    // Only at-risk (red/amber) learners appear in the main list.
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());
    expect(screen.queryByText('Amelia Brooks')).toBeNull();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('logs a real intervention via "Take Action", not a no-op', async () => {
    fetchLearnerAnalytics.mockResolvedValue([RISK_LEARNER]);
    createAttendanceIntervention.mockResolvedValue({
      id: 'iv-1', learnerId: '61', learnerName: 'Daniel Walsh', action: 'Called learner and employer',
      employerNotified: true, interventionDate: null, createdBy: 'Rewan Yasser', createdAt: '2026-08-31',
      resolved: false, resolvedAt: null,
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Daniel Walsh')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Take Action' }));
    await user.type(screen.getByPlaceholderText(/Call scheduled/), 'Called learner and employer');
    await user.click(screen.getByRole('button', { name: /Log Intervention/i }));

    await waitFor(() => expect(createAttendanceIntervention).toHaveBeenCalledWith({
      learnerId: '61', learnerName: 'Daniel Walsh', action: 'Called learner and employer',
      employerNotified: false, interventionDate: null,
    }));
    await waitFor(() => expect(screen.getByText('Called learner and employer')).toBeTruthy());
  });

  it('shows an empty state when nobody is at risk', async () => {
    fetchLearnerAnalytics.mockResolvedValue([ON_TRACK_LEARNER]);
    renderPage();
    await waitFor(() => expect(screen.getByText('No learners match this view')).toBeTruthy());
  });

  it('surfaces a load failure as a toast', async () => {
    fetchLearnerAnalytics.mockRejectedValue(new Error('Could not reach the server.'));
    renderPage();
    await waitFor(() => expect(toastSpies.warning).toHaveBeenCalledWith('Could not load learner analytics', 'Could not reach the server.'));
  });
});
