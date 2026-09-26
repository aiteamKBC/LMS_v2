import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    coachFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        owner: { name: 'Coach Example' }, results: [learner],
        pagination: { page: 1, pageSize: 10, total: 32, totalPages: 4, hasNext: true, hasPrevious: false },
        filterOptions: { cohort: [{ value: 'c1', label: 'Business Admin L3' }], group: [{ value: 'G1', label: 'G1' }], programStatus: [], employer: [] },
      }),
    });
  });

  it('loads the embedded dashboard table from the paginated caseload endpoint', async () => {
    render(<MemoryRouter><CoachCaseloadContent embedded embeddedLearners={[learner]} /></MemoryRouter>);

    expect(await screen.findByText('Final Learner')).toBeInTheDocument();
    expect(screen.getByText('19 Sep 2026')).toBeInTheDocument();
    expect(screen.queryByText('Loading learners')).not.toBeInTheDocument();
    expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('/coach_api/coach/caseload?page=1&page_size=10'), expect.anything());
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

  it('resets to page one when a backend filter changes', async () => {
    const atRiskLearner = { ...learner, id: '43', name: 'At Risk Learner', initials: 'AR', status: 'at-risk' } satisfies CaseloadApiLearner;
    coachFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [learner, atRiskLearner], pagination: { page: 1, pageSize: 10, total: 32, totalPages: 4 }, filterOptions: { cohort: [], group: [], programStatus: [], employer: [] } }) });
    render(<MemoryRouter><CoachCaseloadContent embedded /></MemoryRouter>);

    expect(await screen.findByText('At Risk Learner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything()));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Final' } });
    await waitFor(() => expect(coachFetch).toHaveBeenCalledWith(expect.stringContaining('page=1'), expect.anything()));
  });
});
