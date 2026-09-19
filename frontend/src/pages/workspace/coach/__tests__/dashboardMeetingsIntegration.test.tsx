import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import CoachDashboard from '../page';

const mocks = vi.hoisted(() => ({ load: vi.fn(), schedule: vi.fn(), calendar: vi.fn() }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isInitialized: true, auth: { account: { email: 'coach@example.invalid' } } }) }));
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => ({ email: 'coach@example.invalid', name: 'Example Coach', isInitialized: true, isViewingAsCoach: false }) }));
vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: mocks.load }));
vi.mock('@/pages/coach/shared/calendarEvents', async original => ({
  ...await original<typeof import('@/pages/coach/shared/calendarEvents')>(),
  scheduleCoachCalendarEvent: mocks.schedule,
  fetchCoachCalendarEvents: mocks.calendar,
}));
vi.mock('@/pages/coach/progress-reviews/components/ProgressReviewPptxModal', () => ({ default: () => null }));
vi.mock('../CoachDirectoryPicker', () => ({ CoachDirectoryPicker: () => null }));
vi.mock('../AllCoachesCalendar', () => ({ AllCoachesCalendar: () => null }));

const meeting: CoachCalendarEvent = { id: 'meeting-1', eventKey: 'mcr:1:1', title: 'Monthly Coaching', source: 'mcr', type: 'coaching',
  learnerId: '1', learner: 'Example Learner', status: 'scheduled', scheduledDate: '2026-09-21', scheduledTime: '10:30', durationMinutes: 60 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.calendar.mockResolvedValue({ events: [] });
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-09-18T10:00:00Z'));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  mocks.load.mockResolvedValue({ owner: { name: 'Example Coach' }, learners: [{ id: '1', name: 'Example Learner', learnerType: 'commercial',
    rawProgramStatus: 'active', otjhStatus: 'at-risk' }, { id: '2', name: 'Attention Only Learner', learnerType: 'commercial',
    rawProgramStatus: 'active', otjhStatus: 'need-attention' }], attendance: { learners: [{ id: '2', learner: 'Attention Only Learner', attendance: 50 }] }, evidence: { items: [] }, timetable: { events: [meeting,
      { ...meeting, id: 'live-1', eventKey: 'live-1', source: 'live-session', title: 'Example Lesson' }] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps the live session calendar link while showing the new actions only on coaching meetings', async () => {
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: 'Send Reminder' })).toBeEnabled();
  const meetings = screen.getByRole('region', { name: 'Upcoming meetings and live sessions' });
  expect(within(meetings).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  expect(within(meetings).getAllByText('Scheduled')).toHaveLength(2);
  expect(within(meetings).getAllByRole('button', { name: 'Reschedule' })).toHaveLength(1);
  expect(within(meetings).getByRole('link', { name: /View .* in calendar/ })).toHaveAttribute('href', '/coach/timetable');
  expect(screen.queryByRole('heading', { name: 'My Assigned Groups' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "Today's schedule" })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Caseload health' })).not.toBeInTheDocument();
  const riskTable = screen.getByRole('region', { name: 'Learners at OTJH risk' });
  expect(within(riskTable).getByText('Example Learner')).toBeVisible();
  expect(within(riskTable).queryByText('Attention Only Learner')).not.toBeInTheDocument();
  expect(within(riskTable).queryByRole('columnheader', { name: 'Risk type' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /All/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: /At Risk/ })).not.toBeInTheDocument();
  const distribution = screen.getByRole('list', { name: 'Active learners by OTJH status' });
  expect(within(distribution).getByText('At Risk').closest('li')).toHaveTextContent('1 (50%)');
  expect(within(distribution).getByText('Need Attention').closest('li')).toHaveTextContent('1 (50%)');
  expect(within(distribution).getByText('On Track').closest('li')).toHaveTextContent('0 (0%)');
  expect(within(distribution).getByText('No OTJH status').closest('li')).toHaveTextContent('0 (0%)');
  expect(within(distribution).queryByText('Poor Attendance')).not.toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledWith('/coach_api/coach/dashboard', expect.objectContaining({ credentials: 'include' }));
});

it('does not show the caseload owner name as learner session activity', async () => {
  mocks.load.mockImplementation((url: string) => Promise.resolve(
    url.includes('/marking-queue')
      ? { summary: { pendingItems: 0 } }
      : {
          owner: { name: 'Example Coach' },
          learners: [{
            id: '1', name: 'Example Learner', lastContact: 'Incorrect Coach Name',
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
  const riskTable = await screen.findByRole('region', { name: 'Learners at OTJH risk' });
  expect(within(riskTable).queryByRole('columnheader', { name: 'Last contact' })).not.toBeInTheDocument();
  expect(within(riskTable).queryByText('Incorrect Coach Name')).not.toBeInTheDocument();
});

it('shows the latest completed MCM and PR and ignores future or cancelled sessions', async () => {
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
          learners: [{ id: '1', name: 'Example Learner', rawProgramStatus: 'active', otjhStatus: 'at-risk' }],
          attendance: { learners: [{ id: '1', learner: 'Example Learner', attendance: 90, lastSession: '10 Sep 2026', lastSessionDate: '2026-09-10' }] },
          evidence: { items: [] },
          timetable: { events: [] },
        },
  ));

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const riskTable = await screen.findByRole('region', { name: 'Learners at OTJH risk' });
  const row = within(riskTable).getByText('Example Learner').closest('tr');
  expect(row).not.toBeNull();
  expect(within(row!).getByRole('cell', { name: '12 Sept 2026' })).toBeVisible();
  expect(within(row!).getByRole('cell', { name: '15 Sept 2026' })).toBeVisible();
  expect(within(riskTable).queryByText('21 Sept 2026')).not.toBeInTheDocument();
  expect(within(riskTable).queryByText('17 Sept 2026')).not.toBeInTheDocument();
});

it('keeps a Teams warning visible when a rescheduled meeting moves out of the seven-day preview', async () => {
  mocks.schedule.mockResolvedValue({ event: { ...meeting, scheduledDate: '2026-10-10' }, warning: 'Teams sync needs retry.' });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Reschedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save new time' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Send Reminder' })).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('Teams sync needs retry.');
  expect(screen.getByRole('link', { name: /View .* in calendar/ })).toBeVisible();
});

it('shows the six requested workload cards using the current week and marking queue', async () => {
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
    'PR this week': '1',
    'MCM this week': '1',
    'Catch-ups this week': '1',
  });
  expect(within(metrics).queryByText('Learners engagement')).not.toBeInTheDocument();
  expect(within(metrics).queryByText('PR 12-week')).not.toBeInTheDocument();
  expect(within(metrics).queryByText('Referred closure')).not.toBeInTheDocument();
  expect(within(metrics).queryByText('MCM 4-week')).not.toBeInTheDocument();
});
