import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { formatDateLabel, getCurrentWorkWeekRange, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import CoachDashboard, { clearCoachDashboardSessionCache, CompactWeeklyMeetingDetails } from '../page';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), schedule: vi.fn(), calendar: vi.fn(), coachFetch: vi.fn(),
  coach: { email: 'coach@example.invalid', name: 'Example Coach', isInitialized: true, isViewingAsCoach: false },
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isInitialized: true, auth: { account: { email: 'coach@example.invalid' } } }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => mocks.coach }));
vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: mocks.load }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));
vi.mock('@/lib/coachViewAs', () => ({
  setCoachViewAs: vi.fn(),
  withCoachViewAs: (url: string) => mocks.coach.isViewingAsCoach
    ? `${url}?viewAsCoach=${encodeURIComponent(mocks.coach.email)}`
    : url,
}));
vi.mock('@/pages/coach/shared/calendarEvents', async original => ({
  ...await original<typeof import('@/pages/coach/shared/calendarEvents')>(),
  scheduleCoachCalendarEvent: mocks.schedule,
  fetchCoachCalendarEvents: mocks.calendar,
}));
vi.mock('@/pages/coach/progress-reviews/components/ProgressReviewPptxModal', () => ({ default: () => null }));
vi.mock('../CoachDirectoryPicker', () => ({ CoachDirectoryPicker: () => null }));
vi.mock('../AllCoachesCalendar', () => ({ AllCoachesCalendar: () => null }));

const meeting: CoachCalendarEvent = { id: 'meeting-1', eventKey: 'mcr:1:1', title: 'Monthly Coaching', source: 'mcr', type: 'coaching',
  learnerId: '1', learner: 'Example Learner', status: 'scheduled', scheduledDate: '2026-09-23', scheduledTime: '10:30', durationMinutes: 60 };
function useDashboardDate() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-18T10:00:00Z'));
}
beforeEach(() => {
  vi.resetAllMocks();
  clearCoachDashboardSessionCache();
  Object.assign(mocks.coach, { email: 'coach@example.invalid', name: 'Example Coach', isInitialized: true, isViewingAsCoach: false });
  mocks.calendar.mockResolvedValue({ events: [] });
  mocks.coachFetch.mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(
    url.includes('/attendance')
      ? { learners: [{ id: '1', learner: 'Example Learner', attendance: 90, hasAttendance: true }] }
      : { owner: { name: 'Example Coach' }, learners: [
          { id: '1', name: 'Example Learner', learnerType: 'commercial', rawProgramStatus: 'active', otjhStatus: 'at-risk', otjhCompleted: 20, otjhTarget: 40 },
          { id: '2', name: 'Attention Only Learner', learnerType: 'commercial', rawProgramStatus: 'active', otjhStatus: 'need-attention', otjhCompleted: 30, otjhTarget: 40 },
        ] },
  ))));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  mocks.load.mockResolvedValue({ owner: { name: 'Example Coach' }, learners: [{ id: '1', name: 'Example Learner', learnerType: 'commercial',
    programme: 'Project Manager Level 4', cohortName: 'Jun 2026', rawProgramStatus: 'active', otjhStatus: 'at-risk', otjhCompleted: 20, otjhTarget: 40 }, { id: '2', name: 'Attention Only Learner', learnerType: 'commercial',
    rawProgramStatus: 'active', otjhStatus: 'need-attention', otjhCompleted: 30, otjhTarget: 40 }], monthlyRisk: [
      { month: '2026-04', label: 'Apr', count: 3 }, { month: '2026-05', label: 'May', count: 2 },
      { month: '2026-06', label: 'Jun', count: 4 }, { month: '2026-07', label: 'Jul', count: 1 },
      { month: '2026-08', label: 'Aug', count: 2 }, { month: '2026-09', label: 'Sep', count: 1 },
    ], attendance: { learners: [{ id: '2', learner: 'Attention Only Learner', attendance: 50 }] }, marking: { items: [] }, meetings: { events: [meeting,
      { ...meeting, id: 'live-1', eventKey: 'live-1', source: 'live-session', title: 'Example Lesson' }] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function expectStructuredSkeleton() {
  const skeleton = screen.getByRole('status', { name: 'Loading coach dashboard' });
  expect(skeleton).toBeVisible();
  expect(skeleton.querySelectorAll('[data-skeleton="metric"]')).toHaveLength(6);
  expect(within(skeleton).getByRole('heading', { name: 'All Learners', hidden: true })).toBeInTheDocument();
  expect(within(skeleton).queryByRole('heading', { name: 'Upcoming Meetings', hidden: true })).not.toBeInTheDocument();
  expect(within(skeleton).queryByText('Risk Distribution')).not.toBeInTheDocument();
  for (const tabLabel of ['All Learners', 'Upcoming Meetings', 'Risk Insights']) {
    expect(within(skeleton).getAllByText(tabLabel).length).toBeGreaterThan(0);
  }
  const learnerTable = within(skeleton).getByRole('table', { name: 'Learners are loading', hidden: true });
  for (const column of ['Learner', 'Status', 'Progress', 'OTJH', 'Activities', 'Attendance', 'Start Date', 'Last Activity', 'Last PR', 'Last MCM', 'Actions']) {
    expect(within(learnerTable).getByRole('columnheader', { name: column, hidden: true })).toBeInTheDocument();
  }
  // Two header rows plus seven learner rows.
  expect(within(learnerTable).getAllByRole('row', { hidden: true })).toHaveLength(9);
  expect(skeleton.querySelectorAll('[data-skeleton="meeting"]')).toHaveLength(0);
  for (const emptyState of ['No learners assigned to you yet', 'Data not available', 'History not available', 'No learner meetings scheduled']) {
    expect(screen.queryByText(emptyState)).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('region', { name: 'Coach dashboard metrics' })).not.toBeInTheDocument();
}

it('shows only dashboard skeletons while the initial request is pending', async () => {
  vi.useRealTimers();
  mocks.coachFetch.mockResolvedValue(new Response(JSON.stringify({ results: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })));
  const finishLoads: Array<(value: unknown) => void> = [];
  mocks.load.mockImplementation(() => new Promise(resolve => { finishLoads.push(resolve); }));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expectStructuredSkeleton();
  expect(screen.queryByText('No learners assigned to you yet')).not.toBeInTheDocument();
  expect(screen.queryByText('Data not available')).not.toBeInTheDocument();
  expect(screen.queryByText('--')).not.toBeInTheDocument();
  finishLoads.forEach(resolve => resolve({ owner: { name: 'Example Coach' }, learners: [], meetings: { events: [] } }));
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();
});

it('shows the learner table only after a successful response', async () => {
  vi.useRealTimers();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(screen.getByRole('status', { name: 'Loading coach dashboard' })).toBeVisible();
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  expect(await within(riskTable).findByText('Example Learner')).toBeVisible();
  expect(within(riskTable).getByText('Project Manager Level 4')).toBeVisible();
  expect(within(riskTable).queryByText('Jun 2026')).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Loading coach dashboard' })).not.toBeInTheDocument();
  expect(document.querySelectorAll('[data-skeleton]')).toHaveLength(0);
  expect(screen.getByRole('region', { name: 'Coach dashboard metrics' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Learner risk insights' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Risk Insights' }));
  expect(screen.getByRole('region', { name: 'Learner risk insights' })).toBeVisible();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.load).toHaveBeenCalledWith('/coach_api/coach/dashboard', expect.objectContaining({ credentials: 'include' }));
  expect(mocks.calendar).not.toHaveBeenCalled();
  expect(mocks.coachFetch).not.toHaveBeenCalled();
});

it('keeps the loaded dashboard visible while returning to the page and refreshing in the background', async () => {
  vi.useRealTimers();
  const firstRender = render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('Example Learner')).toBeVisible();
  firstRender.unmount();

  let finishRefresh!: (value: unknown) => void;
  mocks.load.mockImplementation(() => new Promise(resolve => { finishRefresh = resolve; }));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);

  expect(screen.getByText('Example Learner')).toBeVisible();
  expect(screen.queryByRole('status', { name: 'Loading coach dashboard' })).not.toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishRefresh({ owner: { name: 'Example Coach' }, learners: [], meetings: { events: [] } });
  });
});

