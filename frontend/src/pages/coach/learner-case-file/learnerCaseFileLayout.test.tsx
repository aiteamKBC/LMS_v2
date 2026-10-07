import type { ComponentType } from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseFileReviewMeeting, CoachLearnerCaseFileData } from './types';
import LearnerCaseFile from './page';

// This suite isolates presentation with mocked profile/tab hooks. The real
// session transport is exercised by caseFileSession.test.tsx.
vi.mock('@/features/coach/case-file/hooks/CaseFileSession', () => ({
  CaseFileSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCaseFileSession: () => null,
}));

function activityPoint(code = 'K1', activityId = 'point-1', completed = false, title = 'Learning activity', type = 'Assignment') {
  return { code, activityId, completed, title, type, module: null, status: null, source: null, completedAt: null, componentId: null };
}

const mocks = vi.hoisted(() => ({
  data: null as CoachLearnerCaseFileData | null,
  coachFetch: vi.fn(),
  readLearnerJson: vi.fn(),
  fetchKsbProfile: vi.fn(),
  refresh: vi.fn(),
  useCaseFileDashboardPlan: vi.fn(() => ({})),
  attendanceRetry: vi.fn(),
  useCaseFileAttendance: vi.fn(),
  reviewsRetry: vi.fn(),
  useCaseFileReviews: vi.fn(),
  useCaseFileNextSession: vi.fn(),
  markingRetry: vi.fn(),
  useCaseFileMarking: vi.fn(),
}));

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useCoachIdentity', () => ({
  useCoachIdentity: () => ({
    isInitialized: true,
    hasCoachAccess: true,
    email: 'coach@example.test',
    name: 'Test Coach',
  }),
}));
vi.mock('@/api/learnerRead', () => ({ readLearnerJson: mocks.readLearnerJson }));
vi.mock('@/api/curriculum', () => ({ fetchKsbProfile: mocks.fetchKsbProfile }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));
vi.mock('./useCaseFileDashboardPlan', () => ({ useCaseFileDashboardPlan: mocks.useCaseFileDashboardPlan }));
vi.mock('./useCaseFileAttendance', () => ({ useCaseFileAttendance: mocks.useCaseFileAttendance }));
vi.mock('./useCaseFileReviews', () => ({ useCaseFileReviews: mocks.useCaseFileReviews }));
vi.mock('./useCaseFileNextSession', () => ({ useCaseFileNextSession: mocks.useCaseFileNextSession }));
vi.mock('./useCaseFileMarking', () => ({ useCaseFileMarking: mocks.useCaseFileMarking }));
vi.mock('@/pages/workspace/learner/DashboardTrainingPlan', () => ({
  DashboardTrainingPlan: ({ activityOverviewOnly, timelineOnly, monthlyOnly, overviewOnly, showRewards, showOtjChart, canOpenActivities, programmeSnapshot, plan }: { activityOverviewOnly?: boolean; timelineOnly?: boolean; monthlyOnly?: boolean; overviewOnly?: boolean; showRewards?: boolean; showOtjChart?: boolean; canOpenActivities?: boolean;
    plan?: { error?: string };
    programmeSnapshot?: { overall: number | null; otjhActual: number | null; otjhTarget: number | null; ksb: number | null;
      activitiesCompleted?: number | null; activitiesTotal?: number | null; activitiesPercent?: number | null;
      attendancePresent: number | null; attendanceTotal: number | null } }) => <div aria-label="Coach learner activity overview">
    {monthlyOnly && <h2>Monthly study plan</h2>}
    {overviewOnly && <><h2>Whole programme progress</h2><h2>Programme progress</h2>{showOtjChart !== false && <h2>Off-The-Job Hours</h2>}</>}
    {timelineOnly && <h2>Module timeline</h2>}
    <span>{programmeSnapshot && `${programmeSnapshot.overall}% Ãƒâ€šÃ‚Â· ${programmeSnapshot.otjhActual}/${programmeSnapshot.otjhTarget} Ãƒâ€šÃ‚Â· ${programmeSnapshot.ksb}% Ãƒâ€šÃ‚Â· ${programmeSnapshot.attendancePresent}/${programmeSnapshot.attendanceTotal}`}</span>
    <span data-testid="activity-snapshot">{programmeSnapshot && `${programmeSnapshot.activitiesCompleted}/${programmeSnapshot.activitiesTotal} Ãƒâ€šÃ‚Â· ${programmeSnapshot.activitiesPercent}%`}</span>
    <span>{activityOverviewOnly ? 'Activity overview only' : 'Full plan'}</span>
    <span>{showRewards === false ? 'Rewards hidden' : 'Rewards visible'}</span>
    <span data-testid="overview-otjh-chart">{showOtjChart === false ? 'OTJH chart hidden' : 'OTJH chart visible'}</span>
    <span data-testid="activity-actions">{canOpenActivities === false ? 'Learner actions hidden' : 'Learner actions enabled'}</span>
    {plan?.error && <span>{plan.error}</span>}
  </div>,
}));
vi.mock('./tabs/CaseFileOverviewTab', async () => {
  const { DashboardTrainingPlan } = await import('@/pages/workspace/learner/DashboardTrainingPlan');
  const Plan = DashboardTrainingPlan as unknown as ComponentType<Record<string, unknown>>;
  return { CaseFileOverviewTab: ({ snapshot }: { snapshot: never }) => <Plan overviewOnly activityOverviewOnly showOtjChart={false} showRewards={false} canOpenActivities={false} programmeSnapshot={snapshot} /> };
});
vi.mock('./tabs/CaseFileMonthlyFocusTab', async () => {
  const { DashboardTrainingPlan } = await import('@/pages/workspace/learner/DashboardTrainingPlan');
  const Plan = DashboardTrainingPlan as unknown as ComponentType<Record<string, unknown>>;
  return { CaseFileMonthlyFocusTab: () => <Plan monthlyOnly showRewards={false} canOpenActivities={false} /> };
});
vi.mock('@/pages/workspace/learner/tabs/DashboardWeeklyTab', () => ({
  DashboardWeeklyContent: ({ canOpenActivities }: { canOpenActivities?: boolean }) => <div aria-label="Coach learner weekly learning">
    <h2>Weekly learning plan</h2><span data-testid="weekly-actions">{canOpenActivities === false ? 'Learner actions hidden' : 'Learner actions enabled'}</span>
  </div>,
}));
vi.mock('@/pages/learner/reviews/ImportedReviewHistory', () => ({
  ImportedReviewHistory: ({ kind, learnerId, category, reviewId }: { kind: string; learnerId: string; category: string; reviewId?: string }) => (
    <div data-testid="imported-review-form">{`${kind}:${learnerId}:${category}:${reviewId}`}</div>
  ),
}));
vi.mock('./components/AssignmentsTab', () => ({
  default: ({ kind, learnerId }: { kind: string; learnerId: string }) => <div data-testid="assignments-tab">{`${kind}:${learnerId}`}</div>,
}));
vi.mock('./data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data')>();
  return {
    ...actual,
    useCoachLearnerCaseFileData: () => ({
      data: mocks.data,
      loading: false,
      error: null,
      refresh: mocks.refresh,
    }),
  };
});

