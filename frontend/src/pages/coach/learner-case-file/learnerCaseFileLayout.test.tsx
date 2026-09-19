import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachLearnerCaseFileData } from './data';
import LearnerCaseFile from './page';

const mocks = vi.hoisted(() => ({
  data: null as CoachLearnerCaseFileData | null,
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
} satisfies CoachLearnerCaseFileData;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

beforeEach(() => {
  mocks.data = caseFileData;
  mocks.fetchKsbProfile.mockReset().mockResolvedValue({ knowledge: [], skills: [], behaviours: [] });
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
});