it('characterizes the initial dashboard request as one aggregate request with no child requests', async () => {
  vi.useRealTimers();
  const requestOrder: string[] = [];
  mocks.load.mockImplementation(async (url: string) => {
    requestOrder.push(url);
    return { owner: { name: 'Example Coach' }, learners: [], meetings: { events: [] } };
  });

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();

  expect(requestOrder).toEqual(['/coach_api/coach/dashboard']);
  expect(mocks.calendar).not.toHaveBeenCalled();
  expect(mocks.coachFetch).not.toHaveBeenCalled();
});

it('adds the effective coach once when an administrator views a coach dashboard', async () => {
  vi.useRealTimers();
  Object.assign(mocks.coach, {
    email: 'selected.coach@example.invalid', name: 'Selected Coach', isViewingAsCoach: true,
  });

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByRole('region', { name: 'Coach learner caseload' })).toBeVisible();

  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.load).toHaveBeenCalledWith(
    '/coach_api/coach/dashboard?viewAsCoach=selected.coach%40example.invalid',
    expect.objectContaining({ credentials: 'include' }),
  );
});

it('retries the aggregate request once after a transient failure', async () => {
  useDashboardDate();
  mocks.load
    .mockRejectedValueOnce(new Error('Temporary failure'))
    .mockResolvedValueOnce({ owner: { name: 'Example Coach' }, learners: [], meetings: { events: [] } });

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();

  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.load.mock.calls.map(([url]) => url)).toEqual([
    '/coach_api/coach/dashboard', '/coach_api/coach/dashboard',
  ]);
});

