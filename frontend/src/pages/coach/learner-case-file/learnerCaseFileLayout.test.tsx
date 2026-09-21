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
  useDashboardPlan: vi.fn(() => ({})),
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
vi.mock('@/pages/workspace/learner/useDashboardPlan', () => ({ useDashboardPlan: mocks.useDashboardPlan }));
vi.mock('@/pages/workspace/learner/DashboardTrainingPlan', () => ({
  DashboardTrainingPlan: ({ activityOverviewOnly, timelineOnly, showRewards, programmeSnapshot }: { activityOverviewOnly?: boolean; timelineOnly?: boolean; showRewards?: boolean;
    programmeSnapshot?: { overall: number | null; otjhActual: number | null; otjhTarget: number | null; ksb: number | null;
      attendancePresent: number | null; attendanceTotal: number | null } }) => <div aria-label="Coach learner activity overview">
    <h2>Weekly learning plan</h2><h2>Monthly study plan</h2>
    <h2>Whole programme progress</h2><h2>Programme progress</h2><h2>Off-The-Job Hours</h2>
    {timelineOnly && <h2>Module timeline</h2>}
    <span>{programmeSnapshot && `${programmeSnapshot.overall}% · ${programmeSnapshot.otjhActual}/${programmeSnapshot.otjhTarget} · ${programmeSnapshot.ksb}% · ${programmeSnapshot.attendancePresent}/${programmeSnapshot.attendanceTotal}`}</span>
    <span>{activityOverviewOnly ? 'Activity overview only' : 'Full plan'}</span>
    <span>{showRewards === false ? 'Rewards hidden' : 'Rewards visible'}</span>
  </div>,
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
  mocks.useDashboardPlan.mockClear();
});

describe('Learner Case File design', () => {
  it('renders the learner summary with the profile snapshot and removes the overview cards', () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Aya Khater', level: 1 })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Learner profile summary' });
    for (const metric of ['Overall', 'OTJH (Actual / Target)', 'KSB', 'Attendance', 'Gateway', 'Next session']) {
      expect(within(summary).getByText(metric, { selector: 'span' })).toBeInTheDocument();
    }
    expect(within(summary).getByText('7 / 10', { selector: 'strong' })).toBeInTheDocument();
    expect(within(summary).queryByText('Absences')).not.toBeInTheDocument();
    expect(within(summary).getByRole('heading', { name: 'Profile Snapshot' })).toBeInTheDocument();
    for (const field of ['Planned Gateway', 'Cohort', 'Employer', 'Group', 'Coach', 'Start Date', 'Programme', 'Status', 'Planned End', 'Email']) {
      expect(within(summary).getByText(field)).toBeInTheDocument();
    }
    for (const removedSection of ['Progress Summary', 'Recent Activity', 'Upcoming Sessions & Reviews']) {
      expect(screen.queryByRole('heading', { name: removedSection })).not.toBeInTheDocument();
    }
    for (const activitySection of ['Weekly learning plan', 'Monthly study plan', 'Whole programme progress', 'Programme progress', 'Off-The-Job Hours']) {
      expect(screen.getByRole('heading', { name: activitySection })).toBeInTheDocument();
    }
    expect(screen.getByText('25% · 10/38.5 · 0% · 7/10')).toBeInTheDocument();
    expect(screen.getByText('Activity overview only')).toBeInTheDocument();
    expect(screen.getByText('Rewards hidden')).toBeInTheDocument();
    expect(mocks.useDashboardPlan).toHaveBeenCalledWith('apprenticeship', '125', true);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: 'Programme & Employer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Reviews & Meetings' })).not.toBeInTheDocument();
  });

  it('uses browser evidence rather than canonical KSB status for the header metric', () => {
    mocks.data = { ...caseFileData, ksbStatus: 'unavailable', ksbProgress: null, touchedKsbCodes: ['K1'] };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    const summary = screen.getByRole('region', { name: 'Learner profile summary' });
    const ksbMetric = within(summary).getByText('KSB', { selector: 'span' }).parentElement;
    expect(ksbMetric?.querySelector('strong')).toHaveTextContent('100%');
  });

  it('switches between the redesigned progress and learning plan views', () => {
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    expect(screen.getByRole('heading', { name: 'Off-the-Job Hours (OTJH)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'KSB Detailed Breakdown' })).toBeInTheDocument();
    expect(screen.getByText('Total KSB points').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Points achieved').parentElement).toHaveTextContent('0');
    expect(screen.getByText('Points remaining').parentElement).toHaveTextContent('1');
    for (const label of ['KSB Code', 'Title', 'Category', 'Status', 'Evidence']) {
      expect(screen.getByRole('button', { name: `Sort by ${label}` }).querySelector('svg')).toBeInTheDocument();
    }
    expect(screen.getByRole('table').querySelector('.lucide-circle')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by KSB Code' }));
    expect(screen.getByRole('columnheader', { name: 'KSB Code' })).toHaveAttribute('aria-sort', 'descending');

    fireEvent.click(screen.getByRole('tab', { name: 'Learning Plan' }));
    expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Module timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Programme Journey' })).toBeInTheDocument();
    expect(screen.getByText('Actual', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Planned', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Evidence Count', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('No notes yet')).not.toBeInTheDocument();
  });

  it('limits the KSB browser to mapped learner codes and counts evidence-linked codes', () => {
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
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    expect(screen.getByText('Total KSB points').parentElement).toHaveTextContent('14');
    expect(screen.getByText('Points achieved').parentElement).toHaveTextContent('10');
    expect(screen.getByText('Points remaining').parentElement).toHaveTextContent('4');
    expect(screen.getAllByText('Knowledge')[0].parentElement).toHaveTextContent('6 / 6');
    expect(screen.getByRole('button', { name: 'All (14)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Knowledge (6)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skills (4)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Behaviours (4)' })).toBeInTheDocument();
  });

  it('uses the same 58 browser rows for header, totals, remaining and category summaries', () => {
    const ksbs = [
      ...Array.from({ length: 18 }, (_, index) => ({ code: `K${index + 1}`, type: 'Knowledge', number: String(index + 1), description: `Knowledge ${index + 1}` })),
      ...Array.from({ length: 27 }, (_, index) => ({ code: `S${index + 1}`, type: 'Skills', number: String(index + 1), description: `Skill ${index + 1}` })),
      ...Array.from({ length: 13 }, (_, index) => ({ code: `B${index + 1}`, type: 'Behaviours', number: String(index + 1), description: `Behaviour ${index + 1}` })),
    ];
    mocks.data = {
      ...caseFileData,
      detail: { ...caseFileData.detail, ksbs },
      ksbStatus: 'unavailable',
      ksbProgress: null,
      ksbEvidencedCount: null,
      ksbTotalCount: null,
      mappedKsbCodes: [],
      touchedKsbCodes: ksbs.slice(0, 10).map((item) => item.code),
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    const header = screen.getByRole('region', { name: 'Learner profile summary' });
    expect(within(header).getByText('KSB', { selector: 'span' }).parentElement?.querySelector('strong')).toHaveTextContent('17%');
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    expect(screen.getByText('Total KSB points').parentElement).toHaveTextContent('58');
    expect(screen.getByText('Points achieved').parentElement).toHaveTextContent('10');
    expect(screen.getByText('Points remaining').parentElement).toHaveTextContent('48');
    expect(screen.getAllByText('Knowledge')[0].parentElement).toHaveTextContent('10 / 18');
    expect(screen.getAllByText('Skills')[0].parentElement).toHaveTextContent('0 / 27');
    expect(screen.getAllByText('Behaviours')[0].parentElement).toHaveTextContent('0 / 13');
    expect(screen.getByRole('button', { name: 'All (58)' })).toBeInTheDocument();
  });

  it('uses normalized parent evidence for child KSB rows and deduplicates sources', () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        ksbs: [
          { code: 'B1', type: 'Behaviours', number: '1', description: 'Parent behaviour' },
          { code: 'B1.1', type: 'Behaviours', number: '1.1', description: 'Child behaviour' },
        ],
      },
      touchedKsbCodes: ['B1'],
      mappedKsbCodes: [],
      snapshot: {
        ...caseFileData.snapshot,
        ksbCompletedDetails: [{
          code: 'B1',
          sources: [
            { id: 'audit:1', title: 'Accepted journal', typeLabel: 'Journal' },
            { id: 'audit:1', title: 'Accepted journal', typeLabel: 'Journal' },
          ],
        }],
      },
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);

    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    const childRow = screen.getByText('B1.1', { selector: 'strong' }).closest('tr');
    expect(childRow).not.toBeNull();
    expect(within(childRow!).getByText('Evidence linked')).toBeInTheDocument();
    expect(within(childRow!).getByText('1')).toBeInTheDocument();

    fireEvent.click(within(childRow!).getByRole('button', { name: 'View' }));
    expect(screen.getByText('Accepted journal')).toBeInTheDocument();
    expect(screen.getAllByText('Accepted journal')).toHaveLength(1);
  });

  it('keeps parent and child rows not evidenced when no parent evidence exists', () => {
    mocks.data = {
      ...caseFileData,
      detail: {
        ...caseFileData.detail,
        ksbs: [
          { code: 'B1', type: 'Behaviours', number: '1', description: 'Parent behaviour' },
          { code: 'B1.1', type: 'Behaviours', number: '1.1', description: 'Child behaviour' },
        ],
      },
      touchedKsbCodes: [],
      mappedKsbCodes: [],
      snapshot: { ...caseFileData.snapshot, ksbCompletedDetails: [] },
    };
    render(<MemoryRouter initialEntries={['/coach/learner-case-file?id=42']}><LearnerCaseFile /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'OTJH & KSB Progress' }));
    for (const code of ['B1', 'B1.1']) {
      const row = screen.getByText(code, { selector: 'strong' }).closest('tr');
      expect(within(row!).getByText('Not evidenced')).toBeInTheDocument();
      expect(within(row!).getByText('0')).toBeInTheDocument();
    }
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
    expect(screen.getByText('Completed', { selector: 'span' }).parentElement).toHaveTextContent('1 / 2');
    expect(screen.queryByRole('heading', { name: 'Recent Assessments' })).not.toBeInTheDocument();
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
      touchedKsbCodes: ['K1'],
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
        summary: 'Mon 21 Sep · 10:00',
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

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Attendance Breakdown' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Missed Sessions' })).not.toBeInTheDocument();
    expect(screen.getByText('Attendance', { selector: 'p' }).previousElementSibling).toHaveTextContent('1 / 1');
    expect(screen.getByText('Total Sessions').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Attended', { selector: 'p' }).previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Outstanding Absences').previousElementSibling).toHaveTextContent('0');
    expect(screen.getByText('2 of 2 sessions')).toBeInTheDocument();
    expect(screen.getByText('Still missed')).toBeInTheDocument();
    expect(screen.getByText('Recovered session')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'absent' } });
    expect(screen.getByText('1 of 2 sessions')).toBeInTheDocument();
    expect(screen.getByText('Still missed')).toBeInTheDocument();
    expect(screen.queryByText('Recovered session')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'missing title' } });
    expect(screen.getByText('No sessions match the selected filters.')).toBeInTheDocument();
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

  it('keeps View available for a KSB without evidence', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add evidence' })).not.toBeInTheDocument();
  });

});
