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

  it('uses dashboard-owned learners without loading detailed endpoints', async () => {
    render(<MemoryRouter><CoachCaseloadContent embedded embeddedLearners={[learner]} /></MemoryRouter>);

    expect(await screen.findByText('Final Learner')).toBeInTheDocument();
    expect(screen.getByText('19 Sep 2026')).toBeInTheDocument();
    expect(screen.queryByText('Loading learners')).not.toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
    expect(fetchCoachCalendarEvents).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'All Learners' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'OTJH caseload summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All OTJH statuses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More filters' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ shown/)).not.toBeInTheDocument();
    expect(screen.queryByText('Most urgent first')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sort direction:/ })).not.toBeInTheDocument();
  });

  it('filters dashboard-owned learners locally and shows every row without pagination', async () => {
    const learners = Array.from({ length: 16 }, (_, index) => ({
      ...learner,
      id: String(index + 1),
      name: index === 15 ? 'Abigail Reece' : `Aaa Learner ${String(index + 1).padStart(2, '0')}`,
      initials: index === 15 ? 'AR' : 'LR',
    } satisfies CaseloadApiLearner));
    render(<MemoryRouter><CoachCaseloadContent embedded embeddedLearners={learners} /></MemoryRouter>);

    expect(await screen.findByText('Aaa Learner 01')).toBeInTheDocument();
    expect(screen.getByText('Abigail Reece')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Abigail Reece' } });
    expect((await screen.findAllByText('Abigail Reece')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Aaa Learner 02')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 matching learner.')).toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
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

  it('lists and filters every dashboard cohort when cohort ids are absent', async () => {
    const learners = [
      { ...learner, id: 'oct', name: 'October Learner', cohortId: undefined, cohortName: 'Oct 2025' },
      { ...learner, id: 'feb', name: 'February Learner', cohortId: undefined, cohortName: 'Feb 2026' },
      { ...learner, id: 'oct2', name: 'Second October Learner', cohortId: undefined, cohortName: 'Oct 2025' },
      { ...learner, id: 'empty', name: 'No Cohort Learner', cohortId: undefined, cohortName: undefined },
    ];
    render(<MemoryRouter><CoachCaseloadContent embedded embeddedLearners={learners} /></MemoryRouter>);
    await screen.findByText('October Learner');
    fireEvent.click(screen.getByRole('button', { name: 'All cohorts' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['All cohorts', 'Feb 2026', 'Oct 2025']);
    fireEvent.click(screen.getByRole('option', { name: 'Feb 2026' }));
    expect(screen.getByText('February Learner')).toBeVisible();
    expect(screen.queryByText('October Learner')).not.toBeInTheDocument();
    expect(screen.queryByText('No Cohort Learner')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Feb 2026' }));
    fireEvent.click(screen.getByRole('option', { name: 'Oct 2025' }));
    expect(screen.getByText('October Learner')).toBeVisible();
    expect(screen.getByText('Second October Learner')).toBeVisible();
    expect(screen.queryByText('February Learner')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('No Cohort Learner')).toBeVisible();
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('shows only cohort choices in the dashboard cohort filter', async () => {
    const learners = [
      { ...learner, id: 'a', name: 'Cohort Member', cohortName: 'Shared', cohortId: undefined, group: 'Other' },
      { ...learner, id: 'b', name: 'Group Member', cohortName: 'Other', cohortId: undefined, group: 'Shared' },
      { ...learner, id: 'c', name: 'Both Member', cohortName: 'Shared', cohortId: undefined, group: 'Shared' },
      { ...learner, id: 'd', name: 'Group Only Member', cohortName: undefined, cohortId: undefined, group: 'Shared' },
    ];
    render(<MemoryRouter><CoachCaseloadContent embedded embeddedLearners={learners} /></MemoryRouter>);
    await screen.findByText('Cohort Member');
    fireEvent.click(screen.getByRole('button', { name: 'All cohorts' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'All cohorts', 'Other', 'Shared',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Shared' }));
    expect(screen.getByText('Cohort Member')).toBeVisible();
    expect(screen.getByText('Both Member')).toBeVisible();
    expect(screen.queryByText('Group Member')).not.toBeInTheDocument();
    expect(screen.queryByText('Group Member')).not.toBeInTheDocument();
    expect(screen.queryByText('Group Only Member')).not.toBeInTheDocument();
    expect(coachFetch).not.toHaveBeenCalled();
  });

  it('combines dashboard programme and cohort across the full list, and clears them', async () => {
    const learners = Array.from({ length: 16 }, (_, index) => ({
      ...learner, id: String(index), name: `Delivery Learner ${index}`, programmeName: 'Business Administration', rawProgramStatus: 'Delivery', otjhCompleted: 59, otjhTarget: 100,
    }));
    learners.push({ ...learner, id: 'boundary', name: 'Boundary Learner', programmeName: 'Business Administration', rawProgramStatus: 'Delivery', otjhCompleted: 60, otjhTarget: 100 });
    learners.push({ ...learner, id: 'active', name: 'Active Learner', programmeName: 'Business Administration', rawProgramStatus: 'Active', otjhCompleted: 80, otjhTarget: 100 });
    learners.push({ ...learner, id: 'missing', name: 'Missing Learner', programmeName: 'Business Administration', rawProgramStatus: 'Delivery', otjhCompleted: 60, otjhTarget: 0 });
    learners.push({ ...learner, id: 'other-programme', name: 'Other Programme Learner', programmeName: 'Other Programme', rawProgramStatus: 'Delivery', otjhCompleted: 60, otjhTarget: 100 });
    learners.push({ ...learner, id: 'other-cohort', name: 'Other Cohort Learner', programmeName: 'Business Administration', cohortId: 'c2', cohortName: 'Other cohort', rawProgramStatus: 'Delivery', otjhCompleted: 60, otjhTarget: 100 });
    learners.push({ ...learner, id: 'on-track', name: 'On Track Learner', programmeName: 'Business Administration', rawProgramStatus: 'Delivery', otjhCompleted: 80, otjhTarget: 100 });
    render(<MemoryRouter initialEntries={['/?view=at-risk&group=obsolete&otjhMin=99']}><CoachCaseloadContent embedded embeddedLearners={learners} /></MemoryRouter>);
    await screen.findByText('Delivery Learner 0');
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All groups' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All programmes' }));
    fireEvent.click(screen.getByRole('option', { name: 'Business Administration' }));
    fireEvent.click(screen.getByRole('button', { name: 'All cohorts' }));
    fireEvent.click(screen.getByRole('option', { name: 'Business Admin L3' }));
    expect(screen.getByText('Boundary Learner')).toBeVisible();
    for (const name of ['Active Learner', 'Missing Learner', 'Delivery Learner 0', 'On Track Learner']) {
      expect(screen.getByText(name)).toBeVisible();
    }
    for (const name of ['Other Programme Learner', 'Other Cohort Learner']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'All OTJH statuses' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByRole('button', { name: 'All programmes' })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Missing Learner' } });
    expect(screen.getByRole('row', { name: /Missing Learner/ })).toBeVisible();
    expect(coachFetch).not.toHaveBeenCalled();
  });
});
