import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { formatDateLabel, reviewScheduleAvailable, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { getCurrentWorkWeekRange, isEventThisWeek } from '@/features/coach/dashboard/api/dashboardWeek';
import { isVisibleCaseloadLearner, otjhProgressAsOfToday } from '@/pages/coach/caseload/lib/format';
import type { CaseloadApiLearner } from '@/pages/coach/caseload/types';
import CoachDashboard, { clearCoachDashboardSessionCache, CompactWeeklyMeetingDetails } from '../page';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), schedule: vi.fn(), calendar: vi.fn(), coachFetch: vi.fn(),
  coach: { email: 'coach@example.invalid', name: 'Example Coach', isInitialized: true, isViewingAsCoach: false },
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/useAuth', () => {
  const account = { email: 'coach@example.invalid' };
  return { useAuth: () => ({ isInitialized: true, auth: { account } }) };
});
vi.mock('@/hooks/useCoachIdentity', () => ({ useCoachIdentity: () => mocks.coach }));
vi.mock('@/lib/sharedGetJson', () => ({ fetchSharedJsonGet: async (url: string, options: unknown) => {
  const originalFixture = await mocks.load(url, options);
  if (originalFixture.learnerPopup) return originalFixture;
  // Historical scenario fixtures describe the aggregate inputs. Model the
  // new server contract here; production consumers receive these scalars.
  const canonical = (learner: CaseloadApiLearner) => {
    const old = otjhProgressAsOfToday({ ...learner, otjhRagStatus: undefined });
    const target = learner.otjhTargetAsOfToday ?? old.targetHours;
    const actual = learner.otjhCompleted ?? 0;
    return { ...learner,
      otjhRagStatus: learner.otjhRagStatus ?? old.status,
      otjhTargetAsOfToday: target,
      otjhShortfallHours: 'otjhShortfallHours' in learner ? learner.otjhShortfallHours : target === null ? null : Math.max(target - actual, 0),
      otjhProgressAsOfToday: 'otjhProgressAsOfToday' in learner ? learner.otjhProgressAsOfToday : target && target > 0 ? Math.min(actual / target * 100, 100) : null,
      otjhDeltaHours: 'otjhDeltaHours' in learner ? learner.otjhDeltaHours : target === null ? null : actual - target,
    };
  };
  const fixture = { ...originalFixture,
    ...(originalFixture.learners ? { learners: originalFixture.learners.map(canonical) } : {}),
    ...(originalFixture.results ? { results: originalFixture.results.map(canonical) } : {}),
  };
  if (url.includes('/dashboard/summary')) {
    const events = fixture.meetings?.events || [];
    const ids = new Set((fixture.learners || []).filter((learner: { rawProgramStatus?: string }) => ['active', 'delivery'].includes(learner.rawProgramStatus?.toLowerCase() || '')).map((learner: { id: string }) => learner.id));
    const week = events.filter((event: CoachCalendarEvent) => ids.has(event.learnerId) && event.status !== 'cancelled' && isEventThisWeek(event));
    const counts = fixture.weeklyCounts || {
      progressReviews: week.filter((event: CoachCalendarEvent) => event.source === 'progress-review').length,
      monthlyCoaching: week.filter((event: CoachCalendarEvent) => event.source === 'mcr').length,
      catchUps: week.filter((event: CoachCalendarEvent) => event.source === 'catch-up').length,
      reviewsAvailable: reviewScheduleAvailable(fixture.meetings?.summary, events, fixture.meetings?.reviewGenerationIssues || []),
    };
    const visible = (fixture.learners || []).filter(isVisibleCaseloadLearner);
    const active = visible.filter((learner: CaseloadApiLearner) => ['active', 'delivery'].includes(learner.rawProgramStatus?.toLowerCase() || ''));
    const totals = fixture.totals || {
      totalLearners: visible.length,
      otjhAtRisk: active.filter((learner: CaseloadApiLearner) => learner.otjhRagStatus === 'at-risk').length,
      needAttention: active.filter((learner: CaseloadApiLearner) => learner.otjhRagStatus === 'need-attention').length,
      pendingMarking: fixture.marking?.summary?.pendingItems ?? new Set((fixture.marking?.items || []).map((item: { id: string }) => item.id)).size,
      prThisWeek: counts.reviewsAvailable ? counts.progressReviews : null,
      mcmThisWeek: counts.reviewsAvailable ? counts.monthlyCoaching : null,
      catchUpsThisWeek: counts.catchUps,
    };
    const response = { ...fixture, totalLearners: totals.totalLearners,
      otjh: { atRisk: totals.otjhAtRisk, needAttention: totals.needAttention },
      pendingMarking: totals.pendingMarking,
      meetingsThisWeek: { pr: totals.prThisWeek, mcm: totals.mcmThisWeek, catchUps: totals.catchUpsThisWeek },
      meetings: { summary: fixture.meetings?.summary, reviewGenerationIssues: fixture.meetings?.reviewGenerationIssues },
    };
    delete response.weeklyCounts;
    delete response.totals;
    return {
      owner: { name: response.owner?.name },
      summary: { totalLearners: response.totalLearners, otjh: response.otjh,
        pendingMarking: response.pendingMarking, meetingsThisWeek: response.meetingsThisWeek },
      learnerPopup: {
        all: visible.map((learner: CaseloadApiLearner & { programme?: string }) => ({
          id: learner.id, name: learner.name, initials: learner.initials, learnerType: learner.learnerType, enrolmentId: learner.enrolmentId, programmeStatus: learner.rawProgramStatus, programme: learner.programmeName || learner.programme || learner.cohortName,
          group: learner.group,
          otjh: { completed: learner.otjhCompleted, target: learner.otjhTargetAsOfToday ?? null,
            planned: learner.otjhPlanned ?? null, ragStatus: learner.otjhRagStatus },
        })),
        atRisk: active.filter((learner: CaseloadApiLearner) => learner.otjhRagStatus === 'at-risk').map((learner: CaseloadApiLearner) => learner.id),
      },
      markingPopup: { count: response.pendingMarking, items: response.marking?.items || [] },
      meetingsPopup: Object.fromEntries((['pr', 'mcm', 'catchUps'] as const).map(key => [key, {
        count: response.meetingsThisWeek[key],
        items: week.filter((event: CoachCalendarEvent) => event.source === (key === 'pr' ? 'progress-review' : key === 'mcm' ? 'mcr' : 'catch-up'))
          .map((event: CoachCalendarEvent) => ({ learnerId: event.learnerId, learnerName: event.learner || event.title,
            programme: event.programme, group: event.group, date: event.scheduledDate || event.date || event.targetDate,
            time: event.scheduledTime || event.timeLabel || null, durationMinutes: event.durationMinutes || 60, status: event.status })),
      }])),
    };
  }
  return fixture;
} }));
vi.mock('@/lib/coachFetch', () => ({ coachFetch: mocks.coachFetch }));
vi.mock('@/lib/coachViewAs', () => ({
  setCoachViewAs: vi.fn(),
  withCoachViewAs: (url: string) => mocks.coach.isViewingAsCoach
    ? `${url}${url.includes('?') ? '&' : '?'}viewAsCoach=${encodeURIComponent(mocks.coach.email)}`
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
  const table = screen.getByRole('table', { name: 'Learners are loading' });
  for (const column of ['Learner', 'Status', 'Progress', 'OTJH', 'Activities', 'Attendance', 'Start Date', 'Last Activity', 'Last PR', 'Last MCM', 'Actions']) {
    expect(within(table).getByRole('columnheader', { name: column })).toBeInTheDocument();
  }
  for (const tabLabel of ['All Learners', 'Upcoming Meetings', 'Risk Insights']) {
    expect(screen.getByRole('tab', { name: tabLabel })).toBeVisible();
  }
  expect(screen.queryByText('No learners assigned to you yet')).not.toBeInTheDocument();
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
  expect(await screen.findByRole('region', { name: 'Learner risk insights' })).toBeVisible();
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(mocks.load).toHaveBeenCalledWith('/coach_api/coach/dashboard/summary', expect.objectContaining({ credentials: 'include' }));
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
  expect(mocks.load).toHaveBeenCalledTimes(3);
  await act(async () => {
    finishRefresh({ owner: { name: 'Example Coach' }, learners: [], meetings: { events: [] } });
  });
});

it('loads only summary and all learners initially, leaving other sections on demand', async () => {
  vi.useRealTimers();
  const requestOrder: string[] = [];
  mocks.load.mockImplementation(async (url: string) => {
    requestOrder.push(url);
    return { owner: { name: 'Example Coach' }, learners: [], meetings: { events: [] } };
  });

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();

  expect(requestOrder).toHaveLength(2);
  expect(requestOrder).toContain('/coach_api/coach/dashboard/summary');
  expect(requestOrder).toContain('/coach_api/coach/dashboard/learners');
  expect(mocks.calendar).not.toHaveBeenCalled();
  expect(mocks.coachFetch).not.toHaveBeenCalled();
});

it('keeps the existing request count for learner, marking and weekly meeting popups', async () => {
  vi.useRealTimers();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await screen.findByRole('region', { name: 'Coach dashboard metrics' });
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  for (const [card, title] of [['Total learners', 'Learner caseload'], ['OTJH at risk', 'Learners at risk'], ['Pending marking', 'Pending marking']]) {
    fireEvent.click(screen.getByRole('button', { name: `Open ${card} details` }));
    const dialog = await screen.findByRole('dialog', { name: title });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close popup' }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Open MCM this week details' }));
  await screen.findByRole('dialog', { name: 'Monthly coaching this week' });
  // Summary supplies weekly details, so opening adds no request.
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.load.mock.calls.some(([url]) => String(url).includes('/dashboard/meetings'))).toBe(false);
});

