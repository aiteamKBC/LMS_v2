import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployerPortal, EmployerDashboardMetrics } from '@/api/employerPortal';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import EmployerPortalPage from './EmployerPortalPage';
import { londonToday } from './employerDashboardData';

const api = vi.hoisted(() => ({
  portal: vi.fn(), metrics: vi.fn(), reviews: vi.fn(), reviewSummary: vi.fn(), attendance: vi.fn(),
  documents: vi.fn(), learning: vi.fn(), schedule: vi.fn(), meetings: vi.fn(), mcm: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: 'employer' }));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerPortal: (...args: unknown[]) => api.portal(...args),
  fetchEmployerDashboardMetrics: (...args: unknown[]) => api.metrics(...args),
  fetchEmployerProgressReviews: (...args: unknown[]) => api.reviews(...args),
  fetchEmployerProgressReviewSummary: (...args: unknown[]) => api.reviewSummary(...args),
  fetchEmployerLearnerAttendance: (...args: unknown[]) => api.attendance(...args),
  fetchEmployerDocuments: (...args: unknown[]) => api.documents(...args),
  fetchEmployerLearningOverview: (...args: unknown[]) => api.learning(...args),
  fetchEmployerScheduleOverview: (...args: unknown[]) => api.schedule(...args),
  fetchEmployerMcmTimeline: (...args: unknown[]) => api.mcm(...args),
}));
vi.mock('@/api/employerMeetings', () => ({
  fetchEmployerTeamsMeetings: (...args: unknown[]) => api.meetings(...args),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ auth: { account: { role: session.role, displayName: 'Test Employer' } } }),
}));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}{location.search}</output>;
}
function showPage(path = '/employers/8', state?: unknown) {
  const entry = new URL(path, 'http://localhost');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: entry.pathname, search: entry.search, state }]}><Routes>
    <Route path="/employers/:employerId/*" element={<><EmployerPortalPage /><CurrentPath /></>} />
    <Route path="*" element={<CurrentPath />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
let portal: EmployerPortal;
let metrics: EmployerDashboardMetrics;
const makeReview = (id: string, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: 'Progress review', source: 'progress-review', importedReviewType: 'Progress Review',
  type: 'review', sequence: 1, status: 'scheduled', date: londonToday(), targetDate: londonToday(),
  scheduledDate: londonToday(), scheduledTime: '09:00', durationMinutes: 60, coachName: 'Coach',
  coachEmail: '', meetingProvider: '', meetingLink: '', notes: '', ...overrides,
});
const table = () => within(screen.getByRole('region', { name: 'Employer learners' }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  session.role = 'employer';
  // jsdom has no native dialog; the summary-card dialog needs these two.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  portal = {
    employer: { id: '8', name: 'Test employer', email: 'employer@example.test', employerGroupNames: ['Test org'] },
    outstandingTotal: 2,
    learners: [
      { id: '11', kind: 'apprenticeship', name: 'Alex Learner', email: 'alex@example.test', programme: 'Data Analysis', cohort: 'Cohort A', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 2, otjhProgress: { actual: 90, planned: 200, percent: 45 } },
      { id: '12', kind: 'commercial', name: 'Morgan Learner', email: 'morgan@example.test', programme: 'Marketing', cohort: 'Cohort B', programmeStatus: 'Onboarding', onboardingStatus: 'Onboarding', isActive: false, outstandingCount: 2, documentsTotal: 2, otjhProgress: { actual: 70, planned: 400, percent: 17.5 } },
    ],
  };
  metrics = { asOf: londonToday(), learners: {
    '11': { programme: { completed: 68, total: 100, percent: 68, status: 'ready' }, risk: 'on-track',
      otjh: { actual: 90, planned: 200, percent: 45 }, attendance: { present: 8, sessions: 10, late: 1, absent: 2, attendanceRate: 80 } },
    '12': { programme: { completed: 32, total: 100, percent: 32, status: 'ready' }, risk: 'unavailable',
      otjh: { actual: 70, planned: 400, percent: 17.5 }, attendance: { present: 2, sessions: 3, late: 1, absent: 1, attendanceRate: 67 } },
  } };
  api.portal.mockImplementation(async () => structuredClone(portal));
  api.documents.mockImplementation(async () => ({ employer: portal.employer, items: [] }));
  api.learning.mockResolvedValue({ programme: [], modules: [], metrics: { ksb: { completed: null, total: null } }, reviews: { completed: null, total: null } });
  api.schedule.mockResolvedValue({ modules: [], holidayCalendar: { available: false, holidays: [] } });
  api.meetings.mockResolvedValue({ status: 'ready', meetings: [] });
  api.mcm.mockResolvedValue({ events: [] });
  api.metrics.mockImplementation(async () => structuredClone(metrics));
  api.attendance.mockImplementation(async (_employer, _kind, id) => ({ attendance: structuredClone(metrics.learners[id]?.attendance ?? null) }));
  api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
    makeReview('pr-' + id, id === '12' ? { scheduledDate: '2099-12-21', targetDate: '2099-12-21' } : {}),
    makeReview('gateway-' + id, { importedReviewType: 'Gateway Review', title: 'Gateway Review' }),
    makeReview('support-' + id, { importedReviewType: 'Personal Support Plan', title: 'Personal Support Plan' }),
  ], definitions: {} }));
  api.reviewSummary.mockImplementation(async (...args: unknown[]) => {
    const implementation = api.reviews.getMockImplementation();
    return implementation ? implementation(...args) : { events: [] };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('employer home dashboard', () => {
  it('keeps the Reviews performance card pending until authoritative review details arrive', async () => {
    const finish: ((value: { events: LearnerCalendarEvent[]; definitions: object }) => void)[] = [];
    api.reviews.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    api.reviewSummary.mockResolvedValue({ events: [makeReview('due-this-month')] });
    showPage();
    const card = await screen.findByRole('button', { name: 'Reviews: Loading' });
    expect(card).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(finish).toHaveLength(2));
    await act(async () => { finish.forEach(resolve => resolve({ events: [makeReview('owned-review')], definitions: {} })); });
    expect(await screen.findByRole('button', { name: 'Reviews: 2' })).not.toHaveAttribute('aria-busy');
  });

  it.each([
    { source: '/users?type=employer&page=2', label: 'Back to users' },
    { source: '/workspace/admin/employers?search=kent', label: 'Back to employers' },
  ])('returns staff to its source page and preserves its filters ($source)', async ({ source, label }) => {
    session.role = 'admin';
    showPage('/employers/8', { employerReturnTo: source });
    await screen.findByRole('link', { name: label });

    fireEvent.click(screen.getByRole('link', { name: label }));

    expect(screen.getByTestId('path')).toHaveTextContent(source);
  });

  it('uses the users directory as a safe fallback for a direct Employer link', async () => {
    session.role = 'admin';
    showPage('/employers/8', { employerReturnTo: 'https://example.com' });

    fireEvent.click(await screen.findByRole('link', { name: 'Back to users' }));

    expect(screen.getByTestId('path')).toHaveTextContent('/users');
  });

  it.each(['/employers/8/reviews', '/employers/8/reviews/'])('uses APTEM marker-only current steps independently per learner on %s', async path => {
    const dates = ['2026-10-26', '2027-03-30', '2027-06-29', '2027-09-29'];
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: dates.map((date, index) =>
      makeReview(`shared-review-${index + 1}`, { title: `Review ${index + 1}`, reviewSource: 'aptem',
        sequence: index + 1, status: index < (id === '12' ? 2 : 1) ? 'completed' : 'not-scheduled',
        targetDate: date, date, scheduledDate: null })), definitions: {} }));
    showPage(path);
    const journey = within(await screen.findByRole('region', { name: 'Progress review journey' }));
    const alex = await journey.findByRole('link', { name: /^Alex Learner: Review 2,/ });
    const morgan = await journey.findByRole('link', { name: /^Morgan Learner: Review 3,/ });
    expect(alex).toHaveAttribute('aria-current', 'step');
    expect(morgan).toHaveAttribute('aria-current', 'step');
    for (const link of journey.getAllByRole('link', { name: /Learner: Review/ })) {
      expect(link).toHaveAttribute('data-selection', 'marker');
    }
    expect(journey.getByRole('link', { name: /^Alex Learner: Review 4,/ })).not.toHaveAttribute('aria-current');
    expect(journey.getByRole('link', { name: /^Morgan Learner: Review 2,/ })).not.toHaveAttribute('aria-current');
    expect(journey.getByRole('link', { name: /^Alex Learner: Review 1,/ }).closest('li')).toHaveAttribute('data-status', 'completed');
    alex.focus();
    await userEvent.tab();
    const third = journey.getByRole('link', { name: /^Alex Learner: Review 3,/ });
    expect(third).toHaveFocus();
    // These surfaces navigate to the existing learner review page; they do not
    // turn a clicked later record into the dashboard's next-action calculation.
    expect(third).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews&reviewId=shared-review-3');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('path')).toHaveTextContent('/employers/8/learner/apprenticeship/11?tab=reviews&reviewId=shared-review-3');
  });

  it.each(['/employers/8/reviews', '/employers/8/reviews/'])('keeps Native current-step styling and completed APTEM history unselected on %s', async path => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [makeReview('same-key', {
      reviewSource: id === '11' ? 'curriculum' : 'aptem', status: id === '11' ? 'scheduled' : 'completed',
    })], definitions: {} }));
    showPage(path);
    const journey = within(await screen.findByRole('region', { name: 'Progress review journey' }));
    const native = await journey.findByRole('link', { name: /^Alex Learner: Review 1,/ });
    const history = await journey.findByRole('link', { name: /^Morgan Learner: Review 1,/ });
    expect(native).toHaveAttribute('aria-current', 'step');
    expect(native).not.toHaveAttribute('data-selection', 'marker');
    expect(history).toHaveAttribute('data-selection', 'marker');
    expect(history).not.toHaveAttribute('aria-current');
  });

  it('keeps a loading state while learners are being prepared', () => {
    api.portal.mockReturnValueOnce(new Promise(() => undefined));
    showPage();
    expect(screen.getByRole('status', { name: 'Loading learners' })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Loading learners' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading learners' }).querySelector('.animate-spin')).toBeNull();
    expect(api.metrics).not.toHaveBeenCalled();
  });

  it('renders saved learner progress in My learners and links both learner kinds correctly', async () => {
    const { container } = showPage('/employers/8/learners');
    expect(await screen.findByRole('heading', { name: 'My learners' })).toBeInTheDocument();
    expect(container.querySelector('[data-employer-theme]')).toBeInTheDocument();
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByRole('progressbar', { name: 'Morgan Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '17.5');
    expect(table().getByRole('columnheader', { name: 'OTJ Progress' })).toBeVisible();
    expect(table().getByRole('columnheader', { name: 'Attendance' })).toBeVisible();
    expect(table().queryByRole('columnheader', { name: 'Engagement' })).not.toBeInTheDocument();
    expect(table().getByText('90 / 200 OTJ hours')).toBeVisible();
    expect(table().getByText('70 / 400 OTJ hours')).toBeVisible();
    expect(table().queryByText(/activities/)).not.toBeInTheDocument();
    expect(table().getByRole('progressbar', { name: 'Alex Learner attendance' })).toHaveAttribute('aria-valuenow', '80');
    expect(table().getByRole('progressbar', { name: 'Morgan Learner attendance' })).toHaveAttribute('aria-valuenow', '67');
    expect(table().getByText('8 / 10 sessions')).toBeVisible();
    expect(table().getByText('2 / 3 sessions')).toBeVisible();
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12');
    expect(api.metrics.mock.calls.some(call => call[2] === 'summary')).toBe(false);
    expect(api.metrics.mock.calls.every(call => call[2] === 'status')).toBe(true);
    expect(api.reviews).toHaveBeenCalledWith('8', 'commercial', '12', expect.any(AbortSignal));
  });

  it('renders the Learner OTJ percentage from the initial list response without a summary request', async () => {
    portal.learners[0].otjhProgress = { actual: 5, planned: 568.73, percent: 0.88 };
    api.metrics.mockImplementation(() => new Promise(() => undefined));

    showPage('/employers/8/learners');

    expect(await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' }))
      .toHaveAttribute('aria-valuenow', '0.88');
    expect(table().getByText('0.88%')).toBeVisible();
    expect(table().getByText('5 / 568.73 OTJ hours')).toBeVisible();
    expect(api.portal).toHaveBeenCalledTimes(1);
    expect(api.metrics.mock.calls.some(call => call[2] === 'summary')).toBe(false);
  });

  it('combines search, programme, cohort and status filters and clears them', async () => {
    showPage('/employers/8/learners?status=inactive');
    await screen.findByRole('heading', { name: 'Your learners (1)' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Programme' }), 'Marketing');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort B');
    expect(screen.getByTestId('path')).toHaveTextContent('status=inactive');
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search learners' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Programme' })).toHaveValue('');
  });

  it('keeps precise OTJ hours separate from activity completion and saved risk statuses', async () => {
    metrics.learners['11'].programme = { completed: 1, total: 900, percent: 0.11, status: 'ready' };
    portal.learners[0].otjhProgress = { actual: 0.55, planned: 500, percent: 0.11 };
    showPage('/employers/8/learners');
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '0.11');
    expect(table().getByText('0.11%')).toBeVisible();
    expect(table().getByText('0.55 / 500 OTJ hours')).toBeVisible();
    const overview = within(screen.getByRole('region', { name: 'Learner progress overview' }));
    await waitFor(() => expect(overview.getByRole('img')).toHaveAccessibleName('On track: 1, Needs attention: 0, At risk: 0, Not available: 1'));
    expect(api.metrics.mock.calls.every(call => call[2] === 'status')).toBe(true);
    expect(table().getByText('17.5%')).toBeVisible();
  });

  it.each([
    { actual: 5, planned: 370, percent: 1.35, text: '1.35%', bar: '1.35' },
    { actual: 0, planned: 100, percent: 0, text: '0%', bar: '0' },
    { actual: 125, planned: 100, percent: 125, text: '125%', bar: '100' },
    { actual: 12.5, planned: null, percent: null, text: 'Not available', bar: null },
    { actual: 0, planned: 0, percent: null, text: 'Not available', bar: null },
  ])('matches learner My Progress display for OTJ ($actual / $planned)', async ({ actual, planned, percent, text, bar }) => {
    portal.learners[0].otjhProgress = { actual, planned, percent };
    showPage('/employers/8/learners');
    await screen.findByRole('progressbar', { name: 'Alex Learner attendance' });
    const row = within(table().getByRole('link', { name: 'View Alex Learner' }).closest('tr')!);
    expect(row.getByText(text, { exact: true })).toBeVisible();
    expect(row.getByText(`${actual} / ${planned ?? '—'} OTJ hours`)).toBeVisible();
    if (bar === null) expect(row.queryByRole('progressbar', { name: 'Alex Learner OTJ progress' })).not.toBeInTheDocument();
    else expect(row.getByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', bar);
  });

  it('distinguishes no attendance records from a recorded zero attendance rate', async () => {
    metrics.learners['11'].attendance = null;
    metrics.learners['12'].attendance = { present: 0, sessions: 3, absent: 3, late: 0, attendanceRate: 0 };
    showPage('/employers/8/learners');
    await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    await waitFor(() => expect(table().getByText('No attendance records yet')).toBeVisible());
    expect(table().queryByRole('progressbar', { name: 'Alex Learner attendance' })).not.toBeInTheDocument();
    expect(table().getByRole('progressbar', { name: 'Morgan Learner attendance' })).toHaveAttribute('aria-valuenow', '0');
    expect(table().getByText('0 / 3 sessions')).toBeVisible();
  });

  it('shows OTJ progress from the initial learner-list response while attendance loads', async () => {
    api.attendance.mockImplementation(() => new Promise(() => undefined));
    showPage('/employers/8/learners');
    await screen.findByRole('heading', { name: 'Your learners (2)' });
    const cells = within(table().getByRole('link', { name: 'View Alex Learner' }).closest('tr')!).getAllByRole('cell');
    expect(cells[7]).toHaveTextContent('45%');
    expect(within(cells[8]).getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    expect(cells[8].textContent).toBe('');
    expect(table().getByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    expect(api.metrics.mock.calls.some(call => call[2] === 'summary')).toBe(false);
  });

  it('loads saved risk status independently on Overview and keeps learner OTJ and attendance separate', async () => {
    showPage();
    expect(await screen.findByRole('button', { name: /^ON TRACK: 1\./ })).toBeVisible();
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'status');
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'programme');
    cleanup();
    vi.clearAllMocks();
    showPage('/employers/8/learners');
    expect(await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Morgan Learner attendance' })).toHaveAttribute('aria-valuenow', '67'));
    expect(api.metrics).toHaveBeenCalledTimes(1);
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'status');
    expect(api.attendance).toHaveBeenCalledTimes(2);
  });

  it('shows saved learner OTJ progress while independent module details are pending', async () => {
    api.learning.mockImplementation(() => new Promise(() => undefined));
    showPage('/employers/8/learners');
    expect(await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    expect(table().getByRole('status', { name: 'Loading Alex Learner modules' })).toBeVisible();
    expect(table().getByRole('status', { name: 'Loading Morgan Learner modules' })).toBeVisible();
    expect(api.metrics.mock.calls.some(call => call[2] === 'programme')).toBe(false);
  });

  it('shows saved Needs attention without waiting for independent module performance', async () => {
    metrics.learners['11'].risk = 'at-risk';
    api.learning.mockImplementation(() => new Promise(() => undefined));
    api.metrics.mockImplementation((_employer, _signal, section) => section === 'status'
      ? Promise.resolve(structuredClone(metrics)) : new Promise(() => undefined));
    showPage();
    expect(await screen.findByRole('button', { name: /Needs attention: 1\. Saved learner OTJ status/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Average KSBs: Loading' })).toHaveAttribute('aria-busy', 'true');
  });

  it('isolates attendance failures and retries without hiding saved progress or the other learner', async () => {
    api.attendance.mockRejectedValueOnce(new Error('synthetic failure'));
    showPage('/employers/8/learners');
    expect(await screen.findByRole('alert')).toHaveTextContent('Some attendance records could not be loaded.');
    expect(screen.getByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Morgan Learner attendance' })).toBeVisible();
    expect(api.metrics.mock.calls.some(call => call[2] === 'summary')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('progressbar', { name: 'Alex Learner attendance' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('aborts previous attendance reads on retry and ignores their late results', async () => {
    let finishOld!: (value: { attendance: null }) => void;
    api.attendance.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    api.attendance.mockRejectedValueOnce(new Error('retry needed'));
    showPage('/employers/8/learners');
    await screen.findByRole('alert');
    const previousSignal = api.attendance.mock.calls[0][3] as AbortSignal;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('progressbar', { name: 'Alex Learner attendance' })).toHaveAttribute('aria-valuenow', '80');
    expect(previousSignal.aborted).toBe(true);
    await act(async () => finishOld({ attendance: null }));
    expect(screen.getByRole('progressbar', { name: 'Alex Learner attendance' })).toHaveAttribute('aria-valuenow', '80');
    expect(screen.queryByText('No attendance records yet')).not.toBeInTheDocument();
  });

  it('shows booked meetings to attend with learner, UK time and safe join links', async () => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
      makeReview(`booked-${id}`, { scheduledDate: '2099-12-21', scheduledTime: '14:30', meetingLink: 'https://teams.microsoft.com/l/meetup-join/example', invited: true }),
      makeReview(`planned-${id}`, { title: 'Unbooked review', scheduledDate: null, status: 'not-scheduled' }),
      makeReview(`past-${id}`, { title: 'Past meeting', scheduledDate: '2020-01-01' }),
      makeReview(`cancelled-${id}`, { title: 'Cancelled meeting', status: 'cancelled' }),
      makeReview(`signed-${id}`, { title: 'Signature only', status: 'awaiting-signature', employerSignatureRequired: true }),
      makeReview(`history-${id}`, { title: 'Completed meeting', status: 'completed' }),
    ], definitions: {} }));
    showPage();
    const panel = within(await screen.findByRole('region', { name: 'Meetings to attend (2)' }));
    expect(panel.getByRole('link', { name: 'Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews');
    expect(panel.getByRole('link', { name: 'Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=reviews');
    expect(panel.getAllByText(/21 Dec 2099 · 14:30/)).toHaveLength(2);
    expect(panel.getAllByText('With Coach')).toHaveLength(2);
    expect(panel.getByRole('link', { name: 'Join Alex Learner: Progress review' })).toHaveAttribute('href', 'https://teams.microsoft.com/l/meetup-join/example');
    expect(panel.queryByText(/Unbooked|Past meeting|Cancelled meeting|Signature only|Completed meeting/)).not.toBeInTheDocument();
  });

  it('keeps unconfirmed invitations and invalid links out of meeting join actions', async () => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [makeReview(id, {
      scheduledDate: '2099-12-21', meetingLink: id === '11' ? 'https://teams.microsoft.com/example' : 'javascript:alert(1)',
      invited: id !== '11', syncState: id === '11' ? 'failed' : 'synced',
    })], definitions: {} }));
    showPage('/employers/8/reviews');
    const panel = within(await screen.findByRole('region', { name: 'Meetings to attend (2)' }));
    expect(panel.queryByRole('link', { name: /^Join / })).not.toBeInTheDocument();
    expect(panel.getByText('Invitation not confirmed. Contact your coach.')).toBeVisible();
    expect(panel.getByText('Meeting link not available yet.')).toBeVisible();
  });

  it('counts owned Progress and Gateway reviews across the plan while excluding support plans', async () => {
    showPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Reviews: 4' }));
    const panel = within(await screen.findByRole('dialog', { name: 'Reviews' }));
    const listed = panel.getAllByRole('listitem');
    expect(listed).toHaveLength(2);
    expect(listed[0]).toHaveTextContent('Alex Learner');
    expect(listed[1]).toHaveTextContent('Morgan Learner');
    expect(panel.getAllByText('2 reviews')).toHaveLength(2);
    expect(panel.getAllByRole('link', { name: 'View learner' }).map(link => link.getAttribute('href'))).toEqual([
      '/employers/8/learner/apprenticeship/11?tab=reviews',
      '/employers/8/learner/commercial/12?tab=reviews',
    ]);
    expect(panel.queryByRole('link', { name: /^Join / })).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/employers\/8$/);
  });

  it('gives My learners and Progress reviews their own content instead of repeating home', async () => {
    showPage('/employers/8/learners');
    expect(await screen.findByRole('heading', { level: 1, name: 'My learners' })).toBeVisible();
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    // The overview's panels stay on home; this page is the learner list.
    expect(screen.queryByRole('region', { name: 'Learner summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Progress review journey' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument();

    cleanup();
    showPage('/employers/8/reviews');
    expect(await screen.findByRole('heading', { level: 1, name: 'Progress reviews' })).toBeVisible();
    const journey = screen.getByRole('region', { name: 'Progress review journey' });
    expect(within(journey).getByRole('link', { name: 'Alex Learner' })).toBeVisible();
    expect(within(journey).getByRole('link', { name: 'Morgan Learner' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Employer learners' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Learner summary' })).not.toBeInTheDocument();
  });

  it('keeps a section filter in the address so a reload still shows it', async () => {
    showPage('/employers/8/learners?status=inactive');
    expect(await screen.findByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    expect(screen.getByTestId('path')).toHaveTextContent('status=inactive');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByTestId('path')).toHaveTextContent('/employers/8/learners');
    expect(screen.getByTestId('path')).not.toHaveTextContent('status=inactive');
  });

  it('shows every review in a separate learner timeline with signature context and the correct links', async () => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
      makeReview(`${id}-done`, { title: 'Completed review', status: 'completed', scheduledDate: '2026-10-01' }),
      makeReview(`${id}-sign`, { title: 'Review to sign', status: 'awaiting-signature', employerSignatureRequired: true, employerSigned: false }),
      ...Array.from({ length: 5 }, (_, index) => makeReview(`${id}-next-${index}`, { title: `Planned review ${index + 1}`, status: 'not-scheduled' })),
    ], definitions: {} }));
    showPage('/employers/8/reviews');
    const alex = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(await alex.findByText('1 awaiting your signature')).toBeVisible();
    expect(alex.getAllByRole('listitem')).toHaveLength(7);
    expect(alex.getByText('1 of 7 completed')).toBeVisible();
    expect(alex.getByText('1 Oct 2026')).toBeVisible();
    expect(alex.getByRole('link', { name: /Alex Learner: Review 2, Your signature needed,/ })).toBeVisible();
    expect(alex.getByText('Review 7')).toBeVisible();
    expect(alex.getByRole('link', { name: 'View reviews for Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews');
    expect(screen.getByRole('link', { name: 'View reviews for Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=reviews');
    expect(screen.getByText('2 of 2 learners')).toBeVisible();
  });

  it('marks only the review that is due next, matching the Next review column', async () => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
      makeReview(`${id}-done`, { title: 'Done review', status: 'completed', targetDate: '2026-09-01', scheduledDate: '2026-09-01', date: '2026-09-01' }),
      makeReview(`${id}-later`, { title: 'Later review', status: 'scheduled', targetDate: '2026-11-01', scheduledDate: '2026-12-01', date: '2026-12-01' }),
      makeReview(`${id}-due`, { title: 'Due review', status: 'scheduled', targetDate: '2026-12-01', scheduledDate: '2026-11-01', date: '2026-11-01' }),
    ], definitions: {} }));
    showPage('/employers/8/reviews');
    await screen.findByRole('link', { name: /Alex Learner: Review 1,/ });
    const alex = within(screen.getByRole('article', { name: 'Alex Learner reviews' }));
    const current = alex.getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    // The appointment due first, even though the plan puts it last in the timeline.
    expect(current[0]).toHaveAccessibleName('Alex Learner: Review 3, Scheduled, 1 Nov 2026');

    cleanup();
    showPage('/employers/8/learners');
    await screen.findByRole('link', { name: 'View Alex Learner' });
    expect(await table().findAllByRole('link', { name: '1 Nov 2026' })).toHaveLength(2);
  });

  it.each(['/employers/8/reviews', '/employers/8/reviews/'])('orders the journey by the source plan after appointments move on %s', async path => {
    const planned = ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'];
    const booked = ['2026-12-10', '2026-09-10', '2026-10-20', '2026-11-20', '2026-08-01'];
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [1, 4, 3, 0, 2].map(index =>
      makeReview(`${id}-${index}`, { title: `Review ${index + 1}`, reviewSource: 'aptem',
        targetDate: planned[index], scheduledDate: booked[index], date: booked[index], sequence: index + 1,
        status: index === 0 ? 'awaiting-signature' : index === 1 ? 'completed' : 'scheduled' })), definitions: {} }));
    showPage(path);
    await screen.findByRole('link', { name: /Alex Learner: Review 1,/ });
    const journey = within(screen.getByRole('region', { name: 'Progress review journey' }));
    for (const name of ['Alex Learner', 'Morgan Learner']) {
      const links = journey.getAllByRole('link', { name: new RegExp(`^${name}: Review`) });
      expect(links.map(link => link.getAttribute('aria-label')?.split(',')[0].replace(`${name}: `, ''))).toEqual(
        ['Review 1', 'Review 2', 'Review 3', 'Review 4', 'Review 5']);
      expect(links[0]).toHaveAccessibleName(`${name}: Review 1, Waiting for signatures, 10 Dec 2026`);
      expect(links[1]).toHaveAccessibleName(`${name}: Review 2, Completed, 10 Sept 2026`);
    }
    expect(screen.queryByRole('region', { name: 'Employer learners' })).not.toBeInTheDocument();
  });

  it('filters the review journeys and can recover from an empty search', async () => {
    showPage('/employers/8/reviews');
    await screen.findByRole('article', { name: 'Alex Learner reviews' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    expect(screen.getByRole('article', { name: 'Morgan Learner reviews' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Alex Learner reviews' })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 learners')).toBeVisible();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), ' missing');
    expect(screen.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    const journey = within(screen.getByRole('region', { name: 'Progress review journey' }));
    await userEvent.click(journey.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('2 of 2 learners')).toBeVisible();
  });

  it('keeps review loading and failure distinct from an empty timeline and retries failed reads', async () => {
    api.reviews.mockRejectedValueOnce(new Error('temporary'));
    showPage('/employers/8/reviews');
    const alex = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(await alex.findByRole('alert')).toHaveTextContent('Reviews could not be loaded for this learner.');
    expect(alex.queryByText('No progress reviews planned yet.')).not.toBeInTheDocument();
    await userEvent.click(alex.getByRole('button', { name: 'Retry reviews' }));
    expect(await alex.findByRole('list')).toBeVisible();
    expect(alex.queryByRole('alert')).not.toBeInTheDocument();

    cleanup();
    api.reviews.mockImplementation(() => new Promise(() => undefined));
    showPage('/employers/8/reviews');
    const loading = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(loading.getByRole('status')).toHaveAccessibleName(expect.stringContaining('Loading progress reviews'));
    expect(loading.queryByText('No progress reviews planned yet.')).not.toBeInTheDocument();
  });

  it('opens learner document and review tabs from the signature and meeting panels', async () => {
    api.documents.mockResolvedValue({ employer: portal.employer, items: [1, 2].map(id => ({
      id: String(id), kind: 'document', docType: 'training', label: `Document ${id}`,
      generatedAt: null, signable: true, signed: false, signedName: '', signedAt: null,
      learner: { id: '12', kind: 'commercial', name: 'Morgan Learner', programme: 'Marketing' },
    })) });
    showPage();
    const actions = within(await screen.findByRole('region', { name: 'Signatures required (2)' }));
    const links = actions.getAllByRole('link', { name: 'Morgan Learner' });
    expect(links).toHaveLength(2);
    links.forEach(link => expect(link).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=documents'));
    expect(actions.getAllByText('Awaiting your signature')).toHaveLength(2);
    expect(actions.getByRole('link', { name: 'View all documents' })).toHaveAttribute('href', '/employers/8/documents');
    const meetings = within(await screen.findByRole('region', { name: /^Meetings to attend/ }));
    meetings.getAllByRole('link', { name: 'Alex Learner' }).forEach(link =>
      expect(link).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews'));
  });

  it('offers the review join link only once the invitation is confirmed', async () => {

    api.reviews.mockImplementation(async (_employer: unknown, _kind: unknown, id: unknown) => ({
      events: [makeReview(`pr-${id}`, { scheduledDate: '2099-12-21', meetingLink: 'https://teams.example.test/meet/1', invited: true, syncState: 'synced' })],
      definitions: {},
    }));
    showPage();
    const panel = within(await screen.findByRole('region', { name: 'Meetings to attend (2)' }));

    const join = panel.getAllByRole('link', { name: /^Join / });
    expect(join).toHaveLength(2);
    join.forEach(link => {
      expect(link).toHaveAttribute('href', 'https://teams.example.test/meet/1');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });
  });

  it('withholds the join link while the Teams invitation is unconfirmed', async () => {

    api.reviews.mockImplementation(async (_employer: unknown, _kind: unknown, id: unknown) => ({
      events: [makeReview(`pr-${id}`, { scheduledDate: '2099-12-21', meetingLink: 'https://teams.example.test/meet/1', invited: false, syncState: 'synced' })],
      definitions: {},
    }));
    showPage();
    const panel = within(await screen.findByRole('region', { name: 'Meetings to attend (2)' }));

    expect(panel.queryByRole('link', { name: /^Join / })).not.toBeInTheDocument();
    expect(panel.getAllByText('Invitation not confirmed. Contact your coach.')).toHaveLength(2);
    const details = panel.getAllByRole('link', { name: 'Progress review' });
    expect(details.map(link => link.getAttribute('href'))).toEqual([
      '/employers/8/learner/apprenticeship/11?tab=reviews&reviewId=pr-11',
      '/employers/8/learner/commercial/12?tab=reviews&reviewId=pr-12',
    ]);
  });

  it('opens the records behind each summary card in a dialog', async () => {
    portal.learners[1].isActive = true;
    metrics.learners['11'].risk = 'need-attention';
    metrics.learners['12'].risk = 'at-risk';
    const cards: [RegExp, string, string[]][] = [
      [/^Total learners: 2\./, 'Total learners', ['Alex Learner', 'Morgan Learner']],
      [/^ON TRACK: 0\./, 'ON TRACK', []],
      [/^AT RISK: 1\./, 'AT RISK', ['Morgan Learner']],
      [/^Needs attention: 2\./, 'Needs attention', ['Alex Learner', 'Morgan Learner']],
    ];
    showPage();
    for (const [name, title, expected] of cards) {
      await userEvent.click(await screen.findByRole('button', { name }));
      const panel = within(await screen.findByRole('dialog', { name: title }));
      const listed = panel.queryAllByRole('listitem');
      expect(listed).toHaveLength(expected.length);
      expected.forEach((learner, index) => expect(listed[index]).toHaveTextContent(learner));
      // Only a review row has actions of its own; the learner lists stay read-only.
      expect(panel.queryByRole('link')).not.toBeInTheDocument();
      await userEvent.click(panel.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/employers\/8$/);
  });

  it('keeps saved OTJ statuses consistent between Overview, My learners and the progress filter', async () => {
    portal.learners[1].isActive = true;
    metrics.learners['11'].risk = 'need-attention';
    metrics.learners['12'].risk = 'at-risk';
    showPage();
    const attention = await screen.findByRole('button', { name: /Needs attention: 2\. Saved learner OTJ status/ });
    await userEvent.click(attention);
    const flagged = within(await screen.findByRole('dialog', { name: 'Needs attention' })).getAllByRole('listitem');
    expect(flagged).toHaveLength(2);
    expect(flagged[0]).toHaveTextContent('Alex Learner');
    expect(flagged[0]).toHaveTextContent('Needs attention');
    expect(flagged[1]).toHaveTextContent('Morgan Learner');
    expect(flagged[1]).toHaveTextContent('At risk');
    cleanup();
    showPage('/employers/8/learners');
    const overview = within(await screen.findByRole('region', { name: 'Learner progress overview' }));
    await waitFor(() => expect(overview.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 1, At risk: 1, Not available: 0'));
    expect(table().getByText('Needs attention')).toBeVisible();
    expect(table().getByText('At risk')).toBeVisible();
    expect(table().queryByText('OTJ status unavailable')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Progress' }), 'at-risk');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    expect(overview.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 0, At risk: 1, Not available: 0');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Progress' }), 'need-attention');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Morgan Learner' })).not.toBeInTheDocument();
  });

  it('keeps unavailable OTJ and attendance indicators distinct from measured zero', async () => {
    metrics.learners = {};
    portal.learners.forEach(learner => { learner.otjhProgress = null; });
    showPage();
    const summary = within(await screen.findByRole('region', { name: 'Learner summary' }));
    await waitFor(() => expect(summary.getByText('Needs attention').parentElement).toHaveTextContent('Unavailable'));
    expect(summary.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(summary.queryByText('0%')).not.toBeInTheDocument();
    const performance = within(screen.getByRole('region', { name: 'Learning performance' }));
    expect(await performance.findByRole('button', { name: 'Average attendance: Unavailable' })).toBeVisible();
    expect(performance.getByRole('button', { name: 'Average off-the-job hours: Unavailable' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Engagement this month' })).not.toBeInTheDocument();
  });

  it('keeps the learner table and successful review reads when another source fails, with retry', async () => {
    api.metrics.mockRejectedValueOnce(new Error('temporary'));
    api.reviews.mockRejectedValueOnce(new Error('temporary'));
    showPage('/employers/8/learners');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    expect(table().getByText('45%')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('retries a failed initial request', async () => {
    api.portal.mockRejectedValueOnce(new Error('Could not load learners.'));
    showPage('/employers/8/learners');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load learners.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
  });

  it('handles an employer with no learners without making secondary requests', async () => {
    portal.learners = [];
    portal.outstandingTotal = 0;
    showPage('/employers/8/learners');
    expect(await screen.findByRole('heading', { name: 'No learners linked yet' })).toBeVisible();
    expect(api.metrics).not.toHaveBeenCalled();
    expect(api.reviews).not.toHaveBeenCalled();
  });

  it('paginates large learner lists and resets pagination after filtering', async () => {
    portal.learners = Array.from({ length: 10 }, (_, index) => ({ ...portal.learners[0], id: String(index + 100), name: 'Learner ' + index }));
    showPage('/employers/8/learners');
    await screen.findByRole('heading', { name: 'Your learners (10)' });
    expect(table().getAllByRole('row')).toHaveLength(9);
    await userEvent.click(screen.getByRole('button', { name: 'Next learner page' }));
    expect(table().getAllByRole('row')).toHaveLength(3);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search learners' }), { target: { value: 'Learner 0' } });
    expect(table().getByRole('link', { name: 'View Learner 0' })).toBeVisible();
  });
});