it('aborts the previous aggregate request when the effective coach changes', async () => {
  vi.useRealTimers();
  const signals: AbortSignal[] = [];
  mocks.load.mockImplementation((_: string, options: { signal: AbortSignal }) => {
    signals.push(options.signal);
    if (signals.length === 1) return new Promise(() => undefined);
    return Promise.resolve({ owner: { name: 'Next Coach' }, learners: [], meetings: { events: [] } });
  });

  const { rerender } = render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(signals).toHaveLength(1);
  Object.assign(mocks.coach, { email: 'next-coach@example.invalid', name: 'Next Coach' });
  rerender(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();

  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
});

it('renders dashboard-owned KSB, activity, and attendance metrics without a caseload request', async () => {
  vi.useRealTimers();
  mocks.load.mockResolvedValue({
    owner: { name: 'Example Coach' },
    learners: [{
      id: '1', name: 'Metric Learner', learnerType: 'commercial', rawProgramStatus: 'active',
      otjhStatus: 'on-track', otjhCompleted: 20, otjhTarget: 40,
      ksbProgress: 85.3, ksbProgressAvailable: true, ksbCompleted: 498, ksbTarget: 584,
      activityProgress: 87.3, activityProgressAvailable: true, componentsCompleted: 137, componentsPlanned: 157,
      attendanceRate: 80, attendanceAvailable: true, attendancePresent: 8, attendanceSessions: 10,
    }],
    monthlyRisk: [], marking: { items: [] }, meetings: { events: [] },
  });

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const region = await screen.findByRole('region', { name: 'Coach learner caseload' });
  const row = (await within(region).findByText('Metric Learner')).closest('tr');
  expect(row).not.toBeNull();
  expect(within(row!).getByText('85.3%')).toBeVisible();
  expect(within(row!).getByText('87.3%')).toBeVisible();
  expect(within(row!).getByText('80%')).toBeVisible();
  expect(within(row!).getByText('498 / 584')).toBeVisible();
  expect(within(row!).getByText('137 / 157')).toBeVisible();
  expect(within(row!).getByText('8 / 10')).toBeVisible();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.coachFetch).not.toHaveBeenCalled();
});

it('preserves zero values while rendering unavailable dashboard metrics distinctly', async () => {
  vi.useRealTimers();
  mocks.load.mockResolvedValue({
    owner: { name: 'Example Coach' }, monthlyRisk: [], marking: { items: [] }, meetings: { events: [] },
    learners: [
      {
        id: 'zero', name: 'Zero Learner', rawProgramStatus: 'active', otjhStatus: 'at-risk',
        otjhCompleted: 0, otjhTarget: 40, ksbProgress: 0, ksbProgressAvailable: true,
        ksbCompleted: 0, ksbTarget: 12, activityProgress: 0, activityProgressAvailable: true,
        componentsCompleted: 0, componentsPlanned: 20, attendanceRate: 0,
        attendanceRateAvailable: true, attendanceAvailable: true, attendancePresent: 0, attendanceSessions: 10,
        lastActivity: '18 Sep 2026', lastActivityLabel: 'Quiz submitted', lastPr: '12 Sep 2026', lastMcm: '14 Sep 2026',
      },
      {
        id: 'missing', name: 'Unavailable Learner', rawProgramStatus: 'active', otjhStatus: 'unknown',
        otjhCompleted: 0, otjhTarget: 0, ksbProgress: null, ksbProgressAvailable: false,
        activityProgress: null, activityProgressAvailable: false, attendanceRate: null,
        attendanceRateAvailable: false, attendanceAvailable: false,
      },
    ],
  });

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const region = await screen.findByRole('region', { name: 'Coach learner caseload' });
  const zeroRow = (await within(region).findByText('Zero Learner')).closest('tr')!;
  expect(within(zeroRow).getByLabelText('OTJH: 0%')).toBeVisible();
  expect(within(zeroRow).getByLabelText('KSBs: 0%')).toBeVisible();
  expect(within(zeroRow).getByLabelText('Activities: 0%')).toBeVisible();
  expect(within(zeroRow).getByLabelText('Attendance: 0%')).toBeVisible();
  expect(within(zeroRow).getByText('18 Sep 2026')).toBeVisible();
  expect(within(zeroRow).getByText('12 Sep 2026')).toBeVisible();
  expect(within(zeroRow).getByText('14 Sep 2026')).toBeVisible();

  const unavailableRow = (await within(region).findByText('Unavailable Learner')).closest('tr')!;
  expect(within(unavailableRow).getByLabelText('OTJH: not available')).toBeVisible();
  expect(within(unavailableRow).getByLabelText('KSBs: not available')).toBeVisible();
  expect(within(unavailableRow).getByLabelText('Activities: not available')).toBeVisible();
  expect(within(unavailableRow).getByLabelText('Attendance: not available')).toBeVisible();
  expect(within(unavailableRow).getByText('No activity yet')).toBeVisible();
  expect(within(unavailableRow).getByText('No PR yet')).toBeVisible();
  expect(within(unavailableRow).getByText('No MCM yet')).toBeVisible();
});

it('shows the learner empty state only after an empty response finishes', async () => {
  vi.useRealTimers();
  mocks.coachFetch.mockResolvedValue(new Response(JSON.stringify({ results: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })));
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue') ? { summary: { pendingItems: 0 } } : { owner: { name: 'Example Coach' }, learners: [], meetings: { events: [] } },
  ));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(screen.queryByText('No learners assigned to you yet')).not.toBeInTheDocument();
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();
});