it('renders learners while summary remains pending', async () => {
  vi.useRealTimers();
  let finishSummary!: (value: unknown) => void;
  mocks.load.mockImplementation((url: string) => url.includes('/summary')
    ? new Promise(resolve => { finishSummary = resolve; })
    : Promise.resolve({ results: [{ id: '1', name: 'Independent Learner', rawProgramStatus: 'active' }], pagination: { total: 1, totalPages: 1 } }));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('Independent Learner')).toBeVisible();
  expect(screen.getByRole('status', { name: 'Loading coach dashboard' })).toBeVisible();
  await act(async () => finishSummary({ learners: [], weeklyCounts: { progressReviews: 0, monthlyCoaching: 0, catchUps: 0, reviewsAvailable: true } }));
  expect(screen.getByRole('region', { name: 'Coach dashboard metrics' })).toBeVisible();
});

it('keeps learners visible when summary fails independently', async () => {
  vi.useRealTimers();
  mocks.load.mockImplementation((url: string) => url.includes('/summary')
    ? Promise.reject(new Error('Summary unavailable'))
    : Promise.resolve({ results: [{ id: '1', name: 'Independent Learner', rawProgramStatus: 'active' }], pagination: { total: 1, totalPages: 1 } }));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('Independent Learner')).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Retry summary' })).toBeVisible();
  expect(screen.getByText('Independent Learner')).toBeVisible();
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/learners'))).toHaveLength(1);
});

