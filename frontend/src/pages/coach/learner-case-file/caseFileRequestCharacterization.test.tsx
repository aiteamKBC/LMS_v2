import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trace: string[] = [];

const mocks = vi.hoisted(() => ({
  fetchLearnerDetail: vi.fn(),
  fetchLearnerMetrics: vi.fn(),
  fetchLearnerAttendance: vi.fn(),
  fetchStudentActivity: vi.fn(),
  subjectRequest: vi.fn(),
  coachFetch: vi.fn(),
}));

vi.mock('@/api/learnerDetail', () => ({
  fetchLearnerDetail: mocks.fetchLearnerDetail,
}));
vi.mock('@/api/learnerMetrics', () => ({
  fetchLearnerMetrics: mocks.fetchLearnerMetrics,
}));
vi.mock('@/api/learnerAttendance', () => ({
  fetchLearnerAttendance: mocks.fetchLearnerAttendance,
}));
vi.mock('@/api/studentActivity', () => ({
  fetchStudentActivity: mocks.fetchStudentActivity,
  subjectRequest: mocks.subjectRequest,
}));
vi.mock('@/utils/learnerJourney', () => ({
  buildLearnerJourney: () => [],
}));
vi.mock('./activityState', () => ({
  buildFullCaseFileJourney: () => [],
  buildCaseFileActivityStates: () => ({}),
}));
vi.mock('@/lib/coachFetch', () => ({
  coachFetch: mocks.coachFetch,
}));
vi.mock('@/pages/coach/shared/calendarEvents', () => ({
  eventDisplayDate: () => '',
  formatDateLabel: (value: string) => value,
  formatTimeLabel: () => '',
  parseLocalDate: () => null,
  sortEvents: (events: unknown[]) => events,
  statusLabel: () => 'Unknown',
}));

import { useCoachLearnerCaseFileData } from './data';
import { LearnerCaseFileHeader } from './components/LearnerCaseFileHeader';

const headerProps = {
  pageTitle: 'Learner', pageSubtitle: 'Programme', overall: '--', otjh: '--', ksb: '--',
  attendance: '--', nextSession: '--', nextPr: '--', nextMcm: '--',
};

const metrics = {
  migrated: false,
  programme: { completed: 3, total: 4, percent: 75, status: 'ready' },
  otjh: { historical: null, new: 12, actual: 12, planned: 20 },
  ksb: { completed: 2, total: 4, percent: 50, status: 'ready', codes: [] },
};