it('shows one dashboard error without a learner empty state', async () => {
  vi.useRealTimers();
  mocks.load.mockRejectedValue(new Error('Dashboard unavailable'));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('Unable to load coach dashboard')).toBeVisible();
  expect(screen.queryByText('No learners assigned to you yet')).not.toBeInTheDocument();
});

it('returns immediately to skeletons when the selected coach changes', async () => {
  vi.useRealTimers();
  const { rerender } = render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  expect(await within(riskTable).findByText('Example Learner')).toBeVisible();
  const finishLoads: Array<(value: unknown) => void> = [];
  mocks.load.mockImplementation(() => new Promise(resolve => { finishLoads.push(resolve); }));
  mocks.coachFetch.mockResolvedValue(new Response(JSON.stringify({ results: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })));
  Object.assign(mocks.coach, { email: 'next-coach@example.invalid', name: 'Next Coach' });
  rerender(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expectStructuredSkeleton();
  expect(screen.queryByText('Example Learner')).not.toBeInTheDocument();
  expect(screen.queryByText('No learners assigned to you yet')).not.toBeInTheDocument();
  finishLoads.forEach(resolve => resolve({ owner: { name: 'Next Coach' }, learners: [], meetings: { events: [] } }));
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();
});

it('shows serialized latest completed MCM and PR and ignores future or cancelled sessions', async () => {
  vi.useRealTimers();
  mocks.coachFetch.mockResolvedValue(new Response(JSON.stringify({
    results: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'at-risk', lastMcm: '12 Sept 2026', lastPr: '15 Sept 2026' }],
    pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
  })));
  mocks.calendar.mockResolvedValue({ events: [
    { ...meeting, id: 'completed-coaching', status: 'completed', scheduledDate: '2026-09-20', reviewCompletedAt: '2026-09-01T09:00:00Z' },
    { ...meeting, id: 'completed-review', source: 'progress-review', type: 'review', status: 'completed', scheduledDate: '2026-09-22', reviewCompletedAt: '2026-09-02T10:00:00Z' },
    { ...meeting, id: 'completed-live', source: 'live-session', status: 'completed', scheduledDate: '2026-09-16' },
    { ...meeting, id: 'future-live', source: 'live-session', status: 'scheduled', scheduledDate: '2026-09-21' },
    { ...meeting, id: 'cancelled-live', source: 'live-session', status: 'cancelled', scheduledDate: '2026-09-17' },
  ] });
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [{
            id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'at-risk',
            lastMcm: '12 Sept 2026', lastPr: '15 Sept 2026',
          }],
          attendance: { learners: [{ id: '1', learner: 'Example Learner', attendance: 90, lastSession: '10 Sep 2026', lastSessionDate: '2026-09-10' }] },
          marking: { items: [] },
          meetings: { events: [] },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  const row = (await within(riskTable).findByText('Example Learner')).closest('tr');
  expect(row).not.toBeNull();
  expect(within(row!).getByRole('cell', { name: /12 Sept 2026.*Latest completed/ })).toBeVisible();
  expect(within(row!).getByRole('cell', { name: /15 Sept 2026.*Latest completed/ })).toBeVisible();
  expect(within(riskTable).queryByText('21 Sept 2026')).not.toBeInTheDocument();
  expect(within(riskTable).queryByText('17 Sept 2026')).not.toBeInTheDocument();
});

it('shows the requested empty Last PR and Last MCM labels when no completed review exists', async () => {
  vi.useRealTimers();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  const row = (await within(riskTable).findByText('Example Learner')).closest('tr');
  expect(row).not.toBeNull();
  expect(within(row!).getByText('No PR yet').parentElement).toHaveTextContent('--No PR yet');
  expect(within(row!).getByText('No MCM yet').parentElement).toHaveTextContent('--No MCM yet');
});