it('loads each optional section once and reuses it when switching tabs', async () => {
  useDashboardDate();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('Example Learner')).toBeVisible();
  expect(mocks.load.mock.calls.filter(([url]) => /\/(meetings|risk)(?:\?|$)/.test(url))).toHaveLength(0);
  fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
  expect(await screen.findByRole('region', { name: 'Upcoming meetings and live sessions' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Risk Insights' }));
  expect(await screen.findByRole('region', { name: 'Learner risk insights' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'All Learners' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Risk Insights' }));
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/dashboard/meetings?'))).toHaveLength(1);
  expect(mocks.load.mock.calls.find(([url]) => url.includes('/dashboard/meetings?'))?.[0])
    .toBe('/coach_api/coach/dashboard/meetings?from=2026-09-21&to=2026-09-25');
  expect(mocks.load.mock.calls.filter(([url]) => url.endsWith('/risk'))).toHaveLength(1);
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/learners'))).toHaveLength(1);
});

it.each([{ includeStatus: false, expected: 1 }, { includeStatus: true, expected: 7 }])(
  'strict summary contract with programme status=$includeStatus renders $expected upcoming meetings', async ({ includeStatus, expected }) => {
    useDashboardDate();
    const learners = ['1', '2'].map(id => ({ id, name: `Synthetic Learner ${id}`, programme: 'Programme', group: 'Group',
      ...(includeStatus ? { programmeStatus: id === '1' ? 'Active' : 'Delivery' } : {}),
      otjh: { completed: 100, target: 100, planned: 400, ragStatus: 'on-track' },
    }));
    const events = ['progress-review', 'mcm', 'catch-up'].flatMap(type => learners.map(learner => ({
      id: `${type}-${learner.id}`, eventKey: `${type}:${learner.id}`, type,
      date: '2026-09-23', time: '10:30', durationMinutes: 60,
      learner: { id: learner.id, name: learner.name }, title: type, programme: 'Programme', group: 'Group', status: 'scheduled',
    })));
    const live = { id: 'live-no-learner', type: 'live-session', date: '2026-09-23', time: '09:00', durationMinutes: 120,
      title: 'Synthetic Live Session', programme: 'Programme', cohort: 'Cohort', group: 'Group', status: 'scheduled',
      timeLabel: '09:00 - 11:00', meetingLink: 'https://example.invalid/join' };
    mocks.load.mockImplementation(async (url: string) => url.includes('/summary') ? {
      owner: { name: 'Synthetic Coach' },
      summary: { totalLearners: 2, otjh: { atRisk: 0, needAttention: 0 }, pendingMarking: 0,
        meetingsThisWeek: { pr: 0, mcm: 0, catchUps: 0 } },
      learnerPopup: { all: learners, atRisk: [] }, markingPopup: { count: 0, items: [] },
      meetingsPopup: { pr: { count: 0, items: [] }, mcm: { count: 0, items: [] }, catchUps: { count: 0, items: [] } },
    } : url.includes('/meetings?') ? {
      meetings: { range: { from: '2026-09-21', to: '2026-09-25' }, events: [...events, live] }, errors: {},
    } : { results: [] });
    render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
    await screen.findByRole('button', { name: 'Open PR this week details' });
    fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
    const region = await screen.findByRole('region', { name: 'Upcoming meetings and live sessions' });
    expect(region.querySelectorAll('[data-meeting-row="true"]')).toHaveLength(expected);
    expect(within(region).getByText('Synthetic Live Session')).toBeVisible();
    if (includeStatus) {
      expect(within(region).getAllByText('Synthetic Learner 1', { selector: 'span' })).toHaveLength(3);
      expect(within(region).getAllByText('Synthetic Learner 2', { selector: 'span' })).toHaveLength(3);
    }
    expect(mocks.load.mock.calls.filter(([url]) => url.includes('/dashboard/meetings?'))).toHaveLength(1);
    expect(mocks.calendar).not.toHaveBeenCalled();
    expect(mocks.coachFetch).not.toHaveBeenCalled();
  },
);

it('updates open KPI popups and upcoming meetings automatically at London Monday midnight', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-20T22:59:59Z'));
  const fixture = await mocks.load();
  const events = [
    { ...meeting, id: 'last-week', source: 'progress-review', scheduledDate: '2026-09-18', programme: 'Previous Week' },
    { ...meeting, id: 'new-week-1', source: 'progress-review', scheduledDate: '2026-09-21', programme: 'Current Week' },
    { ...meeting, id: 'new-week-2', source: 'progress-review', scheduledDate: '2026-09-22', programme: 'Current Week' },
    { ...meeting, id: 'upcoming', scheduledDate: '2026-09-28', learner: 'Next Week Learner' },
  ].map(event => ({ ...event, eventKey: event.id }));
  mocks.load.mockImplementation(async () => ({ ...fixture, meetings: { events } }));
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const pr = await screen.findByRole('button', { name: 'Open PR this week details' });
  expect(pr).toHaveTextContent('1');
  fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
  await screen.findByRole('region', { name: 'Upcoming meetings and live sessions' });
  fireEvent.click(pr);
  expect(await screen.findByText(/Previous Week/)).toBeVisible();
  act(() => vi.advanceTimersByTime(1000));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR this week details' })).toHaveTextContent('2'));
  expect(screen.queryByText(/Previous Week/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Current Week/)).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
  const region = await screen.findByRole('region', { name: 'Upcoming meetings and live sessions' });
  expect(within(region).getByText('Next Week Learner', { selector: 'span' })).toBeVisible();
  expect(mocks.load.mock.calls.some(([url]) => String(url).includes('from=2026-09-28&to=2026-10-02'))).toBe(true);
});

it('renders the compact upcoming contract and preserves forms and live calendar navigation with one section request', async () => {
  useDashboardDate();
  const fixture = await mocks.load();
  mocks.load.mockImplementation(async (url: string) => url.includes('/dashboard/meetings?') ? {
    meetings: { range: { from: '2026-09-21', to: '2026-09-25' }, events: [
      { id: 'mcm-compact', eventKey: 'mcr:1:1', type: 'mcm', date: '2026-09-23', time: '10:30', durationMinutes: 60,
        learner: { id: '1', name: 'Example Learner' }, title: 'Monthly Coaching', programme: 'Programme', group: 'Group',
        status: 'scheduled', reviewInstanceId: 'instance-compact', enrolmentId: '22', startHour: 10.5 },
      { id: 'live-compact', eventKey: 'live-focus', type: 'live-session', date: '2026-09-23', time: '09:00', durationMinutes: 120,
        title: 'Compact Live Lesson', programme: 'Programme', cohort: 'Cohort', group: 'Group', status: 'scheduled',
        startHour: 9, timeLabel: '09:00 - 11:00', meetingLink: 'https://example.invalid/join' },
    ] }, errors: {},
  } : fixture);
  mocks.load.mockClear();
  render(<MemoryRouter><CoachDashboard /><ModalLocationProbe /></MemoryRouter>);
  expect(await screen.findByText('Example Learner')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Upcoming Meetings' }));
  const region = await screen.findByRole('region', { name: 'Upcoming meetings and live sessions' });
  expect(within(region).getByText('Example Learner', { selector: 'span' })).toBeVisible();
  expect(within(region).getByText('Monthly Coaching')).toBeVisible();
  expect(within(region).getByText('10:30 - 11:30')).toBeVisible();
  expect(within(region).getByText('09:00 - 11:00')).toBeVisible();
  expect(within(region).getByRole('button', { name: 'Reschedule' })).toBeEnabled();
  expect(within(region).getByRole('button', { name: 'Send Reminder' })).toBeEnabled();
  fireEvent.click(within(region).getByRole('button', { name: 'View Form' }));
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/coach/review-instances/instance-compact'));
  fireEvent.click(within(region).getByRole('link', { name: 'View Compact Live Lesson in calendar' }));
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/coach/timetable');
  expect(screen.getByLabelText('Current route')).toHaveTextContent('live-focus');
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/dashboard/meetings?'))).toHaveLength(1);
  expect(mocks.calendar).not.toHaveBeenCalled();
  expect(mocks.coachFetch).not.toHaveBeenCalled();
});

it('paginates the full cached dataset without reloading learners or summary', async () => {
  vi.useRealTimers();
  mocks.load.mockImplementation(async (url: string) => url.includes('/learners')
    ? { results: Array.from({ length: 16 }, (_, index) => ({ id: String(index), name: `Learner ${String(index).padStart(2, '0')}`, rawProgramStatus: 'active' })) }
    : { learners: [], weeklyCounts: { progressReviews: 0, monthlyCoaching: 0, catchUps: 0, reviewsAvailable: true } });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('Learner 00')).toBeVisible();
  expect(screen.queryByText('Learner 15')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('Learner 15')).toBeVisible();
  expect(screen.queryByText('Learner 00')).not.toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.load).toHaveBeenCalledWith('/coach_api/coach/dashboard/learners', expect.anything());
});

it('uses backend global totals and canonical OTJH values independently of the learner page', async () => {
  vi.useRealTimers();
  const row = { id: '1', name: 'Canonical Learner', rawProgramStatus: 'active', status: 'at-risk', otjhStatus: 'at-risk',
    otjhCompleted: 170, otjhTarget: 999, otjhTargetAsOfToday: 200, otjhShortfallHours: 30,
    otjhProgressAsOfToday: 85, otjhDeltaHours: -30, otjhRagStatus: 'need-attention' };
  mocks.load.mockImplementation(async (url: string) => url.includes('/summary')
    // Global risk totals must be backed by the full popup dataset, not this page.
    ? { learners: [row, ...Array.from({ length: 16 }, (_, index) => ({ ...row, id: `risk-${index}`,
        name: `Global Risk ${index}`, otjhRagStatus: 'at-risk' }))], totals: { totalLearners: 32, otjhAtRisk: 16, needAttention: 8, pendingMarking: 7,
        prThisWeek: 3, mcmThisWeek: 4, catchUpsThisWeek: 2 },
        weeklyCounts: { progressReviews: 3, monthlyCoaching: 4, catchUps: 2, reviewsAvailable: true } }
    : { results: [row, ...Array.from({ length: 31 }, (_, index) => ({ ...row, id: `other-${index}`, name: `Other Learner ${index}` }))] });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('Canonical Learner')).toBeVisible();
  const totalCard = () => screen.getByRole('button', { name: 'Open Total learners details' });
  expect(within(totalCard()).getByText('32')).toBeVisible();
  expect(within(screen.getByRole('button', { name: 'Open OTJH at risk details' })).getByText('16')).toBeVisible();
  expect(screen.getByText('8 need attention')).toBeVisible();
  expect(within(screen.getByRole('button', { name: 'Open Pending marking details' })).getByText('7')).toBeVisible();
  const learnerRow = screen.getByText('Canonical Learner').closest('tr')!;
  expect(within(learnerRow).getByLabelText('OTJH: 85%')).toBeVisible();
  expect(within(learnerRow).getByText('170h / 200h')).toBeVisible();
  expect(within(learnerRow).queryByText('999')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/learners'))).toHaveLength(1);
  expect(within(totalCard()).getByText('32')).toBeVisible();
});

it('adds the effective coach once when an administrator views a coach dashboard', async () => {
  vi.useRealTimers();
  Object.assign(mocks.coach, {
    email: 'selected.coach@example.invalid', name: 'Selected Coach', isViewingAsCoach: true,
  });

  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByRole('region', { name: 'Coach learner caseload' })).toBeVisible();

  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.load).toHaveBeenCalledWith(
    '/coach_api/coach/dashboard/summary?viewAsCoach=selected.coach%40example.invalid',
    expect.objectContaining({ credentials: 'include' }),
  );
});

it('retries a failed section once while the other request can succeed', async () => {
  useDashboardDate();
  let summaryAttempts = 0;
  mocks.load.mockImplementation(async (url: string) => {
    if (url.endsWith('/summary') && summaryAttempts++ === 0) throw new Error('Temporary failure');
    return { owner: { name: 'Example Coach' }, learners: [], weeklyCounts: { progressReviews: 0, monthlyCoaching: 0, catchUps: 0, reviewsAvailable: true } };
  });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();
  expect(await screen.findByRole('region', { name: 'Coach dashboard metrics' })).toBeVisible();
  expect(mocks.load.mock.calls.filter(([url]) => url.endsWith('/summary'))).toHaveLength(2);
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/learners'))).toHaveLength(1);
});

it('aborts the previous summary and learner requests when the effective coach changes', async () => {
  vi.useRealTimers();
  const signals: AbortSignal[] = [];
  mocks.load.mockImplementation((_: string, options: { signal: AbortSignal }) => {
    signals.push(options.signal);
    if (signals.length === 1) return new Promise(() => undefined);
    return Promise.resolve({ owner: { name: 'Next Coach' }, learners: [], meetings: { events: [] } });
  });

  const { rerender } = render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(signals).toHaveLength(2);
  Object.assign(mocks.coach, { email: 'next-coach@example.invalid', name: 'Next Coach' });
  rerender(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  expect(await screen.findByText('No learners assigned to you yet')).toBeVisible();

  expect(signals).toHaveLength(4);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(true);
  expect(signals[2].aborted).toBe(false);
  expect(signals[3].aborted).toBe(false);
});

it('renders only the table activity and attendance metrics without requesting KSB details', async () => {
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
  expect(within(row!).queryByText('85.3%')).not.toBeInTheDocument();
  expect(within(row!).getByText('87.3%')).toBeVisible();
  expect(within(row!).getByText('80%')).toBeVisible();
  expect(within(row!).queryByText('498 / 584')).not.toBeInTheDocument();
  expect(within(row!).getByText('137 / 157')).toBeVisible();
  expect(within(row!).getByLabelText('Attendance: 80%')).toBeVisible();
  expect(mocks.load).toHaveBeenCalledTimes(2);
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
        lastProgressReview: '--', lastReview: '--',
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
  expect(within(zeroRow).queryByLabelText('KSBs: 0%')).not.toBeInTheDocument();
  expect(within(zeroRow).getByLabelText('Activities: 0%')).toBeVisible();
  expect(within(zeroRow).getByLabelText('Attendance: 0%')).toBeVisible();
  expect(within(zeroRow).getByText('18 Sep 2026')).toBeVisible();
  expect(within(zeroRow).getByText('12 Sep 2026')).toBeVisible();
  expect(within(zeroRow).getByText('14 Sep 2026')).toBeVisible();

  const unavailableRow = (await within(region).findByText('Unavailable Learner')).closest('tr')!;
  expect(within(unavailableRow).getByLabelText('OTJH: not available')).toBeVisible();
  expect(within(unavailableRow).queryByLabelText('KSBs: not available')).not.toBeInTheDocument();
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
  expect(await screen.findByText('Unable to load coach dashboard summary')).toBeVisible();
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
  const insights = await screen.findByRole('region', { name: 'Learner risk insights' });
  for (const title of ['Attendance Insights', 'OTJH Insights', 'Review Insights']) {
    expect(within(insights).getByRole('heading', { name: title })).toBeVisible();
    fireEvent.click(within(insights).getByRole('button', { name: `Expand ${title}` }));
  }
  expect(within(insights).getByRole('region', { name: 'Attendance risk insights' })).toBeVisible();
  expect(within(insights).getByRole('region', { name: 'OTJH risk insights' })).toBeVisible();
  expect(within(insights).getByRole('region', { name: 'Review risk insights' })).toBeVisible();
  expect(mocks.load).toHaveBeenCalledWith('/coach_api/coach/dashboard/summary', expect.objectContaining({ credentials: 'include' }));
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
  const upcoming = await screen.findByRole('region', { name: 'Upcoming meetings and live sessions' });
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
  await screen.findByRole('region', { name: 'Learner risk insights' });
  for (const title of ['Attendance Insights', 'OTJH Insights', 'Review Insights']) {
    fireEvent.click(await screen.findByRole('button', { name: `Expand ${title}` }));
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


function ModalLocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}</output>;
}

function setCleanPopupFixture() {
  const atRisk = Array.from({ length: 9 }, (_, index) => ({
    id: `risk-${index}`, name: index < 2 ? 'Shared Learner Name' : `Risk Learner ${index}`,
    programme: 'Programme A', group: `Group R${index}`,
    otjh: { completed: index, target: 40, planned: 288, ragStatus: 'at-risk' },
    // Removed legacy fields must not override the nested popup status.
    ...(index === 0 ? { status: 'on-track', otjhStatus: 'on-track', otjhRagStatus: 'on-track' } : {}),
  }));
  const other = ['need-attention', 'on-track', 'unavailable'].map((ragStatus, index) => ({
    id: `other-${index}`, name: `Other Learner ${index}`, programme: null, group: null,
    otjh: { completed: null, target: null, planned: null, ragStatus },
    status: 'at-risk', otjhStatus: 'at-risk', otjhRagStatus: 'at-risk',
  }));
  mocks.load.mockResolvedValue({
    owner: { name: 'Example Coach' },
    summary: { totalLearners: 12, otjh: { atRisk: 9, needAttention: 1 }, pendingMarking: 0,
      meetingsThisWeek: { pr: 0, mcm: 0, catchUps: 0 } },
    learnerPopup: { all: [...atRisk, ...other], atRisk: [] },
    markingPopup: { count: 0, items: [] },
    meetingsPopup: { pr: { count: 0, items: [] }, mcm: { count: 0, items: [] }, catchUps: { count: 0, items: [] } },
  });
}

it('shows the same nine at-risk learners as the summary KPI using nested status and stable IDs without requests', async () => {
  setCleanPopupFixture();
  render(<MemoryRouter><CoachDashboard /><ModalLocationProbe /></MemoryRouter>);
  const riskKpi = await screen.findByRole('button', { name: 'Open OTJH at risk details' });
  expect(riskKpi.querySelector('[class*="metricValue"]')).toHaveTextContent('9');
  await screen.findByRole('region', { name: 'Coach learner caseload' });
  const calls = () => [mocks.load.mock.calls.length, mocks.coachFetch.mock.calls.length, mocks.calendar.mock.calls.length, mocks.schedule.mock.calls.length];
  const before = calls();
  fireEvent.click(riskKpi);
  const dialog = within(screen.getByRole('dialog', { name: 'Learners at risk' }));
  expect(dialog.getByLabelText('9 total')).toHaveTextContent('9');
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(9);
  expect(dialog.getAllByRole('button', { name: "Open Shared Learner Name's profile" })).toHaveLength(2);
  for (let index = 0; index < 9; index += 1) expect(dialog.getByText(`Programme A · Group R${index}`)).toBeVisible();
  expect(dialog.queryByText('Other Learner 0')).not.toBeInTheDocument();
  expect(dialog.queryByText('Attendance')).not.toBeInTheDocument();
  expect(dialog.queryByText('--')).not.toBeInTheDocument();
  expect(dialog.getAllByText('OTJH at risk')).toHaveLength(9);
  expect(calls()).toEqual(before);
  fireEvent.click(dialog.getAllByRole('button', { name: "Open Shared Learner Name's profile" })[1]);
  expect(JSON.parse(screen.getByLabelText('Current route').textContent!)).toEqual({
    pathname: '/coach/learner-case-file', search: '?id=risk-1',
    state: { learnerId: 'risk-1', learnerName: 'Shared Learner Name' },
  });
});

it('uses the same cleaned popup list for caseload search, status filters and cached reopening without attendance', async () => {
  setCleanPopupFixture();
  const firstRender = render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Total learners details' }));
  let dialog = within(screen.getByRole('dialog', { name: 'Learner caseload' }));
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(12);
  expect(dialog.queryByText('Attendance')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'At Risk', pressed: false }));
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(9);
  expect(dialog.getByLabelText('12 total')).toHaveTextContent('12');
  fireEvent.click(dialog.getByRole('button', { name: 'Need Attention', pressed: false }));
  expect(dialog.getByRole('button', { name: "Open Other Learner 0's profile" })).toBeVisible();
  fireEvent.click(dialog.getByRole('button', { name: 'On Track', pressed: false }));
  expect(dialog.getByRole('button', { name: "Open Other Learner 1's profile" })).toBeVisible();
  fireEvent.click(dialog.getByRole('button', { name: 'All', pressed: false }));
  fireEvent.change(dialog.getByRole('searchbox'), { target: { value: 'Group R8' } });
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(1);
  const summaryRequests = mocks.load.mock.calls.filter(([url]) => String(url).includes('/dashboard/summary')).length;
  firstRender.unmount();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  // Remounting already refreshes the summary; opening the cached popup must not add a request.
  const refreshedRequests = mocks.load.mock.calls.filter(([url]) => String(url).includes('/dashboard/summary')).length;
  expect(refreshedRequests).toBe(summaryRequests + 1);
  fireEvent.click(await screen.findByRole('button', { name: 'Open OTJH at risk details' }));
  dialog = within(screen.getByRole('dialog', { name: 'Learners at risk' }));
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(9);
  expect(mocks.load.mock.calls.filter(([url]) => String(url).includes('/dashboard/summary'))).toHaveLength(refreshedRequests);
});

function setCaseloadModalFixture() {
  const learners = [
    { id: 'risk', name: 'Risk Learner', programme: 'Marketing Executive Level 4 with a long programme name', group: 'Long group name', learnerType: 'apprenticeship', enrolmentId: '101', rawProgramStatus: 'active', otjhRagStatus: 'at-risk', otjhCompleted: 20, otjhTargetAsOfToday: 40, otjhPlanned: 300 },
    { id: 'attention', name: 'Attention Learner', programme: 'Business Admin', rawProgramStatus: 'active', otjhRagStatus: 'need-attention', otjhCompleted: 30, otjhTargetAsOfToday: 40 },
    { id: 'track', name: 'Track Learner', programme: 'Business Admin', rawProgramStatus: 'active', otjhRagStatus: 'on-track', otjhCompleted: 40, otjhTargetAsOfToday: 40 },
    { id: 'unknown', name: 'Unknown Learner', rawProgramStatus: 'active', otjhRagStatus: 'unavailable', otjhCompleted: null, otjhTargetAsOfToday: null },
    ...Array.from({ length: 38 }, (_, i) => ({ id: `extra-${i}`, name: `Other Learner ${i}`, rawProgramStatus: 'active', otjhRagStatus: 'on-track', otjhCompleted: 40, otjhTargetAsOfToday: 40 })),
  ];
  mocks.load.mockResolvedValue({ owner: { name: 'Example Coach' }, learners });
}

it('keeps the compact caseload count and status mapping while searching and filtering without requests', async () => {
  setCaseloadModalFixture();
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const opener = await screen.findByRole('button', { name: 'Open Total learners details' });
  await screen.findByRole('region', { name: 'Coach learner caseload' });
  const requestCounts = () => [mocks.load.mock.calls.length, mocks.coachFetch.mock.calls.length, mocks.calendar.mock.calls.length, mocks.schedule.mock.calls.length];
  const before = requestCounts();
  opener.focus();
  fireEvent.click(opener);
  const dialog = within(screen.getByRole('dialog', { name: 'Learner caseload' }));
  expect(dialog.getByLabelText('42 total')).toHaveTextContent('42');
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(42);
  expect(dialog.queryByText('KSB')).not.toBeInTheDocument();
  const row = within(dialog.getByRole('button', { name: "Open Risk Learner's profile" }));
  expect(row.getByText('OTJH at risk')).toHaveClass('text-red-700');
  expect(row.getByText('20 / 40h')).toBeVisible();
  expect(row.getByText('50%')).toBeVisible();
  expect(dialog.queryByText('Attendance')).not.toBeInTheDocument();
  expect(within(dialog.getByRole('button', { name: "Open Attention Learner's profile" })).getByText('Need Attention')).toHaveClass('text-amber-700');
  expect(within(dialog.getByRole('button', { name: "Open Track Learner's profile" })).getByText('On Track')).toHaveClass('text-emerald-700');
  expect(within(dialog.getByRole('button', { name: "Open Unknown Learner's profile" })).queryByText('On Track')).not.toBeInTheDocument();
  const search = dialog.getByRole('searchbox', { name: 'Search learners' });
  expect(search).toHaveFocus();
  fireEvent.click(dialog.getByRole('button', { name: 'At Risk', pressed: false }));
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(1);
  expect(dialog.getByLabelText('42 total')).toHaveTextContent('42');
  fireEvent.click(dialog.getByRole('button', { name: 'Need Attention', pressed: false }));
  expect(dialog.getByRole('button', { name: "Open Attention Learner's profile" })).toBeVisible();
  fireEvent.click(dialog.getByRole('button', { name: 'On Track', pressed: false }));
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(39);
  fireEvent.click(dialog.getByRole('button', { name: 'All', pressed: false }));
  fireEvent.change(search, { target: { value: ' LONG GROUP ' } });
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(1);
  fireEvent.change(search, { target: { value: 'business admin' } });
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(2);
  fireEvent.change(search, { target: { value: 'no match' } });
  expect(dialog.getByText('No learners found')).toBeVisible();
  fireEvent.change(search, { target: { value: '' } });
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(42);
  const footerAction = dialog.getByRole('button', { name: 'View in caseload list' });
  footerAction.focus();
  fireEvent.keyDown(footerAction, { key: 'Tab' });
  const headerClose = dialog.getAllByRole('button', { name: 'Close' })[0];
  expect(headerClose).toHaveFocus();
  fireEvent.keyDown(headerClose, { key: 'Tab', shiftKey: true });
  expect(footerAction).toHaveFocus();
  expect(requestCounts()).toEqual(before);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  fireEvent.click(opener);
  expect(within(screen.getByRole('dialog')).getByRole('searchbox')).toHaveValue('');
  fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[1]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole('button', { name: 'Close popup' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps profile chevron navigation and learner identity from the caseload modal', async () => {
  setCaseloadModalFixture();
  render(<MemoryRouter><CoachDashboard /><ModalLocationProbe /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Total learners details' }));
  const row = within(screen.getByRole('dialog')).getByRole('button', { name: "Open Risk Learner's profile" });
  fireEvent.click(row.querySelector('svg.lucide-chevron-right')!);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(JSON.parse(screen.getByLabelText('Current route').textContent!)).toEqual({ pathname: '/coach/learner-case-file', search: '?id=risk', state: { learnerId: 'risk', learnerName: 'Risk Learner', kind: 'apprenticeship', enrolmentId: '101' } });
});

it('keeps View in caseload list scrolling after local modal filtering', async () => {
  setCaseloadModalFixture();
  const previousScroll = HTMLElement.prototype.scrollIntoView;
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 0; });
  render(<MemoryRouter><CoachDashboard /><ModalLocationProbe /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Total learners details' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'At Risk', pressed: false }));
  fireEvent.click(dialog.getByRole('button', { name: 'View in caseload list' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Current route')).toHaveTextContent('"pathname":"/"');
  expect(screen.getByRole('region', { name: 'Coach learner caseload' })).toBeVisible();
  expect(scroll).toHaveBeenCalled();
  frame.mockRestore();
  if (previousScroll) HTMLElement.prototype.scrollIntoView = previousScroll;
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('uses target-to-date for OTJH insights without comparing actuals to the whole plan', async () => {
  useDashboardDate();
  mocks.load.mockResolvedValue({ owner: { name: 'Example Coach' }, learners: [
    { id: '1', name: 'Warning Learner', rawProgramStatus: 'active', otjhCompleted: 169.8766,
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
  fireEvent.click(await screen.findByRole('button', { name: 'Expand OTJH Insights' }));
  const table = within(screen.getByRole('region', { name: 'OTJH risk insights' }));
  const warning = within(table.getByText('Warning Learner').closest('tr')!);
  expect(warning.getByText('169.88h')).toBeVisible();
  expect(warning.getByText('200h')).toBeVisible();
  expect(warning.getByText('30.1h')).toBeVisible();
  expect(warning.getByText('Warning')).toBeVisible();
  const critical = within(table.getByText('Critical Learner').closest('tr')!);
  expect(critical.getByText('160h')).toBeVisible();
  expect(critical.getByText('200h')).toBeVisible();
  expect(critical.getByText('40h')).toBeVisible();
  expect(critical.getByText('Critical')).toBeVisible();
  expect(table.queryByText('Current Learner')).not.toBeInTheDocument();
  expect(table.queryByText('Future Learner')).not.toBeInTheDocument();
  expect(table.queryByText('576h')).not.toBeInTheDocument();
});

it.each([
  ['mcm', 'MCM this week', 'Monthly coaching this week', 8],
  ['pr', 'PR this week', 'Progress reviews this week', 2],
  ['catchUps', 'Catch-ups this week', 'Catch-ups this week', 3],
] as const)('keeps %s popup on the summary meeting set without requests or learner status', async (key, label, title, count) => {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `${key}-${index}`, learnerId: `learner-${index}`, learnerName: `Meeting Learner ${index}`,
    programme: null, group: null, date: '2026-09-21', time: '09:00', durationMinutes: 60, status: 'scheduled',
  }));
  mocks.load.mockResolvedValue({
    owner: { name: 'Synthetic Coach' },
    summary: { totalLearners: 1, otjh: { atRisk: 0, needAttention: 0 }, pendingMarking: 0,
      meetingsThisWeek: { pr: 2, mcm: 8, catchUps: 3 } },
    learnerPopup: { all: [{ id: 'different-id', name: 'Meeting Learner 0', programme: null, group: null,
      otjh: { completed: null, target: null, planned: null, ragStatus: 'unavailable' } }] },
    markingPopup: { count: 0, items: [] },
    meetingsPopup: { pr: { count: 2, items: [] }, mcm: { count: 8, items: [] }, catchUps: { count: 3, items: [] },
      [key]: { count, items } },
  });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const opener = await screen.findByRole('button', { name: `Open ${label} details` });
  await waitFor(() => expect(opener).toHaveTextContent(String(count)));
  const requests = mocks.load.mock.calls.length;
  fireEvent.click(opener);
  const dialog = within(await screen.findByRole('dialog', { name: title }));
  for (const item of items) expect(dialog.getByText(item.learnerName)).toBeVisible();
  expect(dialog.queryByText('Nothing scheduled this week')).not.toBeInTheDocument();
  if (key !== 'catchUps') expect(dialog.getByLabelText(`${key === 'mcm' ? 'Monthly coaching' : 'Progress review'} summary`)).toHaveTextContent(`Scheduled ${count}`);
  expect(mocks.load).toHaveBeenCalledTimes(requests);
});

it('uses one canonical unique risk dataset for card, badge and rows despite stale summary and legacy status', async () => {
  const row = { id: 'a', name: 'Synthetic Risk A', programme: null, group: null,
    otjh: { completed: 0, target: 100, planned: 100, ragStatus: 'at-risk' } };
  mocks.load.mockResolvedValue({ owner: {},
    summary: { totalLearners: 4, otjh: { atRisk: 9, needAttention: 0 }, pendingMarking: 0,
      meetingsThisWeek: { pr: 0, mcm: 0, catchUps: 0 } },
    learnerPopup: { all: [row, { ...row }, { ...row, id: 'b', name: 'Synthetic Paused B', programmeStatus: 'On break' },
      { ...row, id: 'c', name: 'Legacy Misclassified C', status: 'at-risk', otjhRagStatus: 'at-risk',
        otjh: { ...row.otjh, ragStatus: 'on-track' } }], atRisk: ['c'] },
    markingPopup: { count: 0, items: [] },
    meetingsPopup: { pr: { count: 0, items: [] }, mcm: { count: 0, items: [] }, catchUps: { count: 0, items: [] } },
  });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const card = await screen.findByRole('button', { name: 'Open OTJH at risk details' });
  await waitFor(() => expect(card).toHaveTextContent('2'));
  const requests = mocks.load.mock.calls.length;
  fireEvent.click(card);
  const dialog = within(screen.getByRole('dialog', { name: 'Learners at risk' }));
  expect(dialog.getByRole('list', { name: 'Learners' }).children).toHaveLength(2);
  expect(dialog.getByRole('button', { name: "Open Synthetic Risk A's profile" })).toBeVisible();
  expect(dialog.getByRole('button', { name: "Open Synthetic Paused B's profile" })).toBeVisible();
  expect(dialog.queryByText('Legacy Misclassified C')).not.toBeInTheDocument();
  expect(dialog.getByLabelText('2 total')).toHaveTextContent('2');
  expect(mocks.load).toHaveBeenCalledTimes(requests);
});

it('shows 19 compact marking rows, filters locally, preserves item totals and marking navigation', async () => {
  const items = Array.from({ length: 19 }, (_, index) => ({
    id: `submission-${index}`, learnerId: `learner-${index}`, learner: `Marking Learner ${index}`,
    initials: 'ML', programme: index % 2 ? 'Business Admin' : 'Team Leader', group: `Group ${index}`,
    submittedAt: '2026-09-01', totalEvidence: 0, isOverdue: index === 0,
  }));
  items.push({ ...items[0], id: 'second-submission', submittedAt: '2026-09-02' });
  mocks.load.mockResolvedValue({ learners: [], marking: { summary: { pendingItems: 20 }, items }, meetings: { events: [] } });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const opener = await screen.findByRole('button', { name: 'Open Pending marking details' });
  await waitFor(() => expect(opener).toHaveTextContent('20'));
  const requests = mocks.load.mock.calls.length;
  opener.focus();
  fireEvent.click(opener);
  const modal = screen.getByRole('dialog', { name: 'Pending marking' });
  const dialog = within(modal);
  expect(dialog.getByLabelText('20 total')).toHaveTextContent('20');
  expect(dialog.getByRole('list', { name: 'Learners awaiting marking' }).children).toHaveLength(19);
  expect(dialog.getByText('2 Pending')).toBeVisible();
  expect(dialog.getAllByText('1 Pending')).toHaveLength(18);
  expect(dialog.getAllByText('Oldest pending')).toHaveLength(19);
  expect(dialog.getByText('Overdue')).toBeVisible();
  expect(dialog.queryByText('Pending / Total')).not.toBeInTheDocument();
  expect(dialog.queryByText('1 / 0')).not.toBeInTheDocument();
  expect(modal.querySelector('[class*="bg-gradient"]')).toBeNull();
  const search = dialog.getByRole('searchbox', { name: 'Search learner' });
  expect(search).toHaveFocus();
  fireEvent.change(search, { target: { value: 'Marking Learner 18' } });
  expect(dialog.getByRole('list', { name: 'Learners awaiting marking' }).children).toHaveLength(1);
  expect(dialog.getByLabelText('20 total')).toHaveTextContent('20');
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.change(dialog.getByRole('combobox', { name: 'Filter by programme' }), { target: { value: 'Business Admin' } });
  expect(dialog.getByRole('list', { name: 'Learners awaiting marking' }).children).toHaveLength(9);
  fireEvent.change(search, { target: { value: 'no matching learner' } });
  expect(dialog.getByText('No learners found')).toBeVisible();
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.change(dialog.getByRole('combobox'), { target: { value: '' } });
  const queue = dialog.getByRole('link', { name: 'Open marking queue' });
  expect(queue).toHaveAttribute('href', '/coach/marking-queue');
  queue.focus();
  fireEvent.keyDown(queue, { key: 'Tab' });
  expect(dialog.getAllByRole('button', { name: 'Close' })[0]).toHaveFocus();
  expect(mocks.load).toHaveBeenCalledTimes(requests);
  const row = dialog.getByRole('link', { name: 'Open marking for Marking Learner 0' });
  expect(row).toHaveAttribute('href', '/coach/marking-queue?learnerId=learner-0');
  fireEvent.click(row);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledTimes(requests);
});

it('keeps the empty marking state and footer action', async () => {
  mocks.load.mockResolvedValue({ learners: [], marking: { summary: { pendingItems: 0 }, items: [] }, meetings: { events: [] } });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Pending marking details' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Pending marking' }));
  expect(dialog.getByText('No evidence awaiting review')).toBeVisible();
  expect(dialog.queryByRole('combobox')).not.toBeInTheDocument();
  expect(dialog.getByRole('link', { name: 'Open marking queue' })).toHaveAttribute('href', '/coach/marking-queue');
  fireEvent.click(dialog.getByRole('link', { name: 'Open marking queue' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});


it('searches, filters, sorts and clears the cached full learner list with no requests', async () => {
  vi.useRealTimers();
  mocks.load.mockResolvedValue({ results: [
    { id: '1', name: 'Alpha Learner', email: 'alpha@example.invalid', cohortId: 'a', cohortName: 'Cohort A', group: 'Group A', rawProgramStatus: 'active', otjhRagStatus: 'on-track' },
    { id: '2', name: 'Beta Learner', email: 'beta@example.invalid', cohortId: 'b', cohortName: 'Cohort B', group: 'Group B', rawProgramStatus: 'break', otjhRagStatus: 'at-risk' },
  ] });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await screen.findByText('Alpha Learner');
  const table = () => screen.getByRole('region', { name: 'Coach learner caseload' });
  const choose = (button: string, option: string) => {
    fireEvent.click(within(table()).getByRole('button', { name: button }));
    fireEvent.click(screen.getByRole('option', { name: option }));
  };
  const clear = () => fireEvent.click(within(table()).getByRole('button', { name: 'Clear all' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search learners by name or email' }), { target: { value: 'beta@example.invalid' } });
  expect(await screen.findByText('Beta Learner')).toBeVisible();
  expect(within(table()).queryByText('Alpha Learner')).not.toBeInTheDocument();
  clear();
  choose('All cohorts / groups', 'Cohort: Cohort A');
  expect(within(table()).getByText('Alpha Learner')).toBeVisible();
  expect(within(table()).queryByText('Beta Learner')).not.toBeInTheDocument();
  clear();
  choose('All cohorts / groups', 'Group: Group B');
  expect(within(table()).getByText('Beta Learner')).toBeVisible();
  expect(within(table()).queryByText('Alpha Learner')).not.toBeInTheDocument();
  clear();
  choose('All OTJH statuses', 'On track');
  expect(within(table()).getByText('Alpha Learner')).toBeVisible();
  expect(within(table()).queryByText('Beta Learner')).not.toBeInTheDocument();
  clear();
  choose('All programme statuses', 'break');
  expect(within(table()).getByText('Beta Learner')).toBeVisible();
  expect(within(table()).queryByText('Alpha Learner')).not.toBeInTheDocument();
  clear();
  fireEvent.click(within(table()).getByRole('button', { name: 'Sort by Learner' }));
  const rows = table().querySelectorAll('tbody tr');
  expect(within(rows[0] as HTMLElement).getByText('Alpha Learner')).toBeVisible();
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/learners'))).toHaveLength(1);
});

it('fetches once per coach and reuses the previous coach cache on return', async () => {
  vi.useRealTimers();
  const { rerender } = render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await screen.findByText('Example Learner');
  Object.assign(mocks.coach, { email: 'other@example.invalid', name: 'Other Coach' });
  mocks.load.mockResolvedValue({ results: [{ id: 'other', name: 'Other Coach Learner', rawProgramStatus: 'active' }] });
  rerender(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await screen.findByText('Other Coach Learner');
  Object.assign(mocks.coach, { email: 'coach@example.invalid', name: 'Example Coach' });
  rerender(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  await screen.findByText('Example Learner');
  expect(screen.queryByText('Other Coach Learner')).not.toBeInTheDocument();
  expect(mocks.load.mock.calls.filter(([url]) => url.includes('/learners'))).toHaveLength(2);
});


it('preserves weighted learner aggregates and counts pending items without new requests', async () => {
  mocks.load.mockResolvedValue({
    owner: {},
    summary: { totalLearners: 2, otjh: { atRisk: 0, needAttention: 0 }, pendingMarking: 7,
      meetingsThisWeek: { pr: 0, mcm: 0, catchUps: 0 } },
    learnerPopup: { all: [], atRisk: [] },
    markingPopup: { count: 7, items: [
      { learnerId: 'synthetic-a', learnerName: 'Same Name', programme: 'Programme', group: 'A', pendingCount: 5, oldestPendingDate: '2026-09-01' },
      { learnerId: 'synthetic-b', learnerName: 'Same Name', programme: 'Programme', group: 'B', pendingCount: 2, oldestPendingDate: '2026-09-02' },
    ] },
    meetingsPopup: { pr: { count: 0, items: [] }, mcm: { count: 0, items: [] }, catchUps: { count: 0, items: [] } },
  });
  render(<MemoryRouter><CoachDashboard /></MemoryRouter>);
  const card = await screen.findByRole('button', { name: 'Open Pending marking details' });
  await waitFor(() => expect(card).toHaveTextContent('7'));
  const requests = mocks.load.mock.calls.length;
  fireEvent.click(card);
  const dialog = within(screen.getByRole('dialog', { name: 'Pending marking' }));
  expect(dialog.getByLabelText('7 total')).toHaveTextContent('7');
  expect(dialog.getByRole('list', { name: 'Learners awaiting marking' }).children).toHaveLength(2);
  expect(dialog.getByText('5 Pending')).toBeVisible();
  expect(dialog.getByText('2 Pending')).toBeVisible();
  expect(mocks.load).toHaveBeenCalledTimes(requests);
});