const caseFileData = {
  learnerId: '42',
  enrolmentId: '125',
  kind: 'apprenticeship',
  snapshot: {
    id: '42', name: 'Aya Khater', initials: 'AK', learnerType: 'apprenticeship', employer: 'Test Employer',
    cohortId: 'cohort-1', cohortName: 'Final Cohort', group: 'Final Group', status: 'on-track', enrollmentStatus: 'active',
    riskFlags: [], overallProgress: 25, attendanceRate: 88, otjhCompleted: 10, otjhTarget: 38.5, ksbProgress: 20,
    evidenceCount: 3, nextCoaching: '--', nextReview: '--', lastContact: '--', lastAttendanceDate: '--',
    lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--', lastSubmittedEvidence: '--', recentFlag: null,
    progressVariance: '--', startDate: '03 Aug 2026', gatewayReviewDate: '04 May 2027', plannedEndDate: '02 Aug 2027',
    coachName: 'Test Coach', coachEmail: 'coach@example.test', email: 'aya@example.test',
  },
  attendance: null,
  evidence: null,
  detail: {
    id: '42', name: 'Aya Khater', email: 'aya@example.test', phone: '', programme: 'Final Test',
    programmeStatus: 'Active', learnerType: 'apprenticeship', programmeStartDate: '2026-08-03',
    programmeEndDate: '2027-08-02', cohort: 'Final Cohort', group: 'Final Group', employer: 'Test Employer',
    employerId: 7, lineManager: '', isActive: true, modules: [], week: [], components: [],
    ksbs: [{ code: 'K1', type: 'Knowledge', number: '1', description: 'Understand the organisation' }],
    quizAttempts: [], videoProgress: [], componentProgress: [], totalExpectedOtjh: 132,
  },
  journey: [],
  peers: [],
  displayName: 'Aya Khater',
  initials: 'AK',
  programme: 'Final Test',
  employer: 'Test Employer',
  cohort: 'Final Cohort',
  group: 'Final Group',
  email: 'aya@example.test',
  programStatus: 'Active',
  coachName: 'Test Coach',
  coachEmail: 'coach@example.test',
  employerEmail: '',
  employerPhone: '',
  overallProgress: 25,
  attendanceRate: 88,
  attendancePresentCount: 7,
  attendanceSessionCount: 10,
  attendanceAbsentCount: 3,
  otjhCompleted: 10,
  otjhTarget: 38.5,
  otjhPlanned: 132,
  ksbProgress: 20,
  ksbStatus: 'ready',
  ksbEvidencedCount: 14,
  ksbTotalCount: 40,
  mappedKsbCodes: [],
  ksbCodeProgress: [],
  ksbActivityPoints: [activityPoint()],
  evidenceCount: 3,
  startDate: '03 Aug 2026',
  gatewayReviewDate: '04 May 2027',
  plannedEndDate: '02 Aug 2027',
  totalExpectedOtjh: 132,
  touchedKsbCodes: [],
  activityItems: [],
  upcomingSessions: [],
  progressReviews: [],
  monthlyCoachMeetings: [],
  reviewGroups: [],
  reviewGenerationIssues: [],
  reviewsLoading: false,
} satisfies CoachLearnerCaseFileData;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

beforeEach(() => {
  mocks.data = caseFileData;
  // Synthetic Aptem response fixtures mirror the old test scenarios; the UI
  // must use this response, never canonical activity-point completion.
  mocks.readLearnerJson.mockReset().mockImplementation(async () => {
    if (mocks.data?.ksbStatus === 'unavailable') throw new Error('KSB components are unavailable. Please reload to try again.');
    const rows = new Map<string, { code: string; description: string; category: string; components: Array<{ name: string; status: string; achieved: boolean }>; completed: number; status: string }>();
    for (const point of mocks.data?.ksbActivityPoints || []) {
      const code = point.definitionCode || point.code;
      let row = rows.get(code);
      if (!row) {
        row = { code, description: mocks.data?.detail?.ksbs?.find(item => item.code === point.code)?.description || code,
          category: code[0] === 'K' ? 'Knowledge' : code[0] === 'S' ? 'Skills' : 'Behaviours', components: [], completed: 0, status: 'Not Achieved' };
        rows.set(code, row);
      }
      row.components.push({ name: point.title || point.activityId, status: point.completed ? 'Completed' : 'NotStarted', achieved: point.completed });
      row.completed += Number(point.completed);
      row.status = row.completed ? 'Achieved' : 'Not Achieved';
    }
    return { rows: [...rows.values()] };
  });
  mocks.fetchKsbProfile.mockReset().mockResolvedValue({ knowledge: [], skills: [], behaviours: [] });
  mocks.coachFetch.mockReset();
  mocks.refresh.mockReset();
  mocks.useCaseFileDashboardPlan.mockReset().mockReturnValue({});
  mocks.attendanceRetry.mockReset();
  mocks.useCaseFileAttendance.mockReset().mockReturnValue({
    data: {
      learnerEmail: 'aya@example.test', learnerId: 125, learnerName: 'Aya Khater', sessions: 10, present: 7,
      absent: 3, late: 0, catchup: 0, risk: 'amber', lastSessionDate: '2026-09-20', consecutiveMissed: 0,
      updatedAt: null, attendanceRate: 70, sessionHistory: [],
    },
    loading: false, error: null, retry: mocks.attendanceRetry, invalidate: mocks.attendanceRetry,
  });
  mocks.reviewsRetry.mockReset();
  mocks.useCaseFileReviews.mockReset().mockImplementation(() => ({
    data: { groups: mocks.data?.reviewGroups || [], issues: mocks.data?.reviewGenerationIssues || [] },
    nextMeetings: { pr: '10 Oct 2026 Ãƒâ€šÃ‚Â· 10:00', mcm: '12 Oct 2026 Ãƒâ€šÃ‚Â· 09:30' },
    loading: Boolean(mocks.data?.reviewsLoading), error: null, retry: mocks.reviewsRetry, invalidate: mocks.reviewsRetry,
  }));
  mocks.useCaseFileNextSession.mockReset().mockReturnValue({ data: null, loading: false, error: null, retry: vi.fn(), invalidate: vi.fn() });
  mocks.markingRetry.mockReset();
  mocks.useCaseFileMarking.mockReset().mockReturnValue({ data: { items: [], serializedItemCount: 0 }, loading: false, error: null, retry: mocks.markingRetry, invalidate: mocks.markingRetry });
});

