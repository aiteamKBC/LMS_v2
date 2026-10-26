import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployerPortal, EmployerDashboardMetrics } from '@/api/employerPortal';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import EmployerPortalPage from './EmployerPortalPage';
import { londonToday } from './employerDashboardData';

const api = vi.hoisted(() => ({
  portal: vi.fn(), metrics: vi.fn(), reviews: vi.fn(), attendance: vi.fn(),
}));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerPortal: (...args: unknown[]) => api.portal(...args),
  fetchEmployerDashboardMetrics: (...args: unknown[]) => api.metrics(...args),
  fetchEmployerProgressReviews: (...args: unknown[]) => api.reviews(...args),
  fetchEmployerLearnerAttendance: (...args: unknown[]) => api.attendance(...args),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { role: 'employer', displayName: 'Test Employer' } } }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}{location.search}</output>;
}
function showPage(path = '/employers/8') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/employers/:employerId/*" element={<><EmployerPortalPage /><CurrentPath /></>} />
  </Routes></MemoryRouter>);
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
  portal = {
    employer: { id: '8', name: 'Test employer', email: 'employer@example.test', employerGroupNames: ['Test org'] },
    outstandingTotal: 2,
    learners: [
      { id: '11', kind: 'apprenticeship', name: 'Alex Learner', email: 'alex@example.test', programme: 'Data Analysis', cohort: 'Cohort A', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 2 },
      { id: '12', kind: 'commercial', name: 'Morgan Learner', email: 'morgan@example.test', programme: 'Marketing', cohort: 'Cohort B', programmeStatus: 'Onboarding', onboardingStatus: 'Onboarding', isActive: false, outstandingCount: 2, documentsTotal: 2 },
    ],
  };
  metrics = { asOf: londonToday(), learners: {
    '11': { programme: { completed: 68, total: 100, percent: 68, status: 'ready' }, risk: 'on-track',
      otjh: { actual: 90, planned: 200, percent: 45 }, attendance: { present: 8, sessions: 10, late: 1, absent: 2, attendanceRate: 80 } },
    '12': { programme: { completed: 32, total: 100, percent: 32, status: 'ready' }, risk: 'unavailable',
      otjh: { actual: 70, planned: 400, percent: 17.5 }, attendance: { present: 2, sessions: 3, late: 1, absent: 1, attendanceRate: 67 } },
  } };
  api.portal.mockImplementation(async () => structuredClone(portal));
  api.metrics.mockImplementation(async () => structuredClone(metrics));
  api.attendance.mockImplementation(async (_employer, _kind, id) => ({ attendance: structuredClone(metrics.learners[id]?.attendance ?? null) }));
  api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
    makeReview('pr-' + id, id === '12' ? { scheduledDate: '2099-12-21', targetDate: '2099-12-21' } : {}),
    makeReview('gateway-' + id, { importedReviewType: 'Gateway Review', title: 'Gateway Review' }),
    makeReview('support-' + id, { importedReviewType: 'Personal Support Plan', title: 'Personal Support Plan' }),
  ], definitions: {} }));
});
afterEach(cleanup);

describe('employer home dashboard', () => {
  it.each(['/employers/8', '/employers/8/reviews'])('uses APTEM marker-only current steps independently per learner on %s', async path => {
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
    expect(third).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('path')).toHaveTextContent('/employers/8/learner/apprenticeship/11?tab=reviews');
  });

  it.each(['/employers/8', '/employers/8/reviews'])('keeps Native current-step styling and completed APTEM history unselected on %s', async path => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [makeReview('same-key', {
      reviewSource: id === '11' ? 'curriculum' : 'aptem', status: id === '11' ? 'scheduled' : 'completed',
    })], definitions: {} }));
    showPage(path);
    const journey = within(await screen.findByRole('region', { name: 'Progress review journey' }));
    const native = await journey.findByRole('link', { name: /^Alex Learner: Progress review,/ });
    const history = await journey.findByRole('link', { name: /^Morgan Learner: Progress review,/ });
    expect(native).toHaveAttribute('aria-current', 'step');
    expect(native).not.toHaveAttribute('data-selection', 'marker');
    expect(history).toHaveAttribute('data-selection', 'marker');
    expect(history).not.toHaveAttribute('aria-current');
  });

  it('keeps a loading state while learners are being prepared', () => {
    api.portal.mockReturnValueOnce(new Promise(() => undefined));
    showPage();
    expect(screen.getByRole('status', { name: 'Loading learners' })).toBeVisible();
    expect(screen.getByTestId('learners-loading-spinner')).toHaveClass('animate-spin');
    expect(api.metrics).not.toHaveBeenCalled();
  });

  it('renders real progress and the reference banner, and links both learner kinds correctly', async () => {
    const { container } = showPage();
    expect(await screen.findByRole('heading', { name: 'Test employer' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/assets/employer/graduation-group.webp"]')).toBeInTheDocument();
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByRole('progressbar', { name: 'Morgan Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '17.5');
    expect(table().getByRole('columnheader', { name: 'Progress' })).toBeVisible();
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
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'summary');
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'programme');
    expect(api.reviews).toHaveBeenCalledWith('8', 'commercial', '12', expect.any(AbortSignal));
  });

  it('combines search, programme, cohort and status filters and clears them', async () => {
    showPage();
    await screen.findByRole('heading', { name: 'Your learners (2)' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Programme' }), 'Marketing');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort B');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'inactive');
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Programme' })).toHaveValue('');
  });

  it('shows precise OTJ hours in the table and preserves the separate programme activity chart', async () => {
    metrics.learners['11'].programme = { completed: 1, total: 900, percent: 0.11, status: 'ready' };
    metrics.learners['11'].otjh = { actual: 0.55, planned: 500, percent: 0.11 };
    showPage();
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '0.11');
    expect(table().getByText('0.11%')).toBeVisible();
    expect(table().getByText('0.55 / 500 OTJ hours')).toBeVisible();
    const programmes = within(screen.getByRole('region', { name: 'Progress by programme' }));
    expect(programmes.getByText('0.11%')).toBeVisible();
    expect(programmes.getByRole('progressbar', { name: 'Data Analysis average progress' })).toHaveAttribute('aria-valuenow', '0.11');
    expect(table().getByText('17.5%')).toBeVisible();
  });

  it.each([
    { actual: 0, planned: 100, percent: 0, text: '0%', bar: '0' },
    { actual: 125, planned: 100, percent: 125, text: '125%', bar: '100' },
    { actual: 12.5, planned: null, percent: null, text: 'Not available', bar: null },
    { actual: 0, planned: 0, percent: null, text: 'Not available', bar: null },
  ])('distinguishes zero, missing plans and OTJ above target ($actual / $planned)', async ({ actual, planned, percent, text, bar }) => {
    metrics.learners['11'].otjh = { actual, planned, percent };
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
    showPage();
    await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    expect(table().getByText('No attendance records yet')).toBeVisible();
    expect(table().queryByRole('progressbar', { name: 'Alex Learner attendance' })).not.toBeInTheDocument();
    expect(table().getByRole('progressbar', { name: 'Morgan Learner attendance' })).toHaveAttribute('aria-valuenow', '0');
    expect(table().getByText('0 / 3 sessions')).toBeVisible();
  });

  it('shows loading for both table metrics while the request is pending', async () => {
    api.metrics.mockReturnValueOnce(new Promise(() => undefined));
    api.attendance.mockImplementation(() => new Promise(() => undefined));
    showPage('/employers/8/learners');
    await screen.findByRole('heading', { name: 'Your learners (2)' });
    const cells = within(table().getByRole('link', { name: 'View Alex Learner' }).closest('tr')!).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('Loading…');
    expect(cells[4]).toHaveTextContent('Loading…');
    expect(table().queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows saved hours and status while programme and one attendance register are still loading', async () => {
    api.metrics.mockImplementation((_employer, _signal, section) => section === 'summary'
      ? Promise.resolve(structuredClone(metrics)) : new Promise(() => undefined));
    api.attendance.mockImplementation((_employer, _kind, id) => id === '11'
      ? new Promise(() => undefined) : Promise.resolve({ attendance: metrics.learners[id].attendance }));
    showPage();
    expect(await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByRole('progressbar', { name: 'Morgan Learner attendance' })).toHaveAttribute('aria-valuenow', '67');
    const row = within(table().getByRole('link', { name: 'View Alex Learner' }).closest('tr')!);
    expect(row.getAllByRole('cell')[4]).toHaveTextContent('Loading…');
    expect(within(screen.getByRole('region', { name: 'Learner summary' })).getByText('Saved learner OTJ status')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Progress by programme' })).getAllByText('Loading…')).toHaveLength(2);
  });

  it('isolates attendance failures and retries without hiding saved progress or the other learner', async () => {
    api.attendance.mockRejectedValueOnce(new Error('synthetic failure'));
    showPage('/employers/8/learners');
    expect(await screen.findByRole('alert')).toHaveTextContent('Some attendance records could not be loaded.');
    expect(screen.getByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Morgan Learner attendance' })).toBeVisible();
    expect(api.metrics.mock.calls.every(call => call[2] === 'summary')).toBe(true);
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

  it('counts only progress reviews and filters this month without displaying Gateway or support plans', async () => {
    showPage();
    const due = await screen.findByRole('button', { name: /Reviews due this month: 1\. Open progress reviews/ });
    expect(screen.queryByText('Gateway Review')).not.toBeInTheDocument();
    expect(screen.queryByText('Personal Support Plan')).not.toBeInTheDocument();
    await userEvent.click(due);
    expect(screen.getByRole('combobox', { name: 'Upcoming review' })).toHaveValue('month');
    expect(screen.getByTestId('path')).toHaveTextContent('/employers/8/reviews?upcoming=month');
    const journey = screen.getByRole('region', { name: 'Progress review journey' });
    expect(within(journey).getByRole('link', { name: 'Alex Learner' })).toBeVisible();
    expect(within(journey).queryByRole('link', { name: 'Morgan Learner' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('inactive');
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
    expect(alex.getByText('Your signature needed')).toBeVisible();
    expect(alex.getByText('Planned review 5')).toBeVisible();
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
    await screen.findByRole('link', { name: /Alex Learner: Done review,/ });
    const alex = within(screen.getByRole('article', { name: 'Alex Learner reviews' }));
    const current = alex.getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    // The appointment due first, even though the plan puts it last in the timeline.
    expect(current[0]).toHaveAccessibleName('Alex Learner: Due review, Scheduled, 1 Nov 2026');

    cleanup();
    showPage();
    const journey = within(await screen.findByRole('region', { name: 'Progress review journey' }));
    await screen.findByRole('link', { name: /Alex Learner: Due review,/ });
    expect(journey.getAllByRole('link').filter(link => link.getAttribute('aria-current') === 'step')
      .map(link => link.getAttribute('aria-label'))).toEqual([
      'Alex Learner: Due review, Scheduled, 1 Nov 2026', 'Morgan Learner: Due review, Scheduled, 1 Nov 2026']);
    expect(table().getAllByRole('link', { name: '1 Nov 2026' })).toHaveLength(2);
  });

  it.each(['/employers/8', '/employers/8/reviews'])('orders the journey by the source plan after appointments move on %s', async path => {
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
      expect(links.map(link => link.querySelector('strong')?.textContent)).toEqual(
        path.endsWith('/reviews') ? ['Review 1', 'Review 2', 'Review 3', 'Review 4', 'Review 5']
          : ['Review 1', 'Review 2', 'Review 3', 'Review 4']);
      expect(links[0]).toHaveAccessibleName(`${name}: Review 1, Waiting for signatures, 10 Dec 2026`);
      expect(links[1]).toHaveAccessibleName(`${name}: Review 2, Completed, 10 Sept 2026`);
    }
    if (!path.endsWith('/reviews')) {
      // The appointment due first is still the next review, irrespective of plan order.
      expect(table().getAllByRole('link', { name: '1 Aug 2026' })).toHaveLength(2);
    }
  });

  it('filters the review journeys and can recover from an empty search', async () => {
    showPage('/employers/8/reviews');
    await screen.findByRole('article', { name: 'Alex Learner reviews' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    expect(screen.getByRole('article', { name: 'Morgan Learner reviews' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Alex Learner reviews' })).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 learners')).toBeVisible();
    await userEvent.type(screen.getByRole('searchbox'), ' missing');
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
    expect(loading.getByRole('status')).toHaveTextContent('Loading progress reviews');
    expect(loading.queryByText('No progress reviews planned yet.')).not.toBeInTheDocument();
  });

  it('opens existing document and progress-review tabs from actionable links', async () => {
    showPage();
    const actions = await screen.findByRole('region', { name: 'Action required' });
    const action = within(actions).getByRole('link', { name: /Morgan Learner/ });
    expect(action).toHaveTextContent('2 documents need your signature');
    expect(action).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=documents');
    const journey = screen.getByRole('region', { name: 'Progress review journey' });
    expect(within(journey).getByRole('link', { name: 'Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews');
    expect(within(actions).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/employers/8/documents');
  });

  it('uses the same OTJ statuses for the overview, table, filters and Needs attention', async () => {
    portal.learners[1].isActive = true;
    metrics.learners['11'].risk = 'need-attention';
    metrics.learners['12'].risk = 'at-risk';
    showPage();
    const attention = await screen.findByRole('button', { name: /Needs attention: 2\. Saved learner OTJ status/ });
    const overview = within(screen.getByRole('region', { name: 'Learner progress overview' }));
    expect(overview.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 1, At risk: 1, Not available: 0');
    expect(table().getByText('Needs attention')).toBeVisible();
    expect(table().getByText('At risk')).toBeVisible();
    expect(table().queryByText('OTJ status unavailable')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'at-risk');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    expect(overview.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 0, At risk: 1, Not available: 0');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'need-attention');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Morgan Learner' })).not.toBeInTheDocument();
    await userEvent.click(attention);
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('attention');
  });

  it('shows missing metrics as unavailable instead of zero or healthy progress', async () => {
    metrics.learners = {};
    showPage();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Learner summary' })).toHaveTextContent('Needs attentionUnavailable'));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Engagement this month' })).toHaveTextContent('Not available');
  });

  it('keeps the learner table and successful review reads when another source fails, with retry', async () => {
    api.metrics.mockRejectedValueOnce(new Error('temporary'));
    api.reviews.mockRejectedValueOnce(new Error('temporary'));
    showPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('retries a failed initial request', async () => {
    api.portal.mockRejectedValueOnce(new Error('Could not load learners.'));
    showPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load learners.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
  });

  it('handles an employer with no learners without making secondary requests', async () => {
    portal.learners = [];
    portal.outstandingTotal = 0;
    showPage();
    expect(await screen.findByRole('heading', { name: 'No learners linked yet' })).toBeVisible();
    expect(api.metrics).not.toHaveBeenCalled();
    expect(api.reviews).not.toHaveBeenCalled();
  });

  it('paginates large learner lists and resets pagination after filtering', async () => {
    portal.learners = Array.from({ length: 10 }, (_, index) => ({ ...portal.learners[0], id: String(index + 100), name: 'Learner ' + index }));
    showPage();
    await screen.findByRole('heading', { name: 'Your learners (10)' });
    expect(table().getAllByRole('row')).toHaveLength(9);
    await userEvent.click(screen.getByRole('button', { name: 'Next learner page' }));
    expect(table().getAllByRole('row')).toHaveLength(3);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Learner 0' } });
    expect(table().getByRole('link', { name: 'View Learner 0' })).toBeVisible();
  });
});