it('keeps the live session calendar link while showing the new actions only on coaching meetings', async () => {
  useDashboardDate();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await screen.findByRole('tab', { name: 'All Learners' });
  expect(screen.queryByRole('heading', { name: 'My Assigned Groups' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "Today's schedule" })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Caseload health' })).not.toBeInTheDocument();
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  expect(within(riskTable).getByRole('heading', { name: 'All Learners' })).toBeVisible();
  expect(within(riskTable).getByRole('columnheader', { name: 'Progress' })).toBeVisible();
  expect(await within(riskTable).findByText('Example Learner')).toBeVisible();
  expect(await within(riskTable).findByText('Attention Only Learner')).toBeVisible();
  expect(within(riskTable).queryByRole('region', { name: 'OTJH caseload summary' })).not.toBeInTheDocument();
  expect(within(riskTable).getByRole('button', { name: 'All programme statuses' })).toBeVisible();
  expect(screen.queryByRole('link', { name: /View all learners/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
  expect(await screen.findByRole('button', { name: 'Send Reminder' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'View Presentation' })).toBeVisible();
  const meetings = screen.getByRole('region', { name: 'Upcoming meetings and live sessions' });
  const groupedDateCell = meetings.querySelector('td[rowspan="2"]');
  expect(groupedDateCell).not.toBeNull();
  expect(groupedDateCell).toHaveTextContent('WED');
  expect(groupedDateCell).toHaveTextContent('23 Sept 2026');
  expect(meetings.querySelectorAll('time[datetime="2026-09-23"]')).toHaveLength(1);
  expect(within(meetings).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  expect(within(meetings).getAllByText('Scheduled')).toHaveLength(2);
  expect(within(meetings).getAllByRole('button', { name: 'Reschedule' })).toHaveLength(1);
  expect(within(meetings).getByRole('link', { name: /View .* in calendar/ })).toHaveAttribute('href', '/coach/timetable');
  expect(meetings.querySelectorAll('tr[data-meeting-row="true"]')).toHaveLength(2);
  expect(meetings.querySelector('tr[data-day-first="true"]')).not.toBeNull();
  expect(meetings.querySelector('tr[data-day-last="true"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Risk Insights' }));
  const insights = screen.getByRole('region', { name: 'Learner risk insights' });
  for (const title of ['Attendance Insights', 'OTJH Insights', 'Review Insights']) {
    expect(within(insights).getByRole('heading', { name: title })).toBeVisible();
    fireEvent.click(within(insights).getByRole('button', { name: `Expand ${title}` }));
  }
  expect(within(insights).getByRole('region', { name: 'Attendance risk insights' })).toBeVisible();
  expect(within(insights).getByRole('region', { name: 'OTJH risk insights' })).toBeVisible();
  expect(within(insights).getByRole('region', { name: 'Review risk insights' })).toBeVisible();
  expect(mocks.load).toHaveBeenCalledWith('/coach_api/coach/dashboard', expect.objectContaining({ credentials: 'include' }));
});

it('does not show the caseload owner name as learner session activity', async () => {
  vi.useRealTimers();
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Incorrect Coach Name' },
          learners: [{
            id: '1', name: 'Example Learner',
            rawProgramStatus: 'active', otjhStatus: 'at-risk',
          }],
          attendance: { learners: [{
            id: '1', learner: 'Example Learner', attendance: 90,
            lastSession: '12 Sep 2026', lastSessionDate: '2026-09-12',
          }] },
          marking: { items: [] },
          meetings: { events: [] },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  expect(await within(riskTable).findByText('Example Learner')).toBeVisible();
  expect(within(riskTable).queryByRole('columnheader', { name: 'Last contact' })).not.toBeInTheDocument();
  expect(within(riskTable).queryByText('Incorrect Coach Name')).not.toBeInTheDocument();
});

it('keeps a Teams warning visible when a rescheduled meeting moves out of the seven-day preview', async () => {
  useDashboardDate();
  mocks.schedule.mockResolvedValue({ event: { ...meeting, scheduledDate: '2026-10-10' }, warning: 'Teams sync needs retry.' });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Upcoming Meetings' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reschedule' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save new time' })); });
  expect(screen.queryByRole('button', { name: 'Send Reminder' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Teams sync needs retry.');
  expect(screen.getByRole('link', { name: /View .* in calendar/ })).toBeVisible();
});

it('shows the six requested workload cards using the current week and marking queue', async () => {
  useDashboardDate();
  const dashboardEvents: CoachCalendarEvent[] = [
    { ...meeting, id: 'mcm-week', eventKey: 'mcm-week', scheduledDate: '2026-09-18' },
    { ...meeting, id: 'pr-week', eventKey: 'pr-week', source: 'progress-review', title: 'Progress Review', type: 'review', scheduledDate: '2026-09-19' },
    { ...meeting, id: 'catch-up-week', eventKey: 'catch-up-week', source: 'catch-up', title: 'Catch-up', scheduledDate: '2026-09-20' },
    { ...meeting, id: 'cancelled-mcm', eventKey: 'cancelled-mcm', status: 'cancelled', scheduledDate: '2026-09-18' },
  ];
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 6 } }
      : { owner: { name: 'Example Coach' }, learners: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', enrollmentStatus: 'active', status: 'at-risk', otjhStatus: 'at-risk', otjhCompleted: 0, otjhTarget: 100 }], marking: { summary: { pendingItems: 6 }, items: [] }, meetings: { events: dashboardEvents } },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const metrics = await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  const values = Object.fromEntries(
    within(metrics).getAllByRole('button').map(card => [card.querySelector('[class*="metricLabel"]')?.textContent, card.querySelector('[class*="metricValue"]')?.textContent]),
  );
  expect(values).toMatchObject({
    'Total learners': '1',
    'OTJH at risk': '1',
    'Pending marking': '6',
    'PR this week': '0',
    'MCM this week': '1',
    'Catch-ups this week': '0',
  });
  expect(within(metrics).queryByText('Learners engagement')).not.toBeInTheDocument();
  expect(within(metrics).queryByText('PR 12-week')).not.toBeInTheDocument();
  expect(within(metrics).queryByText('Referred closure')).not.toBeInTheDocument();
  expect(within(metrics).queryByText('MCM 4-week')).not.toBeInTheDocument();
});

it('uses the current work week for KPI cards and only the next work week for upcoming meetings', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-23T10:00:00Z'));
  const event = (id: string, source: string, scheduledDate: string): CoachCalendarEvent => ({
    ...meeting,
    id,
    eventKey: id,
    title: id,
    learner: '',
    source,
    scheduledDate,
  });
  const dashboardEvents = [
    event('Current Monday PR', 'progress-review', '2026-09-21'),
    event('Current Tuesday MCM', 'mcr', '2026-09-22'),
    event('Current Friday Catch-up', 'catch-up', '2026-09-25'),
    event('Next Monday PR', 'progress-review', '2026-09-28'),
    event('Next Tuesday MCM', 'mcr', '2026-09-29'),
    event('Next Wednesday Catch-up', 'catch-up', '2026-09-30'),
    event('Next Thursday Support', 'student-support', '2026-10-01'),
    event('Next Friday Live Session', 'live-session', '2026-10-02'),
    event('Next Saturday PR', 'progress-review', '2026-10-03'),
    event('After Next Friday MCM', 'mcr', '2026-10-05'),
  ];
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'on-track' }],
          meetings: { events: dashboardEvents },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);

  const metrics = await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  for (const label of ['PR this week', 'MCM this week', 'Catch-ups this week']) {
    const card = within(metrics).getByRole('button', { name: `Open ${label} details` });
    expect(card.querySelector('[class*="metricValue"]')).toHaveTextContent('1');
    expect(card).toHaveTextContent('21 Sep');
    expect(card).toHaveTextContent('25 Sep');
  }

  fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
  expect(screen.getByText('Your scheduled meetings and live sessions in the next work week')).toBeVisible();
  expect(screen.getByText(/28 Sep .* 02 Oct/)).toBeVisible();
  const upcoming = screen.getByRole('region', { name: 'Upcoming meetings and live sessions' });
  for (const title of ['Next Monday PR', 'Next Tuesday MCM', 'Next Wednesday Catch-up', 'Next Thursday Support', 'Next Friday Live Session']) {
    expect(within(upcoming).getAllByText(title)[0]).toBeVisible();
  }
  for (const title of ['Current Friday Catch-up', 'Next Saturday PR', 'After Next Friday MCM']) {
    expect(within(upcoming).queryAllByText(title)).toHaveLength(0);
  }
  expect(upcoming.querySelector('time[datetime="2026-09-28"]')).not.toBeNull();
  expect(upcoming.querySelector('time[datetime="2026-10-02"]')).not.toBeNull();
});

it('shows resolved Aptem weekly counts when the 119-event payload also has a generation issue', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-23T10:00:00Z'));
  const progressReviews = Array.from({ length: 26 }, (_, index): CoachCalendarEvent => ({
    ...meeting,
    id: `pr-${index}`,
    eventKey: `pr-${index}`,
    source: 'progress-review',
    type: 'review',
    scheduledDate: index < 3 ? `2026-09-${21 + index}` : '2026-10-01',
  }));
  const monthlyCoaching = Array.from({ length: 93 }, (_, index): CoachCalendarEvent => ({
    ...meeting,
    id: `mcm-${index}`,
    eventKey: `mcm-${index}`,
    scheduledDate: index < 14 ? `2026-09-${21 + (index % 5)}` : '2026-10-01',
  }));
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'on-track' }],
          meetings: {
            events: [...progressReviews, ...monthlyCoaching],
            summary: { totalEvents: 119, progressReviewRows: 26, mcrRows: 93, learnersWithDates: 31, aptemReviewRows: 119, aptemLearners: 32, curriculumLearners: 0 },
            reviewGenerationIssues: [{ learnerId: 'unrelated-native-learner', code: 'review_schedule_unavailable' }],
          },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const metrics = await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  const prCard = within(metrics).getByRole('button', { name: 'Open PR this week details' });
  const mcmCard = within(metrics).getByRole('button', { name: 'Open MCM this week details' });
  expect(prCard.querySelector('[class*="metricValue"]')).toHaveTextContent('3');
  expect(mcmCard.querySelector('[class*="metricValue"]')).toHaveTextContent('14');
  expect(within(metrics).queryByText('Review schedule data unavailable')).not.toBeInTheDocument();
});

