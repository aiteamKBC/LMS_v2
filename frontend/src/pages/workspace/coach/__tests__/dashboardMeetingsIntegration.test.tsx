import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import CoachDashboard from '../page';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), schedule: vi.fn(), calendar: vi.fn(), coachFetch: vi.fn(),
  coach: { email: 'coach@example.invalid', name: 'Example Coach', isInitialized: true, isViewingAsCoach: false },
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isInitialized: true, auth: { account: { email: 'coach@example.invalid' } } }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => mocks.coach }));
vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: mocks.load }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));
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
    rawProgramStatus: 'active', otjhStatus: 'at-risk', otjhCompleted: 20, otjhTarget: 40 }, { id: '2', name: 'Attention Only Learner', learnerType: 'commercial',
    rawProgramStatus: 'active', otjhStatus: 'need-attention', otjhCompleted: 30, otjhTarget: 40 }], monthlyRisk: [
      { month: '2026-04', label: 'Apr', count: 3 }, { month: '2026-05', label: 'May', count: 2 },
      { month: '2026-06', label: 'Jun', count: 4 }, { month: '2026-07', label: 'Jul', count: 1 },
      { month: '2026-08', label: 'Aug', count: 2 }, { month: '2026-09', label: 'Sep', count: 1 },
    ], attendance: { learners: [{ id: '2', learner: 'Attention Only Learner', attendance: 50 }] }, evidence: { items: [] }, timetable: { events: [meeting,
      { ...meeting, id: 'live-1', eventKey: 'live-1', source: 'live-session', title: 'Example Lesson' }] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows only dashboard skeletons while the initial request is pending', async () => {
  vi.useRealTimers();
  const finishLoads: Array<(value: unknown) => void> = [];
  mocks.load.mockImplementation(() => new Promise(resolve => { finishLoads.push(resolve); }));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(screen.getByRole('status', { name: 'Loading coach dashboard' })).toBeVisible();
  expect(screen.queryByText('No learners assigned to you yet')).not.toBeInTheDocument();
  expect(screen.queryByText('Data not available')).not.toBeInTheDocument();
  expect(screen.queryByText('--')).not.toBeInTheDocument();
  finishLoads.forEach(resolve => resolve({ owner: { name: 'Example Coach' }, learners: [], timetable: { events: [] } }));
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();
});

it('shows the learner table only after a successful response', async () => {
  vi.useRealTimers();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(screen.getByRole('status', { name: 'Loading coach dashboard' })).toBeVisible();
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  expect(await within(riskTable).findByText('Example Learner')).toBeVisible();
  expect(screen.queryByRole('status', { name: 'Loading coach dashboard' })).not.toBeInTheDocument();
});

it('shows the learner empty state only after an empty response finishes', async () => {
  vi.useRealTimers();
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue') ? { summary: { pendingItems: 0 } } : { owner: { name: 'Example Coach' }, learners: [], timetable: { events: [] } },
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
  Object.assign(mocks.coach, { email: 'next-coach@example.invalid', name: 'Next Coach' });
  rerender(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(screen.getByRole('status', { name: 'Loading coach dashboard' })).toBeVisible();
  expect(screen.queryByText('Example Learner')).not.toBeInTheDocument();
  expect(screen.queryByText('No learners assigned to you yet')).not.toBeInTheDocument();
  finishLoads.forEach(resolve => resolve({ owner: { name: 'Next Coach' }, learners: [], timetable: { events: [] } }));
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();
});

it('shows serialized latest completed MCM and PR and ignores future or cancelled sessions', async () => {
  vi.useRealTimers();
  mocks.calendar.mockResolvedValue({ events: [
    { ...meeting, id: 'completed-coaching', status: 'completed', scheduledDate: '2026-09-12' },
    { ...meeting, id: 'completed-review', source: 'progress-review', type: 'review', status: 'completed', scheduledDate: '2026-09-15' },
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
          evidence: { items: [] },
          timetable: { events: [] },
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

it('keeps the live session calendar link while showing the new actions only on coaching meetings', async () => {
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: 'Send Reminder' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Generate Presentation' })).toBeVisible();
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
  expect(screen.queryByRole('heading', { name: 'My Assigned Groups' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "Today's schedule" })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Caseload health' })).not.toBeInTheDocument();
  const riskTable = await screen.findByRole('region', { name: 'Coach learner caseload' });
  expect(within(riskTable).getByRole('heading', { name: 'All Learners' })).toBeVisible();
  expect(within(riskTable).getByRole('columnheader', { name: 'Progress' })).toBeVisible();
  expect(await within(riskTable).findByText('Example Learner')).toBeVisible();
  expect(await within(riskTable).findByText('Attention Only Learner')).toBeVisible();
  expect(within(riskTable).queryByRole('region', { name: 'OTJH caseload summary' })).not.toBeInTheDocument();
  expect(within(riskTable).getByRole('button', { name: 'Status' })).toBeVisible();
  expect(screen.queryByRole('link', { name: /View all learners/ })).not.toBeInTheDocument();
  const insights = screen.getByRole('region', { name: 'Learner risk insights' });
  expect(within(insights).getByRole('heading', { name: 'Risk Distribution' })).toBeVisible();
  expect(within(insights).getByRole('heading', { name: 'Monthly Learners at Risk' })).toBeVisible();
  expect(within(insights).getByRole('list', { name: 'Learners at risk at each month end' })).toBeVisible();
  expect(within(insights).getByRole('listitem', { name: 'Jun: 4 learners at risk' })).toBeVisible();
  expect(within(insights).queryByText('History not available')).not.toBeInTheDocument();
  expect(within(insights).getByRole('list', { name: 'Active learners by OTJH status' })).toBeVisible();
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
          evidence: { items: [] },
          timetable: { events: [] },
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
      : { owner: { name: 'Example Coach' }, learners: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'at-risk' }], timetable: { events: dashboardEvents } },
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

it('counts delivery learners with active learners on the coach dashboard', async () => {
  useDashboardDate();
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [
            { id: '1', name: 'Active Learner', rawProgramStatus: 'active', otjhStatus: 'on-track' },
            { id: '2', name: 'Delivery Learner', rawProgramStatus: 'delivery', otjhStatus: 'on-track' },
          ],
          timetable: { events: [] },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const metrics = await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  const totalLearners = within(metrics).getByRole('button', { name: 'Open Total learners details' });
  expect(totalLearners.querySelector('[class*="metricValue"]')).toHaveTextContent('2');
  expect(screen.getByText('2 active learners grouped by their current OTJH status.')).toBeVisible();
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
          evidence: { items: [{ id: 'evidence-1', learnerId: '1', learner: 'Example Learner', pendingEvidence: 2, totalEvidence: 2 }] },
          timetable: { events: dashboardEvents },
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
