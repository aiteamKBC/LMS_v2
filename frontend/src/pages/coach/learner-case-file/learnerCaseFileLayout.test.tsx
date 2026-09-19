import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachLearnerCaseFileData } from './data';
import LearnerCaseFile from './page';

const mocks = vi.hoisted(() => ({
  data: null as CoachLearnerCaseFileData | null,
  coachFetch: vi.fn(),
  fetchKsbProfile: vi.fn(),
  refresh: vi.fn(),
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
vi.mock('@/api/curriculum', () => ({ fetchKsbProfile: mocks.fetchKsbProfile }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));
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
  otjhCompleted: 10,
  otjhTarget: 38.5,
  otjhPlanned: 132,
  ksbProgress: 20,
  ksbEvidencedCount: 0,
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
  markingSubmissions: [],
} satisfies CoachLearnerCaseFileData;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

beforeEach(() => {
  mocks.data = caseFileData;
  mocks.fetchKsbProfile.mockReset().mockResolvedValue({ knowledge: [], skills: [], behaviours: [] });
  mocks.coachFetch.mockReset();
  mocks.refresh.mockReset();
});

describe('Learner Case File design', () => {
  it('renders the learner summary, six metrics and the new overview cards', () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Aya Khater', level: 1 })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Learner profile summary' });
    for (const metric of ['Overall', 'OTJH (Actual / Target)', 'KSB', 'Attendance', 'Gateway', 'Next session']) {
      expect(within(summary).getByText(metric, { selector: 'span' })).toBeInTheDocument();
    }
    expect(within(summary).getByText('7 / 10', { selector: 'strong' })).toBeInTheDocument();
    expect(within(summary).queryByText('Absences')).not.toBeInTheDocument();
    for (const section of ['Profile Snapshot', 'Progress Summary', 'Recent Activity', 'Upcoming Sessions & Reviews']) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Programme & Employer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Reviews & Meetings' })).not.toBeInTheDocument();
  });

  it('switches between the redesigned progress and learning plan views', () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    expect(screen.getByRole('heading', { name: 'Off-the-Job Hours (OTJH)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'KSB Detailed Breakdown' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Learning Plan' }));
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Programme Journey' })).toBeInTheDocument();
    expect(screen.getByText('Actual', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Planned', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Evidence Count', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('No notes yet')).not.toBeInTheDocument();
  });

  it('shows the linked learning activity type and full title for a KSB', () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        components: [
          { module: 'Module 1', week: 'Week 1', component: 'Leadership and responsible decision making quiz', expectedOtjh: null, componentId: 'quiz-1', type: 'quiz', isQuiz: true, ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] },
        ],
      },
      touchedKsbCodes: ['K1'],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Quiz')).toBeInTheDocument();
    expect(within(dialog).getByText('Leadership and responsible decision making quiz')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Understand the organisation' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/evidence item linked/i)).not.toBeInTheDocument();
  });

  it('shows the same Evidence count as the number of activities in the View popup', () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        components: [
          { module: 'Module 1', week: 'Week 1', component: 'Assignment 1', expectedOtjh: null, componentId: 'assignment-1', type: 'assignment', ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] },
          { module: 'Module 1', week: 'Week 2', component: 'Assignment 2', expectedOtjh: null, componentId: 'assignment-2', type: 'assignment', ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] },
        ],
      },
      touchedKsbCodes: [],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    const ksbRow = screen.getByText('K1', { selector: 'strong' }).closest('tr');
    expect(ksbRow).not.toBeNull();
    expect(within(ksbRow!).getByText('2')).toBeInTheDocument();

    fireEvent.click(within(ksbRow!).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Assignment 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Assignment 2')).toBeInTheDocument();
  });

  it('shows completed KSB evidence sources returned by the caseload API', () => {
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
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    const ksbRow = screen.getByText('K1', { selector: 'strong' }).closest('tr');
    expect(ksbRow).not.toBeNull();
    expect(within(ksbRow!).getByText('1')).toBeInTheDocument();

    fireEvent.click(within(ksbRow!).getByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Assignment')).toBeInTheDocument();
    expect(within(dialog).getByText('Workplace marketing evidence')).toBeInTheDocument();
    expect(within(dialog).queryByText(/No linked learning activity/i)).not.toBeInTheDocument();
  });

  it('renders upcoming reviews alongside live sessions', () => {
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
        summary: 'Mon 21 Sep · 10:00',
        detail: 'Progress Review',
      }],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.getByText('Quarterly Progress Review')).toBeInTheDocument();
    expect(screen.getByText('Review', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Scheduled', { selector: 'span' })).toBeInTheDocument();
  });

  it('removes completed catch-ups from outstanding absences', async () => {
    mocks.data = {
      ...caseFileData,
      attendance: {
        id: '42', learner: 'Aya Khater', initials: 'AK', email: 'aya@example.test', programme: 'Final Test',
        cohort: 'Final Cohort', group: 'Final Group', attendance: 50, sessions: 4, present: 2, absent: 2,
        late: 0, catchup: 1, trend: 'stable', risk: 'amber', employer: 'Test Employer', overallProgress: 25,
        otjhCompleted: 10, otjhTarget: 38.5, ksbProgress: 20, lastSession: '--', nextSession: '--',
        consecutiveMissed: 2, hasAttendance: true,
      },
    };
    mocks.coachFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [
          { learnerId: '42', learnerName: 'Aya Khater', learnerEmail: 'aya@example.test', sessionId: 'session-2', sessionTitle: 'Recovered session', sessionType: 'live_session', sessionDate: '2026-09-14', sessionDateLabel: '14 Sep 2026', startTime: '11:00', endTime: '12:00', status: 'absent', reason: 'Catch-up completed', catchupCompleted: true },
          { learnerId: '42', learnerName: 'Aya Khater', learnerEmail: 'aya@example.test', sessionId: 'session-1', sessionTitle: 'Still missed', sessionType: 'live_session', sessionDate: '2026-09-07', sessionDateLabel: '07 Sep 2026', startTime: '11:00', endTime: '12:00', status: 'absent', reason: 'No reason recorded', catchupCompleted: false },
        ],
      }),
    });

    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Attendance' }));

    expect(await screen.findByText('1 session(s) missed')).toBeInTheDocument();
    const missedPanel = screen.getByRole('heading', { name: 'Missed Sessions' }).closest('section');
    expect(missedPanel).not.toBeNull();
    expect(within(missedPanel!).getByText('Still missed')).toBeInTheDocument();
    expect(within(missedPanel!).queryByText('Recovered session')).not.toBeInTheDocument();
    expect(screen.getByText('Catch-up completed', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Outstanding absences').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Completed catch-ups').nextElementSibling).toHaveTextContent('1');
  });

  it('opens an assignment activity from the evidence popup', () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        components: [
          { module: 'Module 1', week: 'Week 1', component: 'Assignment 2', expectedOtjh: null, componentId: 'assignment-2', type: 'assignment', ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] },
        ],
      },
      touchedKsbCodes: ['K1'],
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LocationProbe /><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: /Assignment Assignment 2/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/learner/monthly-submission/apprenticeship/42/assignment-2');
  });

  it('opens the matching marking submission for each attempt of the same assessment', () => {
    mocks.data = {
      ...caseFileData,
      markingSubmissions: [
        {
          id: 'submission-123',
          activityId: 'quiz-1',
          activityTitle: 'Leadership quiz',
          submittedAt: '2026-09-17T10:00:00Z',
        },
        {
          id: 'submission-456',
          activityId: 'quiz-1',
          activityTitle: 'Leadership quiz',
          submittedAt: '2026-09-18T10:00:00Z',
        },
      ],
      detail: {
        ...caseFileData.detail,
        quizAttempts: [
          {
            quizId: 7,
            componentId: 'quiz-1',
            componentTitle: 'Leadership quiz',
            attempt: 1,
            grade: 0.8,
            passed: true,
            startedAt: '2026-09-17T09:30:00Z',
            submittedAt: '2026-09-17T10:00:00Z',
          },
          {
            quizId: 7,
            componentId: 'quiz-1',
            componentTitle: 'Leadership quiz',
            attempt: 2,
            grade: 0.9,
            passed: true,
            startedAt: '2026-09-18T09:30:00Z',
            submittedAt: '2026-09-18T10:00:00Z',
          },
        ],
      },
    };

    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LocationProbe /><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Learning Plan' }));
    const markingButtons = screen.getAllByRole('button', { name: 'Open marking: Leadership quiz' });

    fireEvent.click(markingButtons[0]);
    expect(screen.getByTestId('location')).toHaveTextContent('/coach/marking-queue/submission-456');

    fireEvent.click(markingButtons[1]);
    expect(screen.getByTestId('location')).toHaveTextContent('/coach/marking-queue/submission-123');
  });
});
