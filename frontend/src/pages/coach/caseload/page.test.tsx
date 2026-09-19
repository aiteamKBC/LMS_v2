import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CaseloadApiLearner } from './types';
import CoachCaseload from './page';

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
  lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--', lastSubmittedEvidence: '--', recentFlag: null,
} satisfies CaseloadApiLearner;

describe('Coach caseload loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCoachCalendarEvents.mockResolvedValue({ events: [] });
  });

  it('keeps the skeleton visible until caseload, attendance and review data are all ready', async () => {
    let finishAttendance!: (response: Response) => void;
    const attendanceResponse = new Promise<Response>((resolve) => { finishAttendance = resolve; });

    coachFetch.mockImplementation((url: string) => {
      if (url.includes('/attendance')) return attendanceResponse;
      return Promise.resolve(new Response(JSON.stringify({ owner: { name: 'Coach Example' }, learners: [learner] })));
    });

    render(<MemoryRouter><CoachCaseload /></MemoryRouter>);

    expect(await screen.findByText('Loading learners')).toBeInTheDocument();
    expect(screen.queryByText('Final Learner')).not.toBeInTheDocument();

    await act(async () => {
      finishAttendance(new Response(JSON.stringify({
        learners: [{ id: '42', learner: 'Final Learner', attendance: 92, sessions: 10, hasAttendance: true }],
      })));
    });

    expect(await screen.findByText('Final Learner')).toBeInTheDocument();
    expect(screen.queryByText('Loading learners')).not.toBeInTheDocument();
  });
});