it('shows review cards as unavailable when generation failed without usable review data', async () => {
  useDashboardDate();
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'on-track' }],
          meetings: {
            events: [],
            summary: { progressReviewRows: 0, mcrRows: 0, learnersWithDates: 0 },
            reviewGenerationIssues: [{ learnerId: '1', code: 'review_schedule_unavailable' }],
          },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const metrics = await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  expect(within(metrics).getAllByText('Review schedule data unavailable')).toHaveLength(2);
  expect(within(metrics).getByRole('button', { name: 'Open PR this week details' })).toHaveTextContent('--');
  expect(within(metrics).getByRole('button', { name: 'Open MCM this week details' })).toHaveTextContent('--');
});

it('excludes onboarding, withdrawn and entered EPA stages from every risk insight table', async () => {
  useDashboardDate();
  const riskSignals = {
    otjhStatus: 'at-risk', otjhCompleted: 0, otjhTarget: 100,
    attendanceConsecutiveMissed: 3, lastPr: '1 Jan 2026', lastMcm: '1 Jan 2026',
  };
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [
            { id: '1', name: 'Active Learner', rawProgramStatus: 'active', ...riskSignals },
            { id: '2', name: 'Delivery Learner', rawProgramStatus: 'delivery', ...riskSignals },
            { id: '3', name: 'Onboarding Learner', rawProgramStatus: 'active', enrollmentStatus: 'On Boarding', ...riskSignals },
            { id: '4', name: 'EPA Learner', rawProgramStatus: 'delivery', enrollmentStatus: 'Entered EPA', ...riskSignals },
            { id: '5', name: 'Withdrawn Learner', rawProgramStatus: 'active', enrollmentStatus: 'Withdrawn', ...riskSignals },
          ],
          meetings: { events: [] },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const metrics = await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  const totalLearners = within(metrics).getByRole('button', { name: 'Open Total learners details' });
  expect(totalLearners.querySelector('[class*="metricValue"]')).toHaveTextContent('5');
  fireEvent.click(screen.getByRole('tab', { name: 'Risk Insights' }));
  for (const title of ['Attendance Insights', 'OTJH Insights', 'Review Insights']) {
    fireEvent.click(screen.getByRole('button', { name: `Expand ${title}` }));
  }
  const attendanceInsights = screen.getByRole('region', { name: 'Attendance risk insights' });
  const otjhInsights = screen.getByRole('region', { name: 'OTJH risk insights' });
  const reviewInsights = screen.getByRole('region', { name: 'Review risk insights' });
  for (const name of ['Active Learner', 'Delivery Learner']) {
    expect(within(attendanceInsights).getByText(name)).toBeVisible();
    expect(within(otjhInsights).getByText(name)).toBeVisible();
    expect(within(reviewInsights).getByText(name)).toBeVisible();
  }
  for (const name of ['Onboarding Learner', 'EPA Learner', 'Withdrawn Learner']) {
    expect(within(attendanceInsights).queryByText(name)).not.toBeInTheDocument();
    expect(within(otjhInsights).queryByText(name)).not.toBeInTheDocument();
    expect(within(reviewInsights).queryByText(name)).not.toBeInTheDocument();
  }
});