function learnerDetail(studentActivityAvailable: boolean) {
  return {
    id: '5170',
    name: 'Stable Learner',
    email: 'stable@example.test',
    programme: 'Test Programme',
    programmeStatus: 'Active',
    cohort: 'Cohort A',
    group: 'Group A',
    employer: 'Employer A',
    studentActivityAvailable,
    components: [],
    quizAttempts: [],
    videoProgress: [],
    componentProgress: [],
    activityFeed: [],
    progressKsbCodes: [],
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function shell(overrides: Record<string, unknown> = {}) {
  return {
    identity: { learnerId: '316', enrolmentId: '5170', aptemId: null, kind: 'apprenticeship', source: 'native', identityConflict: false },
    profile: {
      name: 'Stable Learner', email: 'stable@example.test', programme: 'Test Programme', cohort: 'Cohort A',
      group: 'Group A', employer: 'Employer A', coachName: 'Coach A', coachEmail: 'coach@example.test',
      status: 'Active', startDate: '2026-06-01', plannedEndDate: '02 Aug 2027', gatewayReviewDate: '04 May 2027', coachRag: null,
      ...overrides,
    },
  };
}

describe('Learner Case File request characterization', () => {
  beforeEach(() => {
    trace.length = 0;
    vi.clearAllMocks();
    mocks.fetchLearnerDetail.mockImplementation(async (kind: string, id: string) => {
      trace.push(`learner-detail:${kind}:${id}`);
      return learnerDetail(false);
    });
    mocks.fetchLearnerMetrics.mockImplementation(async (kind: string, id: string) => {
      trace.push(`metrics:${kind}:${id}`);
      return metrics;
    });
    mocks.fetchLearnerAttendance.mockImplementation(async (kind: string, id: string) => {
      trace.push(`learner-attendance:${kind}:${id}`);
      return { attendanceRate: 80, sessions: 10, present: 8, absent: 2, sessionHistory: [] };
    });
    mocks.fetchStudentActivity.mockImplementation(async (kind: string, id: string) => {
      trace.push(`student-activity:${kind}:${id}`);
      return { activities: [], subjects: [], activity_sources: {}, activity_source_issues: {} };
    });
    mocks.subjectRequest.mockImplementation(async (url: string) => {
      trace.push(url);
      return { covers: {}, current_subjects: [], builder_subjects: {} };
    });
    mocks.coachFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      trace.push(url);
      if (url === '/coach_api/coach/learners/316/case-file') return response(shell());
      if (url.startsWith('/coach_api/coach/marking-queue')) return response({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it('records the current native cold-load requests and their deterministic start order', async () => {
    const { result } = renderHook(() => useCoachLearnerCaseFileData({
      learnerId: '316', kind: 'apprenticeship', enrolmentId: '5170',
    }));

    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));

    expect(trace).toEqual([
      '/coach_api/coach/learners/316/case-file',
      'learner-detail:apprenticeship:5170',
      'metrics:apprenticeship:5170',
    ]);
    expect(new Set(trace).size).toBe(trace.length);
    expect(trace.filter(item => item.startsWith('/coach_api/coach/')).length).toBe(1);
    expect(trace.filter(item => item.includes(':apprenticeship:5170')).length).toBe(2);
    expect(mocks.fetchStudentActivity).not.toHaveBeenCalled();
    expect(mocks.fetchLearnerAttendance).not.toHaveBeenCalled();
    expect(trace).not.toContain('/coach_api/coach/attendance');
    expect(trace).not.toContain('/coach_api/coach/timetable');
    expect(trace.some(item => item.startsWith('/coach_api/coach/marking-queue'))).toBe(false);
    expect(trace).not.toContain('/coach_api/coach/caseload');
  });

  it('reads the same activity and assigned-subject sources as My Learning for an Aptem learner', async () => {
    mocks.fetchLearnerDetail.mockImplementation(async (kind: string, id: string) => {
      trace.push(`learner-detail:${kind}:${id}`);
      return learnerDetail(true);
    });
    const { result } = renderHook(() => useCoachLearnerCaseFileData({
      learnerId: '316', kind: 'apprenticeship', enrolmentId: '5170',
    }));

    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));

    expect(trace).toEqual([
      '/coach_api/coach/learners/316/case-file',
      'learner-detail:apprenticeship:5170',
      'metrics:apprenticeship:5170',
      'student-activity:apprenticeship:5170',
      '/learner_api/subject-covers/5170/?refs=',
    ]);
    expect(new Set(trace).size).toBe(trace.length);
    expect(mocks.fetchLearnerAttendance).not.toHaveBeenCalled();
    expect(trace).not.toContain('/coach_api/coach/attendance');
    expect(trace).not.toContain('/coach_api/coach/timetable');
    expect(trace.some(item => item.startsWith('/coach_api/coach/marking-queue'))).toBe(false);
  });

  it('retains the canonical table activity counts separately from KSB progress', async () => {
    mocks.fetchLearnerMetrics.mockResolvedValue({ ...metrics,
      programme: { completed: 137, total: 157, percent: 87.26, status: 'ready' },
      ksb: { ...metrics.ksb, percent: 85.27 },
    });
    const { result } = renderHook(() => useCoachLearnerCaseFileData({ learnerId: '316' }));
    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));
    expect(result.current.data).toMatchObject({
      activitiesCompleted: 137, activitiesTotal: 157, overallProgress: 87.26, ksbProgress: 85.27,
    });
  });

  it('uses the server-resolved Aptem identity even if activity availability is false', async () => {
    mocks.coachFetch.mockImplementation(async () => response({ ...shell(), identity: {
      learnerId: '316', enrolmentId: '5170', aptemId: '98765', kind: 'commercial', source: 'aptem', identityConflict: false,
    } }));
    const { result } = renderHook(() => useCoachLearnerCaseFileData({ learnerId: '316' }));
    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));
    expect(mocks.fetchStudentActivity).toHaveBeenCalledWith('commercial', '5170');
    expect(mocks.subjectRequest).toHaveBeenCalledWith('/learner_api/subject-covers/5170/?refs=');
  });

  it('reports canonical source failures without substituting another module source', async () => {
    mocks.fetchLearnerDetail.mockResolvedValue(learnerDetail(true));
    mocks.subjectRequest.mockRejectedValue(new Error('Source unavailable'));
    const { result } = renderHook(() => useCoachLearnerCaseFileData({ learnerId: '316' }));
    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));
    expect(result.current.error).toBe('Could not load the canonical Programme Journey. Please retry.');
    expect(result.current.data?.journey).toEqual([]);
  });

  it('publishes the profile metrics without waiting for slow Aptem activity', async () => {
    mocks.fetchLearnerDetail.mockResolvedValue(learnerDetail(true));
    let finishActivity!: (value: { activities: never[]; subjects: never[]; activity_sources: object; activity_source_issues: object }) => void;
    mocks.fetchStudentActivity.mockImplementation(() => new Promise(resolve => { finishActivity = resolve; }));

    const { result } = renderHook(() => useCoachLearnerCaseFileData({
      learnerId: '316', kind: 'apprenticeship', enrolmentId: '5170',
    }));

    await waitFor(() => expect(result.current.data?.overallProgress).toBe(75));
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.otjhTarget).toBe(20);
    expect(result.current.data?.ksbProgress).toBe(50);
    expect(result.current.data?.reviewsLoading).toBe(true);

    await act(async () => finishActivity({ activities: [], subjects: [], activity_sources: {}, activity_source_issues: {} }));
    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));
  });

  it('does not attach coach-wide rows having the same name but different stable IDs', async () => {
    mocks.coachFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      trace.push(url);
      if (url === '/coach_api/coach/learners/316/case-file') return response(shell());
      if (url.startsWith('/coach_api/coach/marking-queue')) {
        return response({ items: [{ learnerId: '888', learner: 'Stable Learner', email: 'stable@example.test', totalEvidence: 99 }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useCoachLearnerCaseFileData({
      learnerId: '316', kind: 'apprenticeship', enrolmentId: '5170',
    }));

    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));

    expect(result.current.data?.snapshot).toBeNull();
    expect(result.current.data?.attendance).toBeNull();
    expect(result.current.data?.evidence).toBeNull();
    expect(result.current.data?.employer).toBe('Employer A');
    expect(result.current.data?.attendanceRate).toBeNull();
  });

  it('does not cross-match coach-wide rows having the same email but different stable IDs', async () => {
    mocks.coachFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      trace.push(url);
      if (url === '/coach_api/coach/learners/316/case-file') return response(shell());
      if (url.startsWith('/coach_api/coach/marking-queue')) {
        return response({ items: [{ learnerId: '888', learner: 'Another Learner', email: 'stable@example.test', totalEvidence: 99 }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useCoachLearnerCaseFileData({ learnerId: '316' }));

    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));
    expect(result.current.data?.attendance).toBeNull();
    expect(result.current.data?.evidence).toBeNull();
  });

  it('keeps timetable and Reviews out of the shell data request', async () => {
    const { result } = renderHook(() => useCoachLearnerCaseFileData({
      learnerId: '316', kind: 'apprenticeship', enrolmentId: '5170',
    }));

    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.displayName).toBe('Stable Learner');
    expect(result.current.data?.reviewGroups).toEqual([]);
    expect(result.current.data?.overallProgress).toBe(75);
  });

  it('uses only the shared canonical shell start date despite a different detail programme date', async () => {
    mocks.fetchLearnerDetail.mockResolvedValue({ ...learnerDetail(false), programmeStartDate: '2025-10-15' });
    const { result } = renderHook(() => useCoachLearnerCaseFileData({
      learnerId: '316', kind: 'apprenticeship', enrolmentId: '5170',
    }));
    await waitFor(() => expect(result.current.data?.startDate).toBe('2026-06-01'));
    await waitFor(() => expect(result.current.data?.detail?.programmeStartDate).toBe('2025-10-15'));
    expect(result.current.data?.startDate).toBe('2026-06-01');
    expect(result.current.data?.gatewayReviewDate).toBe('04 May 2027');
    render(<LearnerCaseFileHeader {...headerProps} data={result.current.data} />);
    expect(screen.getByText('Start Date').nextElementSibling).toHaveTextContent(/^2026-06-01$/);
  });

  it('restores the recorded learner end date when the programme and shell end dates are missing', async () => {
    mocks.fetchLearnerDetail.mockResolvedValue({
      ...learnerDetail(false),
      learnerEndDate: '2027-08-02',
      programmeEndDate: '',
    });
    mocks.coachFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      trace.push(url);
      if (url === '/coach_api/coach/learners/316/case-file') return response(shell({ plannedEndDate: null }));
      if (url.startsWith('/coach_api/coach/marking-queue')) return response({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useCoachLearnerCaseFileData({
      learnerId: '316', kind: 'apprenticeship', enrolmentId: '5170',
    }));

    await waitFor(() => expect(result.current.data?.plannedEndDate).toBe('2027-08-02'));
    render(<LearnerCaseFileHeader {...headerProps} data={result.current.data} />);
    expect(screen.getByText('Planned End Date').nextElementSibling).toHaveTextContent(/^2027-08-02$/);
    expect(screen.queryByText('Gateway Due')).not.toBeInTheDocument();
  });

  it('preserves shell profile fields and leaves missing values unavailable', async () => {
    mocks.fetchLearnerDetail.mockResolvedValue({
      ...learnerDetail(false), name: '', email: '', programme: '', cohort: '', group: '', employer: '', programmeStatus: '',
      programmeStartDate: '2025-10-15',
    });
    mocks.coachFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      trace.push(url);
      if (url === '/coach_api/coach/learners/316/case-file') {
        return response(shell({ employer: null, startDate: null, plannedEndDate: null, gatewayReviewDate: null }));
      }
      if (url.startsWith('/coach_api/coach/marking-queue')) return response({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useCoachLearnerCaseFileData({ learnerId: '316' }));

    await waitFor(() => expect(result.current.data?.reviewsLoading).toBe(false));
    expect(result.current.data).toMatchObject({
      displayName: 'Stable Learner', email: 'stable@example.test', programme: 'Test Programme',
      cohort: 'Cohort A', group: 'Group A', coachName: 'Coach A', coachEmail: 'coach@example.test',
      employer: '', startDate: '--', plannedEndDate: '--', gatewayReviewDate: '--',
    });
    expect(result.current.data?.evidenceCount).toBeNull();
    render(<LearnerCaseFileHeader {...headerProps} data={result.current.data} />);
    expect(screen.getByText('Start Date').nextElementSibling).toHaveTextContent(/^--$/);
  });

  it.skip('future boundary: opening the shell should not fetch coach-wide attendance, marking or timetable data', () => {});
  it.skip('future boundary: only the active tab should start its detailed requests', () => {});
});