describe('Learner Case File design', () => {
  it('keeps the selected table activity counts when the independent profile read differs', () => {
    mocks.data = { ...caseFileData, activitiesCompleted: 157, activitiesTotal: 157, overallProgress: 100 };
    render(<MemoryRouter initialEntries={[{ pathname: '/coach/learner-case-file', state: {
      learnerId: '42', activitySnapshot: { learnerId: '42', completed: 137, total: 157, percent: 87.26 },
    } }]}><LearnerCaseFile /></MemoryRouter>);
    expect(screen.getByTestId('activity-snapshot')).toHaveTextContent('137/157 Ãƒâ€šÃ‚Â· 87.26%');
  });

  it('does not reuse another learner table snapshot when a query selects this learner', () => {
    mocks.data = { ...caseFileData, activitiesCompleted: 3, activitiesTotal: 4, overallProgress: 75 };
    render(<MemoryRouter initialEntries={[{ pathname: '/coach/learner-case-file', search: '?id=42', state: {
      learnerId: '99', activitySnapshot: { learnerId: '99', completed: 137, total: 157, percent: 87.26 },
    } }]}><LearnerCaseFile /></MemoryRouter>);
    expect(screen.getByTestId('activity-snapshot')).toHaveTextContent('3/4 Ãƒâ€šÃ‚Â· 75%');
  });

  it('preserves unavailable table activity counts rather than substituting a different read', () => {
    mocks.data = { ...caseFileData, activitiesCompleted: 157, activitiesTotal: 157, overallProgress: 100 };
    render(<MemoryRouter initialEntries={[{ pathname: '/coach/learner-case-file', state: {
      learnerId: '42', activitySnapshot: { learnerId: '42', completed: null, total: null, percent: null },
    } }]}><LearnerCaseFile /></MemoryRouter>);
    expect(screen.getByTestId('activity-snapshot')).toHaveTextContent('null/null Ãƒâ€šÃ‚Â· null%');
  });

  it('preserves learner identity and dates without the five summary cards', () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Aya Khater', level: 1 })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Learner profile summary' });
    for (const metric of ['Overall', 'OTJH (Actual / Target)', 'KSB', 'Attendance', 'Gateway']) {
      expect(within(summary).queryByText(metric, { selector: 'span' })).not.toBeInTheDocument();
    }
    expect(within(summary).queryByText('7 / 10', { selector: 'strong' })).not.toBeInTheDocument();
    for (const metric of ['PR', 'MCM', 'Next session']) {
      expect(within(summary).queryByText(metric, { exact: true })).not.toBeInTheDocument();
    }
    expect(within(summary).queryByLabelText('Next Progress Review')).not.toBeInTheDocument();
    expect(within(summary).queryByLabelText('Next Monthly Coaching Meeting')).not.toBeInTheDocument();
    expect(mocks.useCaseFileReviews).toHaveBeenCalledWith('42', true, false);
    expect(within(summary).queryByText('Absences')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Profile Snapshot')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Profile details')).not.toBeInTheDocument();
    expect(summary.querySelector('details')).toBeNull();
    for (const field of ['Start Date', 'Planned End Date']) {
      expect(within(summary).getByText(field)).toBeInTheDocument();
    }
    expect(within(summary).queryByText('Gateway Due')).not.toBeInTheDocument();
    for (const value of ['Final Test', 'Final Group', 'aya@example.test', '03 Aug 2026', '02 Aug 2027']) {
      expect(within(summary).getByText(value)).toBeInTheDocument();
    }
    for (const removedSection of ['Progress Summary', 'Recent Activity', 'Upcoming Sessions & Reviews']) {
      expect(screen.queryByRole('heading', { name: removedSection })).not.toBeInTheDocument();
    }
    for (const activitySection of ['Whole programme progress', 'Programme progress']) {
      expect(screen.getByRole('heading', { name: activitySection })).toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Off-The-Job Hours' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Coach learner activity overview').closest('.learner-dashboard')).not.toBeNull();
    const caseFileSections = screen.getByRole('tablist', { name: 'Case file sections' });
    expect(within(caseFileSections).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('heading', { name: 'Weekly learning plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Monthly study plan' })).not.toBeInTheDocument();
    expect(screen.getByText('25% Ãƒâ€šÃ‚Â· 10/38.5 Ãƒâ€šÃ‚Â· 20% Ãƒâ€šÃ‚Â· 7/10')).toBeInTheDocument();
    expect(screen.getByText('Activity overview only')).toBeInTheDocument();
    expect(screen.getByText('Rewards hidden')).toBeInTheDocument();
    expect(screen.getByTestId('overview-otjh-chart')).toHaveTextContent('OTJH chart hidden');

    fireEvent.click(within(caseFileSections).getByRole('tab', { name: 'Weekly Learning' }));
    expect(screen.getByRole('heading', { name: 'Weekly learning plan' })).toBeVisible();
    expect(screen.getByTestId('weekly-actions')).toHaveTextContent('Learner actions hidden');
    expect(within(caseFileSections).getByRole('tab', { name: 'Weekly Learning' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(caseFileSections).getByRole('tab', { name: 'Monthly Focus' }));
    expect(screen.getByRole('heading', { name: 'Monthly study plan' })).toBeVisible();
    expect(screen.getByTestId('activity-actions')).toHaveTextContent('Learner actions hidden');
    expect(within(caseFileSections).getByRole('tab', { name: 'Monthly Focus' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.useCaseFileDashboardPlan).toHaveBeenCalledWith('apprenticeship', '125', true, true, 'overview');
    // Overview, Weekly Learning, Monthly Focus, OTJH & KSB Progress, Attendance,
    // Learning Plan, Reviews, Assignments and Enrolment Documents.
    expect(screen.getAllByRole('tab')).toHaveLength(9);
    expect(screen.getByRole('tab', { name: 'Assignments' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Enrolment Documents' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Programme & Employer' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reviews' })).toBeInTheDocument();
  });

  it('shows learner review summaries, classification, filters, canonical dates and only available actions', () => {
    const completedReview = {
      id: 'review-1', eventKey: 'review-1', reviewInstanceId: 'instance-1', source: 'mcr',
      reviewTypeCode: 'mcm', reviewTypeName: 'Progress Review', title: 'Progress Review', date: '10 Sep 2026', plannedDate: '08 Sep 2026',
      scheduledDate: '10 Sep 2026', scheduledTime: '10:00', completedDate: '10 Sep 2026',
      time: '10:00', detail: '', status: 'completed', statusLabel: 'Completed',
      isNext: false, reviewer: 'Test Coach', hasForm: true, hasTranscript: false, hasAttendance: true,
    } satisfies CaseFileReviewMeeting;
    const upcomingMeeting = {
      id: 'meeting-1', eventKey: 'meeting-1', source: 'mcr', reviewTypeName: 'Monthly Coaching Meeting',
      reviewTypeCode: 'mcm',
      title: 'Monthly Coaching Meeting', date: '02 Oct 2026', plannedDate: '28 Sep 2026',
      scheduledDate: '02 Oct 2026', scheduledTime: '09:00', completedDate: '--',
      time: '09:00', detail: '', status: 'confirmed', statusLabel: 'Confirmed', isNext: true,
      reviewer: 'Test Coach', hasForm: false, hasTranscript: false, hasAttendance: false,
    } satisfies CaseFileReviewMeeting;
    const customReview = {
      id: 'career-1', eventKey: 'career-1', source: 'review', reviewTypeCode: 'career_review',
      reviewTypeName: 'Career Review', title: 'Career Review', date: '30 Sep 2026', plannedDate: '30 Sep 2026',
      scheduledDate: '30 Sep 2026', scheduledTime: '11:00', completedDate: '--',
      time: '11:00', detail: '', status: 'scheduled', statusLabel: 'Scheduled', isNext: false,
      reviewer: 'Test Coach', hasForm: false, hasTranscript: false, hasAttendance: false,
    } satisfies CaseFileReviewMeeting;
    mocks.data = {
      ...caseFileData,
      progressReviews: [completedReview],
      monthlyCoachMeetings: [upcomingMeeting],
      reviewGroups: [
        { key: 'progress review', title: 'Progress Review', items: [completedReview] },
        { key: 'monthly coaching meeting', title: 'Monthly Coaching Meeting', items: [upcomingMeeting] },
        { key: 'career review', title: 'Career Review', items: [customReview] },
      ],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=reviews']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.getByLabelText('Review summary')).toHaveTextContent('3Total Reviews');
    expect(screen.getByLabelText('Review summary')).toHaveTextContent('1Progress Reviews');
    expect(screen.getByLabelText('Review summary')).toHaveTextContent('1Monthly Coaching Meetings');
    expect(screen.getByRole('cell', { name: '08 Sep 2026' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '10 Sep 2026' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Scheduled Date & Time' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '02 Oct 2026 at 09:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Attendance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Transcript' })).not.toBeInTheDocument();

    const typeFilters = within(screen.getByLabelText('Review type filters'));
    const statusFilters = within(screen.getByLabelText('Review status filters'));
    fireEvent.click(typeFilters.getByRole('button', { name: 'Monthly Coaching Meeting' }));
    expect(screen.getByText('Monthly Coaching Meeting', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByText('Progress Review', { selector: 'td' })).not.toBeInTheDocument();
    expect(screen.queryByText('Career Review', { selector: 'td' })).not.toBeInTheDocument();
    fireEvent.click(typeFilters.getByRole('button', { name: 'Progress Review' }));
    expect(screen.getByText('Progress Review', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByText('Monthly Coaching Meeting', { selector: 'td' })).not.toBeInTheDocument();
    fireEvent.click(typeFilters.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Career Review', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByText('Progress Review', { selector: 'td' })).not.toBeInTheDocument();
    expect(screen.queryByText('Monthly Coaching Meeting', { selector: 'td' })).not.toBeInTheDocument();

    // Switching back from the generic Review filter must not leak the PR group
    // into the MCM results, even when the row carries stale MCM code metadata.
    fireEvent.click(typeFilters.getByRole('button', { name: 'Monthly Coaching Meeting' }));
    expect(screen.queryByText('Progress Review', { selector: 'td' })).not.toBeInTheDocument();
    expect(screen.getByText('Monthly Coaching Meeting', { selector: 'td' })).toBeInTheDocument();

    fireEvent.click(typeFilters.getByRole('button', { name: 'All' }));
    fireEvent.click(statusFilters.getByRole('button', { name: 'Completed' }));
    expect(screen.getByText('Progress Review', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByText('Monthly Coaching Meeting', { selector: 'td' })).not.toBeInTheDocument();
    expect(screen.queryByText('Career Review', { selector: 'td' })).not.toBeInTheDocument();
    fireEvent.click(statusFilters.getByRole('button', { name: 'Upcoming' }));
    expect(screen.getByText('Monthly Coaching Meeting', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('Career Review', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByText('Progress Review', { selector: 'td' })).not.toBeInTheDocument();
  });

  it('opens the requested imported review form instead of the general review history', () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&kind=apprenticeship&enrolmentId=125&tab=reviews&reviewId=A72']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.getByTestId('imported-review-form')).toHaveTextContent('apprenticeship:125:reviews:A72');
    expect(screen.queryByRole('heading', { name: 'Review History' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Review summary')).not.toBeInTheDocument();
  });

  it('does not leak a mixed Progress Review row from an MCM group', () => {
    const mcm = {
      id: 'mcm-1', eventKey: 'mcm-1', source: 'mcr', reviewTypeCode: 'mcm',
      reviewTypeName: 'Monthly Coaching Meeting', title: 'Monthly Coaching Meeting',
      date: '02 Oct 2026', plannedDate: '28 Sep 2026', scheduledDate: '02 Oct 2026', scheduledTime: '09:00',
      completedDate: '--', time: '09:00', detail: '', status: 'scheduled', statusLabel: 'Scheduled',
      isNext: false, reviewer: 'Test Coach', hasForm: false, hasTranscript: false, hasAttendance: false,
    } satisfies CaseFileReviewMeeting;
    const leakedProgress = { ...mcm, id: 'pr-leaked', eventKey: 'pr-leaked', reviewTypeCode: 'progress_review', reviewTypeName: 'Progress Review', title: 'Progress Review', source: 'progress-review' } satisfies CaseFileReviewMeeting;
    mocks.data = { ...caseFileData, reviewGroups: [{ key: 'monthly coaching meeting', title: 'Monthly Coaching Meeting', items: [mcm, leakedProgress] }] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=reviews']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(within(screen.getByLabelText('Review type filters')).getByRole('button', { name: 'Monthly Coaching Meeting' }));
    expect(screen.getByText('Monthly Coaching Meeting', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByText('Progress Review', { selector: 'td' })).not.toBeInTheDocument();
  });

  it('keeps the reviews loading skeleton distinct from the empty state', () => {
    mocks.data = { ...caseFileData, reviewsLoading: true };
    const { rerender } = render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=reviews']}><LearnerCaseFile /></MemoryRouter>);
    expect(screen.getByLabelText('Loading reviews')).toBeInTheDocument();
    expect(screen.queryByText('No reviews found for this learner.')).not.toBeInTheDocument();

    mocks.data = { ...caseFileData, reviewsLoading: false };
    rerender(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=reviews']}><LearnerCaseFile /></MemoryRouter>);
    expect(screen.getByText('No reviews found for this learner.')).toBeInTheDocument();
  });

  it('paginates filtered review history in ten-row pages and resets filters to page one', () => {
    const reviews = Array.from({ length: 36 }, (_, index): CaseFileReviewMeeting => ({
      id: `review-${index + 1}`,
      eventKey: `review-${index + 1}`,
      source: index < 8 ? 'progress-review' : 'mcr',
      reviewTypeName: index < 8 ? 'Progress Review' : 'Monthly Coaching Meeting',
      title: `Review ${index + 1}`,
      date: `${String(index + 1).padStart(2, '0')} Sep 2026`,
      plannedDate: `${String(index + 1).padStart(2, '0')} Sep 2026`,
      scheduledDate: `${String(index + 1).padStart(2, '0')} Sep 2026`,
      scheduledTime: '09:00',
      completedDate: '--',
      time: '09:00',
      detail: '',
      status: 'scheduled',
      statusLabel: 'Scheduled',
      isNext: false,
      reviewer: `Reviewer ${index + 1}`,
      hasForm: false,
      hasTranscript: false,
      hasAttendance: false,
    }));
    mocks.data = {
      ...caseFileData,
      reviewGroups: [
        { key: 'all reviews', title: 'Reviews', items: reviews },
      ],
    };

    const { rerender } = render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=reviews']}><LearnerCaseFile /></MemoryRouter>);

    const table = screen.getByRole('table');
    const pagination = screen.getByRole('navigation', { name: 'Review pagination' });
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    expect(pagination).toHaveTextContent('Showing 1-10 of 36 reviews');
    expect(within(pagination).getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeEnabled();
    for (const pageNumber of [1, 2, 3, 4]) {
      expect(within(pagination).getByRole('button', { name: `Go to page ${pageNumber}` })).toBeVisible();
    }

    fireEvent.click(within(pagination).getByRole('button', { name: 'Go to page 4' }));
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(pagination).toHaveTextContent('Showing 31-36 of 36 reviews');
    expect(within(pagination).getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeDisabled();

    mocks.data = {
      ...caseFileData,
      reviewGroups: [{ key: 'all reviews', title: 'Reviews', items: reviews.slice(0, 12) }],
    };
    rerender(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=reviews']}><LearnerCaseFile /></MemoryRouter>);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(pagination).toHaveTextContent('Showing 11-12 of 12 reviews');
    expect(within(pagination).getByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Progress Review' }));
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    expect(screen.queryByRole('navigation', { name: 'Review pagination' })).not.toBeInTheDocument();
    expect(screen.getByText('Reviewer 1')).toBeVisible();
  });

  it('keeps the KSB card absent and preserves unavailable canonical status', async () => {
    mocks.data = { ...caseFileData, ksbStatus: 'unavailable', ksbProgress: null, touchedKsbCodes: ['K1'] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    const summary = screen.getByRole('region', { name: 'Learner profile summary' });
    expect(within(summary).queryByText('KSB', { selector: 'span' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await screen.findByText('KSB components are unavailable. Please reload to try again.');
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('--');
  });

  it('switches between the redesigned progress and learning plan views', async () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    expect(screen.getByRole('heading', { name: 'Off-the-Job Hours (OTJH)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'KSB Detailed Breakdown' })).toBeInTheDocument();
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('1');
    for (const label of ['KSB Code', 'Category', 'Status', 'Activities']) {
      expect(screen.getByRole('button', { name: `Sort by ${label}` }).querySelector('svg')).toBeInTheDocument();
    }
    expect(screen.getByRole('table').querySelector('.lucide-circle')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by KSB Code' }));
    expect(screen.getByRole('columnheader', { name: 'KSB Code' })).toHaveAttribute('aria-sort', 'descending');

    fireEvent.click(screen.getByRole('tab', { name: 'Learning Plan' }));
    expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Module timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Programme Journey' })).toBeInTheDocument();
    for (const metric of ['Overall Progress', 'Actual', 'Planned', 'Mapped KSBs']) {
      expect(within(screen.getByRole('tabpanel')).queryByText(metric, { selector: 'span' })).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Evidence Count', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('No notes yet')).not.toBeInTheDocument();
  });

  it('uses grouped Browser totals and completed group statuses despite conflicting raw totals', async () => {
    const ksbs = [
      ...Array.from({ length: 6 }, (_, index) => ({ code: `K${index + 1}`, type: 'Knowledge', number: String(index + 1), description: `Knowledge ${index + 1}` })),
      ...Array.from({ length: 4 }, (_, index) => ({ code: `S${index + 1}`, type: 'Skills', number: String(index + 1), description: `Skill ${index + 1}` })),
      ...Array.from({ length: 4 }, (_, index) => ({ code: `B${index + 1}`, type: 'Behaviours', number: String(index + 1), description: `Behaviour ${index + 1}` })),
    ];
    const totals = [4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2];
    mocks.data = {
      ...caseFileData,
      detail: { ...caseFileData.detail, ksbs },
      mappedKsbCodes: ksbs.map((item) => item.code),
      touchedKsbCodes: ksbs.slice(0, 10).map((item) => item.code),
      ksbCodeProgress: ksbs.map((item, index) => ({ code: item.code, completed: 1, total: totals[index] })),
      ksbTotalCount: 40,
      ksbProgress: 35,
      ksbActivityPoints: ksbs.flatMap((item, index) => Array.from({ length: totals[index] }, (_, pointIndex) =>
        activityPoint(item.code, `activity-${index}-${pointIndex}`, index === 0 || index === 6 || index === 10 || pointIndex === 0))),
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('14');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('14');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('0');
    expect(screen.getAllByText('Knowledge')[0].parentElement).toHaveTextContent('6 / 6');
    expect(screen.getByRole('button', { name: 'All (14)' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(11);
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(15);
    expect(screen.getByRole('button', { name: 'Knowledge (6)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skills (4)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Behaviours (4)' })).toBeInTheDocument();
    expect(screen.getAllByText('Skills')[0].parentElement).toHaveTextContent('4 / 4');
    expect(screen.getAllByText('Behaviours')[0].parentElement).toHaveTextContent('4 / 4');
    expect(screen.getAllByText('Knowledge')[0].closest('[data-category]')).toHaveTextContent('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Skills (4)' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search KSBs' }), { target: { value: 'S1' } });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('14');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('14');

  });

  it('combines grouped status, category and search filters without changing totals or evidence', async () => {
    mocks.data = { ...caseFileData, ksbActivityPoints: [
      activityPoint('K1', 'k1-a', true), activityPoint('K1', 'k1-b', true),
      activityPoint('K2', 'k2-a', true), activityPoint('K2', 'k2-b', false),
      activityPoint('B1', 'b1-a', true, 'Completed behaviour activity'),
      activityPoint('B1', 'b1-b', false, 'Pending behaviour activity'),
      activityPoint('B2', 'b2-a', false), activityPoint('S1', 's1-a', true),
    ] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    const status = screen.getByRole('combobox', { name: 'Filter KSB status' });
    const codes = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(status).toHaveTextContent('All Status');
    const selectStatus = (name: string) => {
      fireEvent.click(status);
      const menu = screen.getByRole('listbox');
      expect(within(menu).getAllByRole('option')).toHaveLength(3);
      fireEvent.click(within(menu).getByRole('option', { name }));
      expect(status).toHaveTextContent(name);
      expect(status).toHaveAttribute('aria-expanded', 'false');
    };
    expect(codes()).toEqual(['B1', 'B2', 'K1', 'K2', 'S1']);

    selectStatus('Achieved');
    expect(codes()).toEqual(['B1', 'K1', 'K2', 'S1']);
    fireEvent.click(screen.getByRole('button', { name: 'Behaviours (2)' }));
    expect(codes()).toEqual(['B1']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search KSBs' }), { target: { value: 'Pending behaviour activity' } });
    expect(codes()).toEqual(['B1']);
    expect(within(screen.getByRole('table')).getByText('1 completed components')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Completed behaviour activity')).toBeInTheDocument();
    expect(within(dialog).getByText('Pending behaviour activity')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close evidence' }));

    fireEvent.click(screen.getByRole('button', { name: 'Knowledge (2)' }));
    expect(screen.getByText('No KSB components matched the current filter.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search KSBs' }), { target: { value: '' } });
    selectStatus('Achieved');
    expect(codes()).toEqual(['K1', 'K2']);
    fireEvent.click(screen.getByRole('button', { name: 'All (5)' }));
    expect(codes()).toEqual(['B1', 'K1', 'K2', 'S1']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by KSB Code' }));
    expect(codes()).toEqual(['S1', 'K2', 'K1', 'B1']);
    selectStatus('All Status');
    expect(codes()).toEqual(['S1', 'K2', 'K1', 'B2', 'B1']);
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('5');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('1');
  });

  it('groups by the real detailed code without an Activity ID in the code cell', async () => {
    mocks.data = { ...caseFileData, ksbActivityPoints: [
      { ...activityPoint('B1', 'activity-b', true), ksbDefinitionId: '101', definitionCode: 'B1.1' },
      activityPoint('K2.3', 'activity-k', false),
      { ...activityPoint('S4', 'activity-s', false), ksbDefinitionId: '303', definitionCode: 'S4.1' },
      activityPoint('B1', 'activity-parent', false),
    ] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    const labels = rows.map(row => {
      const cell = within(row).getAllByRole('cell')[0];
      expect(cell).not.toHaveTextContent('Activity');
      expect(cell).not.toHaveTextContent('activity-');
      return Array.from(cell.querySelectorAll('strong, span')).map(node => node.textContent);
    });
    expect(labels).toEqual(expect.arrayContaining([['B1.1'], ['K2.3'], ['S4.1'], ['B1']]));
    expect(within(screen.getByRole('table')).getAllByRole('button', { name: 'View' })).toHaveLength(4);
  });

  it('does not turn a 58-code framework into fabricated activity points', async () => {
    const profileShape: Record<string, number> = {
      B1: 3, B2: 3, B3: 3, B4: 4,
      K1: 6, K2: 5, K3: 4, K4: 3,
      S1: 4, S2: 4, S3: 3, S4: 3, S5: 3, S6: 5, S7: 2, S8: 3,
    };
    const ksbs = Object.entries(profileShape).flatMap(([parent, count]) => (
      Array.from({ length: count }, (_, index) => {
        const code = index === 0 ? parent : `${parent}.${index}`;
        return {
          code,
          type: parent.startsWith('K') ? 'Knowledge' : parent.startsWith('S') ? 'Skills' : 'Behaviours',
          number: code.slice(1),
          description: index === 0 ? `${parent} parent title` : `${parent} child ${index}`,
        };
      })
    ));
    mocks.data = {
      ...caseFileData,
      detail: { ...caseFileData.detail, ksbs },
      ksbStatus: 'unavailable',
      ksbProgress: null,
      ksbEvidencedCount: null,
      ksbTotalCount: null,
      mappedKsbCodes: [],
      touchedKsbCodes: ['K1', 'K2', 'K3', 'K4', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    const header = screen.getByRole('region', { name: 'Learner profile summary' });
    expect(within(header).queryByText('KSB', { selector: 'span' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await screen.findByText('KSB components are unavailable. Please reload to try again.');
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent('--');
    expect(screen.getByText('Achieved KSBs').parentElement).toHaveTextContent('--');
    expect(screen.getByText('Remaining KSBs').parentElement).toHaveTextContent('--');
    expect(screen.getByRole('button', { name: 'All (0)' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('KSB components are unavailable. Please reload to try again.')).toBeInTheDocument();
  });

  it('keeps child points separate and opens only their own activity details', async () => {
    mocks.data = { ...caseFileData, ksbActivityPoints: [
      activityPoint('B1', 'activity-1', true, 'Accepted journal'),
      activityPoint('B1.1', 'activity-2', false, 'Pending activity'),
    ] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    const first = screen.getByText('B1', { selector: 'span' }).closest('tr')!;
    const second = screen.getByText('B1.1', { selector: 'span' }).closest('tr')!;
    expect(within(first).getByText('Achieved')).toBeInTheDocument();
    expect(within(second).getByText('Not Achieved')).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Accepted journal')).toBeInTheDocument();
    expect(within(dialog).queryByText('Pending activity')).not.toBeInTheDocument();
  });

  it('keeps a point incomplete even when another activity evidenced the same code', async () => {
    mocks.data = { ...caseFileData, touchedKsbCodes: ['K1'], ksbActivityPoints: [activityPoint('K1', 'pending')] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    expect(within(screen.getByRole('table')).getByText('Not Achieved')).toBeInTheDocument();
  });

  it('shows completed components out of the weekly total and omits recent assessments', () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        componentProgress: [{
          kind: 'component',
          componentType: 'reading',
          componentId: 'reading-1',
          startedAt: '2026-09-17T09:30:00Z',
          submittedAt: '2026-09-17T10:00:00Z',
          timeTaken: '00:30',
        }],
      },
      journey: [{
        module: 'Marketing Impact and Planning',
        weeks: [{
          week: 'Marketing Definitions',
          otjh: 1,
          components: [
            { title: 'Completed reading', componentId: 'reading-1', type: 'reading', expectedOtjh: 0.5 },
            { title: 'Pending podcast', componentId: 'podcast-1', type: 'podcast', expectedOtjh: 0.5 },
          ],
        }],
      }],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'Learning Plan' }));

    expect(screen.getByText('1 / 2 completed')).toBeInTheDocument();
    expect(screen.getByText('1 / 2', { selector: 'span' }).parentElement).toHaveTextContent('Completed');
    expect(screen.queryByRole('heading', { name: 'Recent Assessments' })).not.toBeInTheDocument();
  });

  it('shows the linked learning activity type and full title for a KSB', async () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        components: [
          { module: 'Module 1', week: 'Week 1', component: 'Leadership and responsible decision making quiz', expectedOtjh: null, componentId: 'quiz-1', type: 'quiz', isQuiz: true, ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] },
        ],
      },
      touchedKsbCodes: ['K1'],
      ksbActivityPoints: [activityPoint('K1', 'quiz-1', true, 'Leadership and responsible decision making quiz', 'Quiz')],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Component')).toBeInTheDocument();
    expect(within(dialog).getByText('Leadership and responsible decision making quiz')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Understand the organisation' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/evidence item linked/i)).not.toBeInTheDocument();
  });

  it('opens evidence details directly with all grouped activities even when searching for one activity', async () => {
    mocks.data = { ...caseFileData, ksbActivityPoints: [
      activityPoint('K1', 'assignment-1', true, 'Assignment 1'),
      activityPoint('K1', 'assignment-2', false, 'Assignment 2'),
    ] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['KSB Code', 'Category', 'Status', 'Activities', 'Progress', 'View']);
    expect(within(table).queryByRole('button', { name: 'Sort by Title' })).not.toBeInTheDocument();
    expect(within(table).getAllByRole('cell')).toHaveLength(6);
    expect(within(table).queryByText('Understand the organisation')).not.toBeInTheDocument();
    expect(within(table).getByText('1 completed components')).toBeInTheDocument();
    expect(within(table).getByText('Achieved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand|Collapse/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search KSBs'), { target: { value: 'Understand the organisation' } });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Search KSBs'), { target: { value: 'Assignment 2' } });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).queryByText('Assignment 2')).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Understand the organisation' })).toBeInTheDocument();
    expect(within(dialog).getByText('Knowledge')).toBeInTheDocument();
    expect(within(dialog).getByText('KSB Evidence Details')).toBeInTheDocument();
    expect(within(dialog).getByText('2 components')).toBeInTheDocument();
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Status: Completed')).toBeInTheDocument();
    expect(within(dialog).getByText('Status: NotStarted')).toBeInTheDocument();
    expect(within(dialog).getByText('Assignment 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Assignment 2')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getByText('Assignment 1')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Assignment 2')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('closes KSB evidence details with X, Escape or backdrop and keeps browser state', async () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    fireEvent.change(screen.getByLabelText('Search KSBs'), { target: { value: 'K1' } });
    const trigger = screen.getByRole('button', { name: 'View' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close evidence' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close evidence' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close evidence' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search KSBs')).toHaveValue('K1');
    expect(screen.getByRole('tab', { name: 'OTJH & KSB Progress' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows completed activity metadata from the canonical points API', async () => {
    mocks.data = {
      ...caseFileData,
      snapshot: {
        ...caseFileData.snapshot,
        ksbCompletedDetails: [{
          code: 'K1',
          type: 'Knowledge',
          description: 'Understand the organisation',
          sources: [{
            id: 'component:workplace-evidence-1',
            title: 'Workplace marketing evidence',
            typeLabel: 'Assignment',
            kind: 'assignment',
          }],
        }],
      },
      detail: { ...caseFileData.detail, components: [] },
      touchedKsbCodes: ['K1'],
      ksbActivityPoints: [activityPoint('K1', 'workplace-1', true, 'Workplace marketing evidence')],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    const ksbRow = screen.getByText('K1', { selector: 'span' }).closest('tr');
    expect(ksbRow).not.toBeNull();
    expect(within(ksbRow!).getByText('Achieved')).toBeInTheDocument();

    fireEvent.click(within(ksbRow!).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Component')).toBeInTheDocument();
    expect(within(dialog).getByText('Workplace marketing evidence')).toBeInTheDocument();
    expect(within(dialog).queryByText(/No linked learning activity/i)).not.toBeInTheDocument();
  });

  it('does not render upcoming reviews in the removed overview section', () => {
    mocks.data = {
      ...caseFileData,
      upcomingSessions: [{
        id: 'review-1',
        kind: 'review',
        status: 'scheduled',
        statusLabel: 'Scheduled',
        day: 'Monday',
        title: 'Quarterly Progress Review',
        date: '21 Sep 2026',
        time: '10:00',
        summary: 'Mon 21 Sep Ãƒâ€šÃ‚Â· 10:00',
        detail: 'Progress Review',
      }],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.queryByText('Quarterly Progress Review')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Upcoming Sessions & Reviews' })).not.toBeInTheDocument();
  });

  it('shows outstanding absences in the summary and filters the session table', async () => {
    mocks.data = {
      ...caseFileData,
      attendancePresentCount: 1,
      attendanceSessionCount: 1,
      attendanceAbsentCount: 0,
      attendance: {
        id: '42', learner: 'Aya Khater', initials: 'AK', email: 'aya@example.test', programme: 'Final Test',
        cohort: 'Final Cohort', group: 'Final Group', attendance: 50, sessions: 4, present: 2, absent: 2,
        late: 0, catchup: 1, trend: 'stable', risk: 'amber', employer: 'Test Employer', overallProgress: 25,
        otjhCompleted: 10, otjhTarget: 38.5, ksbProgress: 20, lastSession: '--', nextSession: '--',
        consecutiveMissed: 2, hasAttendance: true,
      },
    };
    mocks.useCaseFileAttendance.mockReturnValue({
      data: {
        learnerEmail: 'aya@example.test', learnerId: 125, learnerName: 'Aya Khater', sessions: 4, present: 2,
        absent: 2, late: 0, catchup: 0, risk: 'amber', lastSessionDate: '2026-09-14', consecutiveMissed: 1,
        updatedAt: null, attendanceRate: 50,
        sessionHistory: [
          { id: 'session-2', date: '2026-09-14', title: 'Attended session', sessionType: 'live_session', status: 'attended', startTime: '11:00', endTime: '12:00', module: '', coach: '' },
          { id: 'session-1', date: '2026-09-07', title: 'Still missed', sessionType: 'live_session', status: 'missed', startTime: '11:00', endTime: '12:00', module: '', coach: '' },
        ],
      },
      loading: false, error: null, retry: mocks.attendanceRetry, invalidate: mocks.attendanceRetry,
    });

    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Attendance' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Attendance Breakdown' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Missed Sessions' })).not.toBeInTheDocument();
    expect(screen.getByText('Attendance', { selector: 'p' }).previousElementSibling).toHaveTextContent('2 / 4');
    expect(screen.getByText('Total Sessions').previousElementSibling).toHaveTextContent('4');
    expect(screen.getByText('Attended', { selector: 'p' }).previousElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Outstanding Absences').previousElementSibling).toHaveTextContent('2');
    expect(screen.getByText('2 of 2 sessions')).toBeInTheDocument();
    expect(screen.getByText('Still missed')).toBeInTheDocument();
    expect(screen.getByText('Attended session')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'absent' } });
    expect(screen.getByText('1 of 2 sessions')).toBeInTheDocument();
    expect(screen.getByText('Still missed')).toBeInTheDocument();
    expect(screen.queryByText('Attended session')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'missing title' } });
    expect(screen.getByText('No sessions match the selected filters.')).toBeInTheDocument();
  });

  it('paginates KSB points and resets the page when search, category, sort or size changes', async () => {
    mocks.data = {
      ...caseFileData,
      ksbActivityPoints: Array.from({ length: 31 }, (_, index) => activityPoint(index === 30 ? 'B1' : `K${index + 1}`, `point-${index}`, true, `Activity ${String(index + 1).padStart(2, '0')}`)),
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Activities' }));
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
    expect(within(table).getByText('K1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(within(table).queryByText('Activity 01')).not.toBeInTheDocument();
    fireEvent.click(within(table).getAllByRole('button', { name: 'View' })[0]);
    expect(within(screen.getByRole('dialog')).getByText('Activity 10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close evidence' }));
    fireEvent.change(screen.getByLabelText('Search KSBs'), { target: { value: 'Activity 31' } });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('B1', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search KSBs'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Behaviours (1)' }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'All (31)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
    expect(within(table).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search KSBs'), { target: { value: 'no matching activity' } });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('keeps mapped Aptem components in the same-page popup', async () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        components: [
          { module: 'Module 1', week: 'Week 1', component: 'Assignment 2', expectedOtjh: null, componentId: 'assignment-2', type: 'assignment', ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] },
        ],
      },
      touchedKsbCodes: ['K1'],
      ksbActivityPoints: [{ ...activityPoint('K1', 'assignment-2', true, 'Assignment 2'), componentId: 'assignment-2' }],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LocationProbe /><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(within(screen.getByRole('dialog')).getByText('Assignment 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Details' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/coach/learner-case-file?id=42');
  });

  it('shows mapped components without navigating to canonical journal records', async () => {
    mocks.data = { ...caseFileData, ksbActivityPoints: [{ ...activityPoint('K1', 'source-2', true, 'Recorded reading'), componentId: 'journal:12', activityId: '2', source: 'journal' }] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LocationProbe /><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(within(screen.getByRole('dialog')).getByText('Recorded reading')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/coach/learner-case-file?id=42');
  });

  it('keeps View available for a KSB without evidence', async () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        components: [
          { module: 'Module 1', week: 'Week 1', component: 'Assignment 2', expectedOtjh: null, componentId: 'assignment-2', type: 'assignment', ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] },
        ],
      },
      mappedKsbCodes: ['K1'],
      touchedKsbCodes: [],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LocationProbe /><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    await waitFor(() => expect(screen.getByText('Total KSBs').parentElement).toHaveTextContent(mocks.data?.ksbStatus === 'unavailable' ? '--' : /\d/));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add evidence' })).not.toBeInTheDocument();
  });


  it('opens the Assignments tab for the enrolment record of the learner, from the tab bar or a link', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    expect(screen.queryByTestId('assignments-tab')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Assignments' }));
    expect(screen.getByRole('tab', { name: 'Assignments' })).toHaveAttribute('aria-selected', 'true');
    // The enrolment id, not the profile id: assignments are read from the learner's own endpoints.
    expect(screen.getByTestId('assignments-tab')).toHaveTextContent('apprenticeship:125');
    expect(mocks.useCaseFileMarking).toHaveBeenLastCalledWith('125', true);
    unmount();

    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=assignments']}><LearnerCaseFile /></MemoryRouter>);
    expect(screen.getByTestId('assignments-tab')).toBeInTheDocument();
    expect(mocks.useCaseFileMarking).toHaveBeenLastCalledWith('125', true);
  });

  it.each(['attendance', 'reviews', 'assignments'])('does not request the page-level plan on a direct %s route', (tab) => {
    render(<MemoryRouter initialEntries={[`/coach/learner-case-file?id=42&tab=${tab}`]}><LearnerCaseFile /></MemoryRouter>);

    expect(mocks.useCaseFileDashboardPlan).toHaveBeenCalledWith('apprenticeship', '125', true, false, 'overview');
  });

  it.each(['overview', 'weekly-learning', 'monthly-focus', 'progress', 'attendance', 'support', 'reviews'])('keeps marking idle on the direct %s route', (tab) => {
    render(<MemoryRouter initialEntries={[`/coach/learner-case-file?id=42&tab=${tab}`]}><LearnerCaseFile /></MemoryRouter>);
    expect(mocks.useCaseFileMarking).toHaveBeenLastCalledWith('125', false);
  });

  it.each(['weekly-learning', 'monthly-focus', 'progress'])('requests the page-level plan on the direct %s route', (tab) => {
    render(<MemoryRouter initialEntries={[`/coach/learner-case-file?id=42&tab=${tab}`]}><LearnerCaseFile /></MemoryRouter>);

    expect(mocks.useCaseFileDashboardPlan).toHaveBeenCalledWith('apprenticeship', '125', true, true, tab === 'progress' ? 'otjh-ksb' : tab);
    const tabName = tab === 'weekly-learning' ? 'Weekly Learning' : tab === 'monthly-focus' ? 'Monthly Focus' : 'OTJH & KSB Progress';
    expect(screen.getByRole('tab', { name: tabName })).toHaveAttribute('aria-selected', 'true');
  });

  it('requests the page-level plan on a direct Learning Plan route', () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=learning-plan']}><LearnerCaseFile /></MemoryRouter>);

    expect(mocks.useCaseFileDashboardPlan).toHaveBeenCalledWith('apprenticeship', '125', true, true, 'learning-plan');
    expect(screen.getByRole('tab', { name: 'Learning Plan' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps summary cards absent when metrics are unavailable', () => {
    mocks.data = {
      ...caseFileData,
      overallProgress: null,
      attendancePresentCount: null,
      attendanceSessionCount: null,
      otjhCompleted: null,
      otjhTarget: null,
      metricsAvailable: false,
      mappedKsbCodes: [],
      touchedKsbCodes: [],
    };
    mocks.useCaseFileAttendance.mockReturnValue({
      data: null, loading: false, error: null, retry: mocks.attendanceRetry, invalidate: mocks.attendanceRetry,
    });
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    const summary = screen.getByRole('region', { name: 'Learner profile summary' });
    for (const label of ['Overall', 'OTJH (Actual / Target)', 'KSB', 'Attendance']) {
      expect(within(summary).queryByText(label, { selector: 'span' })).not.toBeInTheDocument();
    }
  });

  it('reuses canonical attendance after leaving and returning to the Attendance tab', async () => {
    mocks.data = {
      ...caseFileData,
      attendance: {
        id: '42', learner: 'Aya Khater', initials: 'AK', email: 'aya@example.test', programme: 'Final Test',
        cohort: 'Final Cohort', group: 'Final Group', attendance: 100, sessions: 1, present: 1, absent: 0,
        late: 0, catchup: 0, trend: 'stable', risk: 'green', employer: 'Test Employer', overallProgress: 25,
        otjhCompleted: 10, otjhTarget: 38.5, ksbProgress: 20, lastSession: '--', nextSession: '--',
        consecutiveMissed: 0, hasAttendance: true,
      },
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'Attendance' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Attendance' }));
    expect(mocks.coachFetch).not.toHaveBeenCalled();
    expect(mocks.useCaseFileAttendance).toHaveBeenCalledWith('apprenticeship', '125', true, false);
    expect(mocks.useCaseFileAttendance).toHaveBeenLastCalledWith('apprenticeship', '125', true, true);
  });

  it('keeps the learner shell visible when the Attendance tab request fails', async () => {
    mocks.data = {
      ...caseFileData,
      attendance: {
        id: '42', learner: 'Aya Khater', initials: 'AK', email: 'aya@example.test', programme: 'Final Test',
        cohort: 'Final Cohort', group: 'Final Group', attendance: 100, sessions: 1, present: 1, absent: 0,
        late: 0, catchup: 0, trend: 'stable', risk: 'green', employer: 'Test Employer', overallProgress: 25,
        otjhCompleted: 10, otjhTarget: 38.5, ksbProgress: 20, lastSession: '--', nextSession: '--',
        consecutiveMissed: 0, hasAttendance: true,
      },
    };
    mocks.useCaseFileAttendance.mockReturnValue({
      data: null, loading: false, error: 'Attendance details unavailable',
      retry: mocks.attendanceRetry, invalidate: mocks.attendanceRetry,
    });
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Attendance' }));

    expect(await screen.findByText('Attendance details unavailable')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Aya Khater', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Learner profile summary' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry attendance' }));
    expect(mocks.attendanceRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the learner shell visible when the page-level Learning Plan load fails', () => {
    mocks.useCaseFileDashboardPlan.mockReturnValue({ error: 'Learning Plan unavailable' });
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42&tab=support']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.getByText('Learning Plan unavailable')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Aya Khater', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Learner profile summary' })).toBeInTheDocument();
  });
});
