import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CaseloadApiLearner } from './types';
import { CoachCaseloadContent } from './page';

const { coachFetch, fetchCoachCalendarEvents, authState, coachIdentity } = vi.hoisted(() => ({
  coachFetch: vi.fn(),
  fetchCoachCalendarEvents: vi.fn(),
  authState: { auth: { account: { email: 'coach@example.com' } }, isInitialized: true },
  coachIdentity: {
    email: 'coach@example.com', name: 'Coach Example', isInitialized: true,
    isViewingAsCoach: false, canChooseCoach: false,
  },
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({
  useCoachIdentity: () => coachIdentity,
}));
vi.mock('@/lib/coachFetch', () => ({ coachFetch }));
vi.mock('@/pages/coach/shared/calendarEvents', () => ({ fetchCoachCalendarEvents }));

const learner = {
  id: '42', name: 'Final Learner', initials: 'FL', employer: '--', cohortId: 'c1', cohortName: 'Business Admin L3', group: 'G1',
  status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 78, overallProgressAvailable: true,
  attendanceRate: 80, attendanceRateAvailable: true, componentsCompleted: 8, componentsPlanned: 10,
  otjhCompleted: 70, otjhTarget: 90, ksbProgress: 65, ksbProgressAvailable: true, ksbCompleted: 13, ksbTarget: 20,
  evidenceCount: 2, nextCoaching: '--', nextReview: '--', lastContact: '--', lastAttendanceDate: '--',
  lastActivity: '19 Sep 2026', lastActivityDate: '2026-09-19T12:30:00Z', lastActivityLabel: 'Latest quiz',
  lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--', lastSubmittedEvidence: '--', recentFlag: null,
} satisfies CaseloadApiLearner;

describe('Coach caseload loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCoachCalendarEvents.mockResolvedValue({ events: [] });
  });

  it('uses embedded learners as the authoritative caseload without fetching again', async () => {
    render(<MemoryRouter><CoachCaseloadContent embedded embeddedLearners={[learner]} /></MemoryRouter>);

    expect(await screen.findByText('Final Learner')).toBeInTheDocument();
    expect(screen.getByText('19 Sep 2026')).toBeInTheDocument();
    expect(screen.queryByText('Loading learners')).not.toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
    expect(fetchCoachCalendarEvents).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'All Learners' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'OTJH caseload summary' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Status', 'On track', 'Need attention', 'At risk',
    ]);
    expect(screen.queryByRole('button', { name: 'More filters' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ shown/)).not.toBeInTheDocument();
    expect(screen.queryByText('Most urgent first')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sort direction:/ })).not.toBeInTheDocument();
  });

  it('uses the API performance status when filtering the caseload', async () => {
    const atRiskLearner = { ...learner, id: '43', name: 'At Risk Learner', initials: 'AR', status: 'at-risk' } satisfies CaseloadApiLearner;
    render(<MemoryRouter><CoachCaseloadContent embedded embeddedLearners={[learner, atRiskLearner]} /></MemoryRouter>);

    expect(await screen.findByText('At Risk Learner')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(screen.getByRole('option', { name: 'At risk' }));

    expect(screen.getByText('At Risk Learner')).toBeInTheDocument();
    expect(screen.queryByText('Final Learner')).not.toBeInTheDocument();
  });
});