it('opens a detail popup and full-page link from every workload card', async () => {
  useDashboardDate();
  const dashboardEvents: CoachCalendarEvent[] = [
    { ...meeting, id: 'mcm-week', eventKey: 'mcm-week', scheduledDate: '2026-09-18' },
    { ...meeting, id: 'pr-week', eventKey: 'pr-week', source: 'progress-review', title: 'Progress Review', type: 'review', scheduledDate: '2026-09-18' },
    { ...meeting, id: 'catch-up-week', eventKey: 'catch-up-week', source: 'catch-up', title: 'Catch-up', scheduledDate: '2026-09-18' },
  ];
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 2 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'at-risk' }],
          marking: { items: [{ id: 'evidence-1', learnerId: '1', learner: 'Example Learner', pendingEvidence: 2, totalEvidence: 2 }] },
          meetings: { events: dashboardEvents },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const metrics = await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  const popupCases = [
    ['Total learners', 'Learner caseload', 'View in caseload list', null],
    ['OTJH at risk', 'Learners at risk', 'View in caseload list', null],
    ['Pending marking', 'Pending marking', 'Open marking queue', '/coach/marking-queue'],
    ['PR this week', 'Progress reviews this week', 'Open progress reviews', '/coach/progress-reviews'],
    ['MCM this week', 'Monthly coaching this week', 'Open monthly coaching', '/coach/monthly-coaching'],
    ['Catch-ups this week', 'Catch-ups this week', 'Open timetable', '/coach/timetable'],
  ] as const;

  for (const [cardName, heading, actionName, href] of popupCases) {
    fireEvent.click(within(metrics).getByRole('button', { name: `Open ${cardName} details` }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: heading })).toBeVisible();
    const action = within(dialog).getByRole(href ? 'link' : 'button', { name: actionName });
    if (href) expect(action).toHaveAttribute('href', href);
    fireEvent.click(within(dialog).getByText('Close'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
});

it('renders monthly coaching details as compact day groups with status summaries', async () => {
  vi.useRealTimers();
  const { start: monday } = getCurrentWorkWeekRange();
  const tuesday = new Date(monday);
  tuesday.setDate(monday.getDate() + 1);
  const localIso = (value: Date) => [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
  const mondayIso = localIso(monday);
  const tuesdayIso = localIso(tuesday);
  const dashboardEvents: CoachCalendarEvent[] = [
    { ...meeting, id: 'mcm-mon-one', eventKey: 'mcm-mon-one', learner: 'Alex Reed', programme: 'Business Admin', group: 'Group A', scheduledDate: mondayIso, scheduledTime: '09:00', status: 'scheduled' },
    { ...meeting, id: 'mcm-mon-two', eventKey: 'mcm-mon-two', learner: 'Jamie Cole', programme: 'Customer Service', group: 'Group B', scheduledDate: mondayIso, scheduledTime: null, status: 'not-scheduled' },
    { ...meeting, id: 'mcm-tue', eventKey: 'mcm-tue', learner: 'Morgan Shah', programme: 'Team Leader', group: 'Group C', scheduledDate: tuesdayIso, scheduledTime: '14:00', status: 'confirmed' },
  ];
  render(<CompactWeeklyMeetingDetails events={dashboardEvents} summaryLabel="Monthly coaching" emptyIcon="ri-history-line" />);
  expect(screen.getByLabelText('Monthly coaching summary')).toHaveTextContent('Scheduled 2');
  expect(screen.getByLabelText('Monthly coaching summary')).toHaveTextContent('Not Scheduled 1');
  expect(screen.getByRole('region', { name: formatDateLabel(mondayIso) })).toBeVisible();
  expect(screen.getByRole('region', { name: formatDateLabel(tuesdayIso) })).toBeVisible();
  expect(screen.getByText('Alex Reed')).toBeVisible();
  expect(screen.getByText('Business Admin · Group A')).toBeVisible();
  expect(screen.getByText('09:00 - 60 min')).toBeVisible();
  expect(screen.queryByText('Monthly Coaching')).not.toBeInTheDocument();
});

it('uses the same compact grouped layout for weekly progress reviews', () => {
  const progressReviews: CoachCalendarEvent[] = [
    { ...meeting, id: 'pr-one', eventKey: 'pr-one', source: 'progress-review', learner: 'Hollie Hylton', programme: 'Business Admin', group: 'Group A', scheduledDate: '2026-09-24', scheduledTime: null, status: 'scheduled', title: 'Review 1' },
    { ...meeting, id: 'pr-two', eventKey: 'pr-two', source: 'progress-review', learner: 'Alex Reed', programme: 'Business Admin', group: 'Group B', scheduledDate: '2026-09-24', scheduledTime: '14:00', status: 'not-scheduled', title: 'Review 2' },
  ];

  render(<CompactWeeklyMeetingDetails events={progressReviews} summaryLabel="Progress review" emptyIcon="ri-focus-3-line" />);

  expect(screen.getByLabelText('Progress review summary')).toHaveTextContent('Scheduled 1');
  expect(screen.getByLabelText('Progress review summary')).toHaveTextContent('Not Scheduled 1');
  expect(screen.getByRole('region', { name: '24 Sept 2026' })).toHaveTextContent('THU24 SEP');
  expect(screen.getByText('Hollie Hylton')).toBeVisible();
  expect(screen.getByText('Business Admin · Group A')).toBeVisible();
  expect(screen.getByText('-')).toBeVisible();
  expect(screen.queryByText('Time TBC')).not.toBeInTheDocument();
  expect(screen.queryByText('Review 1')).not.toBeInTheDocument();
  expect(screen.queryByText('Progress Review')).not.toBeInTheDocument();
});


it('uses target-to-date for OTJH insights without comparing actuals to the whole plan', async () => {
  useDashboardDate();
  mocks.load.mockResolvedValue({ owner: { name: 'Example Coach' }, learners: [
    { id: '1', name: 'Warning Learner', rawProgramStatus: 'active', otjhCompleted: 170,
      otjhTarget: 576, otjhTargetAsOfToday: 200, otjhRagStatus: 'need-attention' },
    { id: '2', name: 'Critical Learner', rawProgramStatus: 'active', otjhCompleted: 160,
      otjhTarget: 576, otjhTargetAsOfToday: 200, otjhRagStatus: 'at-risk' },
    { id: '3', name: 'Current Learner', rawProgramStatus: 'active', otjhCompleted: 195,
      otjhTarget: 576, otjhTargetAsOfToday: 200, otjhRagStatus: 'on-track' },
    { id: '4', name: 'Future Learner', rawProgramStatus: 'active', otjhCompleted: 0,
      otjhTarget: 576, otjhTargetAsOfToday: 0, otjhRagStatus: 'on-track' },
  ], meetings: { events: [] } });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  fireEvent.click(screen.getByRole('tab', { name: 'Risk Insights' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand OTJH Insights' }));
  const table = within(screen.getByRole('region', { name: 'OTJH risk insights' }));
  const warning = within(table.getByText('Warning Learner').closest('tr')!);
  expect(warning.getByText('170h')).toBeVisible();
  expect(warning.getByText('200h')).toBeVisible();
  expect(warning.getByText('30h')).toBeVisible();
  expect(warning.getByText('Warning')).toBeVisible();
  const critical = within(table.getByText('Critical Learner').closest('tr')!);
  expect(critical.getByText('200h')).toBeVisible();
  expect(critical.getByText('40h')).toBeVisible();
  expect(critical.getByText('Critical')).toBeVisible();
  expect(table.queryByText('Current Learner')).not.toBeInTheDocument();
  expect(table.queryByText('Future Learner')).not.toBeInTheDocument();
  expect(table.queryByText('576h')).not.toBeInTheDocument();
});
