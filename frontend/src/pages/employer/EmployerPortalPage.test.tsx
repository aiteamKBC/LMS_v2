import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployerPortal, EmployerDashboardMetrics } from '@/api/employerPortal';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import EmployerPortalPage from './EmployerPortalPage';
import { londonToday } from './employerDashboardData';
import { dashboardOverviewFixture } from '@/test/dashboardOverviewFixture';
import { fetchEmployerContracts } from '@/api/employerContracts';

vi.mock('@/api/employerMeetings', () => ({
  fetchEmployerTeamsMeetings: vi.fn().mockResolvedValue({ meetings: [], status: 'ready' }),
}));

vi.mock('@/api/employerContracts', () => ({
  fetchEmployerContracts: vi.fn().mockResolvedValue({ contracts: [], sources: { lms: 'ready', aptem: 'ready' } }),
}));

const api = vi.hoisted(() => ({
  portal: vi.fn(), metrics: vi.fn(), reviews: vi.fn(), reviewSummary: vi.fn(), attendance: vi.fn(), overview: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: 'employer' }));
vi.mock('@/api/employerPortal', () => ({
  fetchEmployerLearningOverview: (...args: unknown[]) => api.overview(...args),
  fetchEmployerPortal: (...args: unknown[]) => api.portal(...args),
  fetchEmployerDashboardMetrics: (...args: unknown[]) => api.metrics(...args),
  fetchEmployerProgressReviews: (...args: unknown[]) => api.reviews(...args),
  fetchEmployerProgressReviewSummary: (...args: unknown[]) => api.reviewSummary(...args),
  fetchEmployerLearnerAttendance: (...args: unknown[]) => api.attendance(...args),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ auth: { account: { role: session.role, displayName: 'Test Employer' } } }),
}));
vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}{location.search}</output>;
}
function showPage(path = '/employers/8', state?: unknown) {
  const entry = new URL(path, 'http://localhost');
  return render(<MemoryRouter initialEntries={[{ pathname: entry.pathname, search: entry.search, state }]}><Routes>
    <Route path="/employers/:employerId/*" element={<><EmployerPortalPage /><CurrentPath /></>} />
    <Route path="*" element={<CurrentPath />} />
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
  api.overview.mockResolvedValue({ programme: [] });
  api.portal.mockImplementation(async () => structuredClone(portal));
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
afterEach(cleanup);

describe('employer home dashboard', () => {
  it('shows linked learners in a module progress matrix that follows the overview filters', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => ({ programme: [
      { id: 'current:shared', title: 'Shared module', percent: id === '11' ? 0 : 81 },
      { id: id === '11' ? 'current:A' : 'legacy:B', title: id === '11' ? 'Analysis' : 'Marketing', percent: 25 },
    ] }));
    showPage();
    const matrix = within(await screen.findByRole('region', { name: 'Learner-by-module progress' }));
    expect(await matrix.findByRole('link', { name: /Alex Learner · Shared module: 0%/ })).toBeVisible();
    expect(await matrix.findByRole('link', { name: /Morgan Learner · Shared module: 81%/ })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=plan');
    expect(matrix.getAllByRole('rowheader')).toHaveLength(2);
    expect(matrix.getAllByRole('columnheader')).toHaveLength(4);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'legacy:B');
    expect(matrix.getAllByRole('rowheader')).toHaveLength(1);
    expect(matrix.getAllByRole('columnheader')).toHaveLength(2);
    expect(matrix.getByRole('link', { name: 'Morgan Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(matrix.getAllByRole('rowheader')).toHaveLength(2);
  });

  it('keeps the original summary cards and shows only the four module measures in a column chart', async () => {
    api.overview.mockImplementation(async () => {
      const payload = dashboardOverviewFixture();
      payload.modules[0].assignments = { submitted: 1, total: 2 };
      payload.modules.push({ ...payload.modules[0], id: 'current:M2', title: 'Second module',
        hours: { actual: 0, planned: 100 }, assignments: { submitted: 0, total: 2 } });
      payload.programme.push({ id: 'current:M2', title: 'Second module', percent: 0 });
      return payload;
    });
    showPage();
    const performance = within(await screen.findByRole('region', { name: 'Learning performance' }));
    expect(performance.getAllByRole('button')).toHaveLength(5);
    expect(performance.getByRole('article', { name: 'Average performance: calculation pending' })).toBeVisible();
    expect(await performance.findByRole('button', { name: 'Average off-the-job hours: 80 h' })).toBeVisible();
    expect(screen.queryByRole('region', { name: /^Contracts/ })).not.toBeInTheDocument();
    expect(fetchEmployerContracts).not.toHaveBeenCalled();
    const modules = within(await screen.findByRole('region', { name: 'Modules' }));
    const second = within(await modules.findByRole('article', { name: 'Second module' }));
    expect(second.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(performance.queryByRole('img')).not.toBeInTheDocument();
    const columns = within(screen.getByRole('region', { name: 'Module performance' }));
    expect(columns.getByRole('group', { name: 'Module performance column chart' })).toBeVisible();
    expect(columns.getAllByRole('meter')).toHaveLength(8);
    expect(columns.queryByRole('combobox')).not.toBeInTheDocument();
    const secondColumns = within(columns.getByRole('group', { name: 'Second module' }));
    expect(secondColumns.getByRole('meter', { name: 'Off-the-job hours' })).toHaveAttribute('aria-valuenow', '0');
    expect(secondColumns.getByRole('meter', { name: 'Assignment submission' })).toHaveAttribute('aria-valuenow', '0');
    const firstColumns = within(columns.getByRole('group', { name: 'Module' }));
    expect(firstColumns.getByRole('meter', { name: 'Assignment submission' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByRole('button', { name: 'View performance' })).not.toBeInTheDocument();
    await userEvent.click(performance.getByRole('button', { name: /Average attendance:/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'Average attendance' }));
    expect(dialog.getByText('Alex Learner')).toBeVisible();
    expect(dialog.getByText('Morgan Learner')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.overview).toHaveBeenCalledTimes(2);
  });

  it('uses existing module averages in four columns and combines cohort filtering with summary details', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => {
      const payload = dashboardOverviewFixture();
      payload.modules[0].assignments = id === '11' ? { submitted: 1, total: 2 } : { submitted: 3, total: 4 };
      payload.modules[0].ksb = id === '11' ? { completed: 1, total: 2 } : { completed: 3, total: 4 };
      payload.modules[0].hours = id === '11' ? { actual: 10, planned: 20 } : { actual: 30, planned: 120 };
      payload.modules[0].attendance = id === '11' ? { attended: 1, total: 2 } : { attended: 9, total: 10 };
      return payload;
    });
    showPage();
    const summary = within(await screen.findByRole('region', { name: 'Learning performance' }));
    const chart = within(screen.getByRole('region', { name: 'Module performance' }));
    await waitFor(() => expect(chart.getAllByRole('meter')).toHaveLength(4));
    expect(chart.getByRole('meter', { name: 'Off-the-job hours' })).toHaveAttribute('aria-valuenow', '37.5');
    expect(chart.getByRole('meter', { name: 'KSBs' })).toHaveAttribute('aria-valuenow', '62.5');
    expect(chart.getByRole('meter', { name: 'Assignment submission' })).toHaveAttribute('aria-valuenow', '62.5');
    expect(chart.getByRole('meter', { name: 'Attendance' })).toHaveAttribute('aria-valuenow', '70');
    expect(chart.queryByRole('meter', { name: 'Reviews' })).not.toBeInTheDocument();
    expect(summary.queryByRole('img')).not.toBeInTheDocument();
    expect(summary.getByRole('button', { name: 'Average off-the-job hours: 80 h' })).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort A');
    for (const meter of chart.getAllByRole('meter')) expect(meter).toHaveAttribute('aria-valuenow', '50');
    const assignments = summary.getByRole('button', { name: 'Assignment submission: 50%' });
    assignments.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = within(screen.getByRole('dialog', { name: 'Assignment submission' }));
    expect(dialog.getByText('Alex Learner')).toBeVisible();
    expect(dialog.queryByText('Morgan Learner')).not.toBeInTheDocument();
    expect(dialog.getByText('50%')).toBeVisible();
  });

  it('updates all calculated performance cards and their details for combined filters and Clear filters', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => {
      const payload = dashboardOverviewFixture();
      payload.modules[0].assignments = { submitted: id === '11' ? 1 : 2, total: 2 };
      payload.metrics.ksb = { completed: id === '11' ? 1 : 3, total: 4, percent: id === '11' ? 25 : 75 };
      payload.programme = [{ id: id === '11' ? 'current:A' : 'legacy:B', title: 'Assigned module', percent: 50 }];
      return payload;
    });
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: id === '11'
      ? [makeReview('alex-review')]
      : [makeReview('morgan-review'), makeReview('morgan-completed', { status: 'completed' })] }));
    showPage();
    const cards = within(await screen.findByRole('region', { name: 'Learning performance' }));
    const expectCards = (attendance: string, assignments: string, hours: string, ksb: string, reviews: string) => {
      for (const name of [`Average attendance: ${attendance}`, `Assignment submission: ${assignments}`,
        `Average off-the-job hours: ${hours}`, `Average KSBs: ${ksb}`, `Reviews: ${reviews}`]) {
        expect(cards.getByRole('button', { name })).toBeVisible();
      }
      expect(cards.getByRole('article', { name: 'Average performance: calculation pending' })).toBeVisible();
    };
    await waitFor(() => expectCards('73.3%', '75%', '80 h', '50%', '3'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort A');
    expectCards('80%', '50%', '90 h', '25%', '1');
    await userEvent.click(cards.getByRole('button', { name: 'Average KSBs: 25%' }));
    const details = within(screen.getByRole('dialog', { name: 'Average KSBs' }));
    expect(details.getByText('Alex Learner')).toBeVisible();
    expect(details.queryByText('Morgan Learner')).not.toBeInTheDocument();
    await userEvent.click(details.getByRole('button', { name: 'Close' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'legacy:B');
    expectCards('Unavailable', 'Unavailable', 'Unavailable', 'Unavailable', '0');
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expectCards('73.3%', '75%', '80 h', '50%', '3');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Module' }), 'legacy:B');
    expectCards('66.7%', '100%', '70 h', '75%', '2');
    expect(api.overview).toHaveBeenCalledTimes(2);
  });

  it('distinguishes zero columns from unavailable module measures', async () => {
    api.overview.mockImplementation(async () => {
      const payload = dashboardOverviewFixture();
      Object.assign(payload.modules[0], { assignments: { submitted: 0, total: 2 }, ksb: { completed: 0, total: 2 },
        hours: { actual: 0, planned: 100 }, attendance: { attended: 0, total: 2 } });
      return payload;
    });
    showPage();
    const chart = within(await screen.findByRole('region', { name: 'Module performance' }));
    await waitFor(() => expect(chart.getAllByRole('meter')).toHaveLength(4));
    for (const meter of chart.getAllByRole('meter')) expect(meter).toHaveAttribute('aria-valuenow', '0');
    cleanup();
    const unavailable = dashboardOverviewFixture();
    Object.assign(unavailable.modules[0], { assignments: undefined, ksb: null, attendance: null, hours: { actual: null, planned: null } });
    api.overview.mockResolvedValue(unavailable);
    showPage();
    const missing = within(await screen.findByRole('region', { name: 'Module performance' }));
    await waitFor(() => expect(missing.getAllByRole('img', { name: /: Unavailable$/ })).toHaveLength(4));
    expect(missing.queryByRole('meter')).not.toBeInTheDocument();
    expect(missing.getAllByText('N/A')).toHaveLength(4);
  });

  it('keeps pending module columns empty while their sources load', async () => {
    api.overview.mockImplementation(() => new Promise(() => undefined));
    showPage();
    const chart = within(await screen.findByRole('region', { name: 'Module performance' }));
    expect(await chart.findByRole('status', { name: 'Loading module chart' })).toBeVisible();
    expect(chart.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('places Overview filters above the six performance cards and keeps the learner directory in My learners', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => ({ programme: [
      { id: 'current:100', title: 'Shared module', percent: id === '11' ? 80 : 20 },
      { id: `current:${id}`, title: 'Individual module', percent: null },
    ] }));
    showPage();
    const modules = within(await screen.findByRole('region', { name: 'Modules' }));
    const shared = within(await modules.findByRole('article', { name: 'Shared module' }));
    expect(shared.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(shared.getByText('2 of 2 learners have progress data')).toBeVisible();
    expect(modules.getAllByRole('article', { name: 'Individual module' })).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'Employer learners' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Learner progress overview' })).not.toBeInTheDocument();
    const filters = screen.getByRole('form', { name: 'Filter learners' });
    const performance = screen.getByRole('region', { name: 'Learning performance' });
    expect(screen.getAllByRole('form', { name: 'Filter learners' })).toHaveLength(1);
    expect(filters).toBeVisible();
    expect(filters.compareDocumentPosition(performance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(modules.queryByRole('form', { name: 'Filter learners' })).not.toBeInTheDocument();
    const learnerToggle = shared.getByRole('button', { name: 'View learners (2)' });
    expect(learnerToggle).toHaveAttribute('aria-expanded', 'false');
    expect(shared.queryByRole('link', { name: 'Alex Learner' })).not.toBeInTheDocument();
    await userEvent.click(learnerToggle);
    expect(learnerToggle).toHaveAttribute('aria-expanded', 'true');
    expect(shared.getByRole('link', { name: 'Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=plan');
    expect(shared.getByRole('link', { name: 'Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=plan');
    await userEvent.keyboard('{Enter}');
    expect(learnerToggle).toHaveAttribute('aria-expanded', 'false');
    expect(shared.queryByRole('link', { name: 'Alex Learner' })).not.toBeInTheDocument();
    await userEvent.keyboard(' ');
    expect(learnerToggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort A');
    expect(shared.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
    expect(shared.getByText('1 of 1 learners have progress data')).toBeVisible();
    expect(api.overview).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(shared.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows every review on Overview and filters learners by module identity using the existing filters', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => ({ programme: [
      { id: 'current:shared', title: 'Shared module', percent: 0 },
      { id: id === '11' ? 'current:individual' : 'legacy:individual', title: 'Individual module', percent: null },
    ] }));
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [
      makeReview(`${id}-done`, { status: 'completed' }),
      makeReview(`${id}-signature`, { status: 'awaiting-signature', employerSignatureRequired: true, employerSigned: false }),
      makeReview(`${id}-gateway`, { source: 'gateway', title: 'Gateway Review', importedReviewType: 'Gateway Review' }),
    ] }));
    showPage();
    const filters = within(await screen.findByRole('form', { name: 'Filter learners' }));
    const selector = filters.getByRole('combobox', { name: 'Module' });
    await waitFor(() => expect(selector).toBeEnabled());
    const journeys = within(screen.getByRole('region', { name: 'Progress review journey' }));
    const alex = within(await journeys.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(alex.getByRole('link', { name: 'View reviews for Alex Learner' })).toHaveTextContent('View reviews (3)');
    expect(alex.getByText('1 awaiting your signature')).toBeVisible();
    expect(alex.getByRole('link', { name: /^Alex Learner: Gateway Review,/ })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews&reviewId=11-gateway');

    await userEvent.selectOptions(selector, 'legacy:individual');
    expect(journeys.queryByRole('article', { name: 'Alex Learner reviews' })).not.toBeInTheDocument();
    const morgan = within(journeys.getByRole('article', { name: 'Morgan Learner reviews' }));
    expect(morgan.getByRole('link', { name: 'View reviews for Morgan Learner' })).toHaveTextContent('View reviews (3)');
    expect(morgan.getByRole('link', { name: /^Morgan Learner: Review 2,/ })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=reviews&reviewId=12-signature');
    expect(journeys.getByText('1 of 2 learners')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Modules' })).getAllByRole('article')).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Module performance' })).getAllByRole('group', { name: 'Individual module' })).toHaveLength(1);

    await userEvent.selectOptions(selector, 'current:shared');
    expect(journeys.getAllByRole('article')).toHaveLength(2);
    await userEvent.selectOptions(filters.getByRole('combobox', { name: 'Cohort' }), 'Cohort A');
    expect(journeys.getAllByRole('article')).toHaveLength(1);
    expect(journeys.getByRole('article', { name: 'Alex Learner reviews' })).toBeVisible();
    await userEvent.selectOptions(selector, 'legacy:individual');
    expect(journeys.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    await userEvent.click(journeys.getByRole('button', { name: 'Clear filters' }));
    expect(selector).toHaveValue('');
    expect(journeys.getAllByRole('article')).toHaveLength(2);
    await userEvent.type(filters.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    expect(journeys.getAllByRole('article')).toHaveLength(1);
    expect(journeys.getByRole('article', { name: 'Morgan Learner reviews' })).toBeVisible();
    expect(api.overview).toHaveBeenCalledTimes(2);
    expect(api.reviews).toHaveBeenCalledTimes(2);
  });

  it('keeps module membership failures visible on Overview and waits for membership when retrying', async () => {
    let resolveAlex!: (value: { programme: { id: string; title: string; percent: number }[] }) => void;
    const moduleData = { programme: [{ id: 'current:A', title: 'Module A', percent: 0 }] };
    api.overview.mockImplementation((_employer, _kind, id) => id === '11'
      ? new Promise(resolve => { resolveAlex = resolve; }) : Promise.reject(new Error('Unavailable')));
    showPage();
    const selector = await screen.findByRole('combobox', { name: 'Module' });
    expect(selector).toBeDisabled();
    expect(selector).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2));
    await act(async () => resolveAlex(moduleData));
    await userEvent.selectOptions(selector, 'current:A');
    let journeys = within(screen.getByRole('region', { name: 'Progress review journey' }));
    expect(journeys.getByRole('article', { name: 'Alex Learner reviews' })).toBeVisible();
    expect(journeys.queryByRole('article', { name: 'Morgan Learner reviews' })).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry module membership' });
    expect(retry.closest('[role="alert"]')).toHaveTextContent('Only learners confirmed in the selected module are shown');
    api.overview.mockImplementation((_employer, _kind, id) => id === '11'
      ? new Promise(resolve => { resolveAlex = resolve; }) : Promise.resolve(moduleData));
    await userEvent.click(retry);
    expect(selector).toHaveValue('current:A');
    expect(selector).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Loading module learners' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Progress review journey' })).not.toBeInTheDocument();
    await act(async () => resolveAlex(moduleData));
    journeys = within(await screen.findByRole('region', { name: 'Progress review journey' }));
    expect(journeys.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retry module membership' })).not.toBeInTheDocument();
  });

  it('shows module date ranges by identity and updates them with cohort filters', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => {
      const payload = dashboardOverviewFixture();
      payload.modules[0].start = id === '11' ? '2026-09-01' : '2026-10-01';
      payload.modules[0].end = id === '11' ? '2026-11-30' : '2026-12-31';
      // Historical and current modules can have the same title.
      payload.modules.push({ ...payload.modules[0], id: 'legacy:M1', start: '2025-01-10', end: '2025-03-20' });
      payload.programme.push({ id: 'legacy:M1', title: 'Module', percent: 0 });
      return payload;
    });
    showPage();
    const modules = within(await screen.findByRole('region', { name: 'Modules' }));
    await waitFor(() => expect(modules.getAllByText('2 of 2 learners have progress data')).toHaveLength(2));
    const cards = modules.getAllByRole('article', { name: 'Module' });
    const current = within(cards.find(card => card.textContent?.includes('1 Sept 2026'))!);
    const historical = within(cards.find(card => card.textContent?.includes('10 Jan 2025'))!);
    expect(current.getByText('31 Dec 2026')).toHaveAttribute('datetime', '2026-12-31');
    expect(historical.getByText('20 Mar 2025')).toHaveAttribute('datetime', '2025-03-20');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort A');
    expect(current.getByText('1 Sept 2026')).toBeVisible();
    expect(current.getByText('30 Nov 2026')).toBeVisible();
    expect(current.queryByText('31 Dec 2026')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(current.getByText('31 Dec 2026')).toBeVisible();
    expect(api.overview).toHaveBeenCalledTimes(2);
  });

  it('keeps missing module dates separate from learner and programme dates', async () => {
    portal.learners[0].learnerStartDate = '2020-01-01';
    portal.learners[0].learnerEndDate = '2029-01-01';
    api.overview.mockImplementation(async () => {
      const payload = dashboardOverviewFixture();
      payload.modules[0].start = '';
      payload.modules[0].end = '2026-02-30';
      payload.programme.push({ id: 'legacy:missing', title: 'Missing module dates', percent: null });
      return payload;
    });
    showPage();
    const modules = within(await screen.findByRole('region', { name: 'Modules' }));
    const current = within(await modules.findByRole('article', { name: 'Module' }));
    const missing = within(modules.getByRole('article', { name: 'Missing module dates' }));
    for (const card of [current, missing]) {
      expect(card.getByText('Start date')).toBeVisible();
      expect(card.getByText('End date')).toBeVisible();
      expect(card.getAllByText('Not recorded')).toHaveLength(2);
    }
  });

  it('uses the same adjusted module date bounds as the learner overview', async () => {
    api.overview.mockImplementation(async () => {
      const payload = dashboardOverviewFixture();
      Object.assign(payload.modules[0], {
        dateBounds: { startFixed: false, endFixed: true, first: '2026-09-10', last: '2026-10-10' },
        duplicates: [{ key: 'shared-activity', completed: false, date: '2026-09-05' }],
      });
      return payload;
    });
    showPage();
    const module = within(await screen.findByRole('article', { name: 'Module' }));
    expect(module.getByText('5 Sept 2026')).toHaveAttribute('datetime', '2026-09-05');
    expect(module.getByText('30 Nov 2026')).toHaveAttribute('datetime', '2026-11-30');
  });

  it('excludes unavailable module progress from the average and counts each learner once', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => ({ programme: [
      { id: 'current:100', title: 'Shared module', percent: id === '11' ? 0 : null },
      { id: 'current:100', title: 'Shared module', percent: 100 },
    ] }));
    showPage();
    const module = within(await screen.findByRole('article', { name: 'Shared module' }));
    expect(module.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(module.getByText('1 of 2 learners have progress data')).toBeVisible();
  });

  it('retains successful module records on a partial failure and retries the failed source', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => {
      if (id === '12') throw new Error('Synthetic failure');
      return { programme: [{ id: 'legacy:100', title: 'Historical module', percent: 75 }] };
    });
    showPage();
    const modules = within(await screen.findByRole('region', { name: 'Modules' }));
    expect(await modules.findByRole('alert')).toHaveTextContent('Counts and averages include available records only');
    expect(modules.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    api.overview.mockResolvedValue({ programme: [{ id: 'legacy:100', title: 'Historical module', percent: 25 }] });
    await userEvent.click(modules.getByRole('button', { name: 'Retry modules' }));
    await waitFor(() => expect(modules.queryByRole('alert')).not.toBeInTheDocument());
    expect(modules.getByText('2 of 2 learners have progress data')).toBeVisible();
    expect(modules.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('combines Progress and Cohort in My learners for both the chart and table, and clears them', async () => {
    portal.learners[1].isActive = true;
    metrics.learners['12'].risk = 'at-risk';
    showPage('/employers/8/learners');
    await screen.findByRole('link', { name: 'View Morgan Learner' });
    await waitFor(() => expect(table().getByText('At risk')).toBeVisible());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Progress' }), 'at-risk');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort B');
    expect(screen.getByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    const chart = within(screen.getByRole('region', { name: 'Learner progress overview' }));
    expect(chart.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 0, At risk: 1, Not available: 0');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort A');
    expect(screen.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Progress' })).toHaveValue('');
    expect(api.overview).toHaveBeenCalledTimes(2);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Progress' }), 'at-risk');
    await userEvent.click(screen.getByRole('link', { name: 'Back to overview' }));
    expect(await screen.findByRole('region', { name: 'Modules' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Learner progress overview' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Progress review journey' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Progress' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2));
  });

  it('shows recorded learner dates and assessment submissions without a module column', async () => {
    portal.learners[0].learnerStartDate = '2026-10-01';
    portal.learners[0].learnerEndDate = '2027-10-25';
    api.overview.mockImplementation(async (_employer, _kind, id) => {
      const payload = dashboardOverviewFixture();
      payload.modules[0].assignments = { submitted: id === '11' ? 1 : 0, total: 2 };
      payload.modules.push({ ...payload.modules[0], id: 'legacy:2', title: 'Historical module', assignments: { submitted: 1, total: 1 } });
      payload.programme.push({ id: 'legacy:2', title: 'Historical module', percent: null }, payload.programme[0]);
      return payload;
    });
    showPage('/employers/8/learners', { employerReturnTo: '/users?type=employer' });
    await screen.findByRole('progressbar', { name: 'Alex Learner assessment submission' });
    for (const name of ['Start date', 'End date', 'Assessment']) expect(table().getByRole('columnheader', { name })).toBeVisible();
    expect(table().queryByRole('columnheader', { name: 'Modules' })).not.toBeInTheDocument();
    const alex = within(table().getByRole('link', { name: 'View Alex Learner' }).closest('tr')!);
    const morgan = within(table().getByRole('link', { name: 'View Morgan Learner' }).closest('tr')!);
    expect(alex.getByText('1 October 2026')).toBeVisible();
    expect(alex.getByText('25 October 2027')).toBeVisible();
    // The plan's September/November dates are different and must not fill missing learner dates.
    expect(morgan.getAllByText('Not recorded')).toHaveLength(2);
    expect(morgan.queryByText('1 September 2026')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Module' })).toBeEnabled();
    expect(within(screen.getByRole('combobox', { name: 'Module' })).getAllByRole('option')).toHaveLength(3);
    expect(alex.getByRole('link', { name: '2 / 3 submitted' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=assignments');
    expect(alex.getByRole('progressbar', { name: 'Alex Learner assessment submission' })).toHaveAttribute('aria-valuenow', String(2 / 3 * 100));
    expect(morgan.getByRole('link', { name: '1 / 3 submitted' })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=assignments');
    expect(api.overview.mock.calls.map(call => call.slice(0, 3))).toEqual([['8', 'apprenticeship', '11'], ['8', 'commercial', '12']]);
    expect(api.overview.mock.calls.every(call => call[4] === true)).toBe(true);
  });

  it('filters learners and the progress chart by assigned module identity and combines filters', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => ({ programme: [
      { id: 'current:shared', title: 'Shared module', percent: 0 },
      { id: id === '11' ? 'current:individual' : 'legacy:individual', title: 'Individual module', percent: null },
    ] }));
    showPage('/employers/8/learners');
    const selector = await screen.findByRole('combobox', { name: 'Module' });
    await waitFor(() => expect(selector).toBeEnabled());
    await userEvent.selectOptions(selector, 'legacy:individual');
    expect(screen.getByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    const chart = within(screen.getByRole('region', { name: 'Learner progress overview' }));
    expect(chart.getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 0, At risk: 0, Not available: 1');
    expect(screen.queryByRole('region', { name: 'Progress review journey' })).not.toBeInTheDocument();
    await userEvent.selectOptions(selector, 'current:shared');
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort A');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Morgan Learner' })).not.toBeInTheDocument();
    await userEvent.selectOptions(selector, 'legacy:individual');
    expect(screen.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(selector).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(api.overview).toHaveBeenCalledTimes(2);
  });

  it('resets pagination when filtering by module and clears the module when leaving My learners', async () => {
    portal.learners = Array.from({ length: 10 }, (_, index) => ({ ...portal.learners[0], id: String(index + 100), name: `Learner ${index}` }));
    api.overview.mockImplementation(async (_employer, _kind, id) => ({ programme: [{ id: Number(id) < 108 ? 'current:A' : 'current:B', title: Number(id) < 108 ? 'Module A' : 'Module B', percent: null }] }));
    showPage('/employers/8/learners');
    const selector = await screen.findByRole('combobox', { name: 'Module' });
    await waitFor(() => expect(selector).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Next learner page' }));
    expect(screen.getByRole('navigation', { name: 'Learner pages' })).toHaveTextContent('Page 2 of 2');
    await userEvent.selectOptions(selector, 'current:A');
    expect(screen.getByRole('heading', { name: 'Your learners (8)' })).toBeVisible();
    expect(table().getByRole('link', { name: 'View Learner 0' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Learner 8' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Learner pages' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to overview' }));
    expect(await screen.findByRole('region', { name: 'Modules' })).toBeVisible();
    expect(within(screen.getByRole('form', { name: 'Filter learners' })).getByRole('combobox', { name: 'Module' })).toHaveValue('');
    expect(screen.getByRole('article', { name: 'Module B' })).toBeVisible();
  });

  it('waits for module choices and retains a retry when a module filter excludes failed learner reads', async () => {
    let resolveAlex!: (value: { programme: { id: string; title: string; percent: number }[] }) => void;
    api.overview.mockImplementation((_employer, _kind, id) => id === '11'
      ? new Promise(resolve => { resolveAlex = resolve; }) : Promise.reject(new Error('Unavailable')));
    showPage('/employers/8/learners');
    const selector = await screen.findByRole('combobox', { name: 'Module' });
    expect(selector).toBeDisabled();
    expect(selector).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2));
    await act(async () => resolveAlex({ programme: [{ id: 'current:A', title: 'Module A', percent: 0 }] }));
    await userEvent.selectOptions(selector, 'current:A');
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    expect(table().queryByRole('link', { name: 'View Morgan Learner' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry learning data' })).toBeVisible();
    api.overview.mockResolvedValue({ programme: [{ id: 'current:A', title: 'Module A', percent: 0 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Retry learning data' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry learning data' })).not.toBeInTheDocument());
    expect(selector).toHaveValue('current:A');
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
  });

  it('distinguishes zero submissions, no assessments and unavailable assessment facts', async () => {
    api.overview.mockImplementation(async (_employer, _kind, id) => {
      const payload = dashboardOverviewFixture();
      if (id === '11') payload.modules[0].assignments = { submitted: 0, total: 2 };
      return payload;
    });
    showPage('/employers/8/learners');
    await screen.findByRole('region', { name: 'Employer learners' });
    expect(await table().findByRole('progressbar', { name: 'Alex Learner assessment submission' })).toHaveAttribute('aria-valuenow', '0');
    const morgan = within(table().getByRole('link', { name: 'View Morgan Learner' }).closest('tr')!);
    await waitFor(() => expect(morgan.getAllByRole('cell')[5]).toHaveTextContent('Not available'));
    expect(morgan.queryByRole('progressbar', { name: 'Morgan Learner assessment submission' })).not.toBeInTheDocument();
    cleanup();
    api.overview.mockImplementation(async () => {
      const payload = dashboardOverviewFixture();
      payload.modules[0].assignments = { submitted: 0, total: 0 };
      return payload;
    });
    showPage('/employers/8/learners');
    await waitFor(() => expect(table().getAllByText('No assessments assigned')).toHaveLength(2));
    expect(table().queryByRole('progressbar', { name: /assessment submission/ })).not.toBeInTheDocument();
  });

  it('keeps learner dates and available learning facts while another learner fails, with a retry', async () => {
    portal.learners[1].learnerEndDate = '2027-10-25';
    let resolveAlex!: (value: ReturnType<typeof dashboardOverviewFixture>) => void;
    api.overview.mockImplementation((_employer, _kind, id) => id === '11'
      ? new Promise(resolve => { resolveAlex = resolve; }) : Promise.reject(new Error('Unavailable')));
    showPage('/employers/8/learners');
    expect(await screen.findByRole('status', { name: 'Loading Alex Learner assessments' })).toBeVisible();
    const panel = within(screen.getByRole('region', { name: 'Your learners (2)' }));
    expect(await panel.findByRole('alert')).toHaveTextContent('Some module and assessment records could not be loaded');
    expect(table().getByText('25 October 2027')).toBeVisible();
    const payload = dashboardOverviewFixture();
    payload.modules[0].assignments = { submitted: 1, total: 2 };
    await act(async () => resolveAlex(payload));
    expect(table().getByRole('link', { name: '1 / 2 submitted' })).toBeVisible();
    api.overview.mockResolvedValue(payload);
    await userEvent.click(panel.getByRole('button', { name: 'Retry learning data' }));
    await waitFor(() => expect(panel.queryByRole('alert')).not.toBeInTheDocument());
    expect(table().getAllByRole('link', { name: '1 / 2 submitted' })).toHaveLength(2);
  });

  it('shows the monthly review count without waiting for full review details', async () => {
    api.reviews.mockImplementation(() => new Promise(() => undefined));
    api.reviewSummary.mockResolvedValue({ events: [makeReview('due-this-month')] });

    showPage();

    expect(await screen.findByRole('button', { name: /Reviews due this month: 2/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Progress review journey' })).toBeVisible();
    cleanup();
    showPage('/employers/8/reviews');
    await screen.findByRole('region', { name: 'Progress review journey' });
    expect(screen.getAllByRole('status', { name: 'Loading progress reviews…' })).toHaveLength(2);
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

  it('uses APTEM marker-only current steps independently per learner on Reviews', async () => {
    const dates = ['2026-10-26', '2027-03-30', '2027-06-29', '2027-09-29'];
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: dates.map((date, index) =>
      makeReview(`shared-review-${index + 1}`, { title: `Review ${index + 1}`, reviewSource: 'aptem',
        sequence: index + 1, status: index < (id === '12' ? 2 : 1) ? 'completed' : 'not-scheduled',
        targetDate: date, date, scheduledDate: null })), definitions: {} }));
    showPage('/employers/8/reviews');
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

  it('keeps Native current-step styling and completed APTEM history unselected on Reviews', async () => {
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [makeReview('same-key', {
      reviewSource: id === '11' ? 'curriculum' : 'aptem', status: id === '11' ? 'scheduled' : 'completed',
    })], definitions: {} }));
    showPage('/employers/8/reviews');
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

  it('shows a compact employer identity without the banner description and links both learner kinds correctly', async () => {
    const { container } = showPage();
    expect(await screen.findByRole('heading', { name: 'Test employer' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/assets/employer/graduation-group.webp"]')).not.toBeInTheDocument();
    expect(screen.getByText('Test org')).toBeVisible();
    expect(screen.queryByText(/You have .*learner.*on programme/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Supporting your learners/)).not.toBeInTheDocument();
    cleanup();
    showPage('/employers/8/learners');
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByRole('progressbar', { name: 'Morgan Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '17.5');
    expect(table().getByRole('columnheader', { name: 'OTJ Progress' })).toBeVisible();
    expect(table().getByRole('columnheader', { name: 'Attendance' })).toBeVisible();
    expect(table().queryByRole('columnheader', { name: 'Engagement' })).not.toBeInTheDocument();
    expect(table().getByText('90 / 200 OTJ hours')).toBeVisible();
    expect(table().getByText('70 / 400 OTJ hours')).toBeVisible();
    expect(table().queryByText(/activities/)).not.toBeInTheDocument();
    expect(await table().findByRole('progressbar', { name: 'Alex Learner attendance' })).toHaveAttribute('aria-valuenow', '80');
    expect(table().getByRole('progressbar', { name: 'Morgan Learner attendance' })).toHaveAttribute('aria-valuenow', '67');
    expect(table().getByText('8 / 10 sessions')).toBeVisible();
    expect(table().getByText('2 / 3 sessions')).toBeVisible();
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11');
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12');
    expect(api.metrics.mock.calls.some(call => call[2] === 'summary')).toBe(false);
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'programme');
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

  it('shows recorded completions against the current Training Plan session target', async () => {
    api.attendance.mockResolvedValue({ attendance: {
      mode: 'recorded', present: 5, sessions: 20, absent: 15, late: 0, attendanceRate: 25,
      livePresent: 0, recordedPresent: 5, recordedTotal: 8,
    } });
    showPage('/employers/8/learners');
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Alex Learner attendance' }))
      .toHaveAttribute('aria-valuenow', '25'));
    expect(table().getAllByText('5 / 20 sessions')).toHaveLength(2);
    expect(table().getAllByText('Recorded', { exact: true })).toHaveLength(2);
    expect(table().queryByText('Live Session', { exact: true })).not.toBeInTheDocument();
    expect(table().getAllByTitle('Completed recordings / planned Live Sessions in the current Training Plan')).toHaveLength(2);
    expect(table().queryByText('5 / 8 recordings')).not.toBeInTheDocument();
  });

  it('shows mixed attendance once per session with the Live and Recorded contributions', async () => {
    api.attendance.mockImplementation(async (_employer, _kind, id) => ({ attendance: id === '11' ? {
      mode: 'mixed', present: 8, sessions: 10, absent: 2, late: 0, attendanceRate: 80,
      livePresent: 6, recordedPresent: 2, recordedTotal: 10,
    } : metrics.learners[id].attendance }));
    showPage('/employers/8/learners');
    expect(await screen.findByText('6 Live + 2 Recorded')).toBeVisible();
    expect(table().getByText('Live + Recorded', { exact: true })).toBeVisible();
    expect(table().getByText('Live Session', { exact: true })).toBeVisible();
    expect(table().getByText('8 / 10 sessions')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Alex Learner attendance' })).toHaveAttribute('aria-valuenow', '80');
    expect(table().getByText('2 / 3 sessions')).toBeVisible();
  });

  it('positions each learner target against total planned hours independently of actual progress', async () => {
    portal.learners[0].otjhProgress = { actual: 90, planned: 200, percent: 45, targetToDate: 120 };
    portal.learners[1].otjhProgress = { actual: 70, planned: 400, percent: 17.5, targetToDate: 100 };
    showPage('/employers/8/learners');

    const alex = await screen.findByRole('img', { name: 'Alex Learner OTJ target today: 120 hours (60%)' });
    expect(alex).toHaveStyle({ left: '60%' });
    expect(screen.getByRole('img', { name: 'Morgan Learner OTJ target today: 100 hours (25%)' })).toHaveStyle({ left: '25%' });
    expect(screen.getByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    expect(table().getByText('90 / 200 OTJ hours')).toBeVisible();
    alex.focus();
    expect(alex).toHaveFocus();
  });

  it('shows OTJ values on bar hover and keyboard focus and dismisses with Escape', async () => {
    portal.learners[0].otjhProgress = { actual: 90, planned: 200, percent: 45, targetToDate: 120 };
    showPage('/employers/8/learners');
    const bar = await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    const marker = screen.getByRole('img', { name: /Alex Learner OTJ target today:/ });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(bar);
    const tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByText('90 h (45%)')).toBeVisible();
    expect(within(tooltip).getByText('120 h (60%)')).toBeVisible();
    expect(within(tooltip).getByText('200 h')).toBeVisible();
    expect(marker).toHaveAttribute('aria-describedby', tooltip.id);
    await userEvent.unhover(bar);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    fireEvent.focus(marker);
    expect(screen.getByRole('tooltip')).toBeVisible();
    fireEvent.keyDown(marker, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(marker).not.toHaveAttribute('aria-describedby');
  });

  it.each([
    { planned: 200, targetToDate: 0, position: '0%' },
    { planned: 200, targetToDate: 200, position: '100%' },
    { planned: 200, targetToDate: 300, position: '100%' },
    { planned: 200, targetToDate: null, position: null },
    { planned: 200, targetToDate: undefined, position: null },
    { planned: 200, targetToDate: -1, position: null },
    { planned: 200, targetToDate: Number.NaN, position: null },
    { planned: 0, targetToDate: 100, position: null },
    { planned: null, targetToDate: 100, position: null },
  ])('handles target boundaries and unavailable data ($planned / $targetToDate)', async ({ planned, targetToDate, position }) => {
    portal.learners[0].otjhProgress = { actual: 90, planned, percent: 45, targetToDate };
    showPage('/employers/8/learners');
    await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    const target = screen.queryByRole('img', { name: /Alex Learner OTJ target today:/ });
    if (position) expect(target).toHaveStyle({ left: position });
    else expect(target).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Morgan Learner OTJ target today:/ })).not.toBeInTheDocument();
  });

  it('combines search, programme, cohort and status filters and clears them', async () => {
    showPage('/employers/8/learners');
    await screen.findByRole('heading', { name: 'Your learners (2)' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search learners' }), 'morgan');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Programme' }), 'Marketing');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cohort' }), 'Cohort B');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'inactive');
    expect(table().queryByRole('link', { name: 'View Alex Learner' })).not.toBeInTheDocument();
    expect(table().getByRole('link', { name: 'View Morgan Learner' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search learners' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Programme' })).toHaveValue('');
  });

  it('shows precise OTJ hours in My learners after removing the programme chart from Overview', async () => {
    metrics.learners['11'].programme = { completed: 1, total: 900, percent: 0.11, status: 'ready' };
    portal.learners[0].otjhProgress = { actual: 0.55, planned: 500, percent: 0.11 };
    showPage('/employers/8/learners');
    const progress = await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '0.11');
    expect(table().getByText('0.11%')).toBeVisible();
    expect(table().getByText('0.55 / 500 OTJ hours')).toBeVisible();
    expect(table().getByText('17.5%')).toBeVisible();
    cleanup();
    showPage();
    await screen.findByRole('region', { name: 'Modules' });
    expect(screen.queryByRole('region', { name: 'Progress by programme' })).not.toBeInTheDocument();
    expect(screen.queryByText('Average programme completion')).not.toBeInTheDocument();
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
    expect(cells[6]).toHaveTextContent('45%');
    expect(within(cells[7]).getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    expect(cells[7].textContent).toBe('');
    expect(table().getByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    expect(api.metrics.mock.calls.some(call => call[2] === 'summary')).toBe(false);
  });

  it('loads risk and programme separately on Overview, and attendance independently in My learners', async () => {
    showPage();
    expect(await screen.findByRole('region', { name: 'Modules' })).toBeVisible();
    await waitFor(() => expect(api.metrics).toHaveBeenCalledTimes(2));
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'status');
    expect(api.metrics).toHaveBeenCalledWith('8', expect.any(AbortSignal), 'programme');
    cleanup();
    showPage('/employers/8/learners');
    expect(await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Morgan Learner attendance' })).toHaveAttribute('aria-valuenow', '67'));
  });

  it('keeps My learners independent of the programme progress calculation', async () => {
    api.metrics.mockImplementation((_employer, _signal, section) => section === 'programme'
      ? new Promise(() => undefined) : Promise.resolve(structuredClone(metrics)));
    showPage('/employers/8/learners');
    expect(await screen.findByRole('progressbar', { name: 'Alex Learner OTJ progress' })).toHaveAttribute('aria-valuenow', '45');
    expect(api.metrics.mock.calls.some(call => call[2] === 'programme')).toBe(false);
  });

  it('shows Needs attention as soon as the saved status returns, without waiting for progress', async () => {
    metrics.learners['11'].risk = 'at-risk';
    api.metrics.mockImplementation((_employer, _signal, section) => section === 'status'
      ? Promise.resolve(structuredClone(metrics)) : new Promise(() => undefined));
    showPage();
    expect(await screen.findByRole('button', { name: /Needs attention: 1/ })).toBeVisible();
    expect(screen.queryByText('Saved learner OTJ status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Needs attention: 1\. Saved learner OTJ status/ })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Progress by programme' })).not.toBeInTheDocument();
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
      makeReview(`planned-${id}`, { title: 'Unbooked review', scheduledDate: null, targetDate: '2020-01-01', status: 'not-scheduled' }),
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

  it('counts Progress and Gateway reviews this month while excluding unrelated support plans', async () => {
    showPage();
    const due = await screen.findByRole('button', { name: /Reviews due this month: 3\. Open progress reviews/ });
    expect(screen.queryByText('Personal Support Plan')).not.toBeInTheDocument();
    await userEvent.click(due);
    const panel = within(await screen.findByRole('dialog', { name: 'Reviews due this month' }));
    const listed = panel.getAllByRole('listitem');
    expect(listed).toHaveLength(3);
    expect(listed[0]).toHaveTextContent('Alex Learner');
    expect(listed[1]).toHaveTextContent('Alex Learner');
    expect(listed[2]).toHaveTextContent('Morgan Learner');
    expect(panel.getAllByRole('link', { name: 'View review' }).map(link => link.getAttribute('href'))).toEqual([
      '/employers/8/learner/apprenticeship/11?tab=reviews&reviewId=pr-11',
      '/employers/8/learner/apprenticeship/11?tab=reviews&reviewId=gateway-11',
      '/employers/8/learner/commercial/12?tab=reviews&reviewId=gateway-12',
    ]);
    expect(panel.queryByRole('link', { name: /^Join / })).not.toBeInTheDocument();
    expect(panel.getAllByText('Meeting link not available yet.')).toHaveLength(3);
    // The card reads in place now; it must not leave the overview.
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/employers\/8$/);
  });

  it('gives My learners and Progress reviews their own content instead of repeating home', async () => {
    showPage('/employers/8/learners');
    expect(await screen.findByRole('heading', { level: 1, name: 'My learners' })).toBeVisible();
    expect(table().getByRole('link', { name: 'View Alex Learner' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Learner progress overview' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Modules' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('region', { name: 'Progress review journey' })).not.toBeInTheDocument();
    await screen.findByRole('link', { name: 'View Alex Learner' });
    await waitFor(() => expect(table().getAllByRole('link', { name: '1 Nov 2026' })).toHaveLength(2));
  });

  it('orders the Reviews journey by the source plan after appointments move', async () => {
    const planned = ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'];
    const booked = ['2026-12-10', '2026-09-10', '2026-10-20', '2026-11-20', '2026-08-01'];
    api.reviews.mockImplementation(async (_employer, _kind, id) => ({ events: [1, 4, 3, 0, 2].map(index =>
      makeReview(`${id}-${index}`, { title: `Review ${index + 1}`, reviewSource: 'aptem',
        targetDate: planned[index], scheduledDate: booked[index], date: booked[index], sequence: index + 1,
        status: index === 0 ? 'awaiting-signature' : index === 1 ? 'completed' : 'scheduled' })), definitions: {} }));
    showPage('/employers/8/reviews');
    await screen.findByRole('link', { name: /Alex Learner: Review 1,/ });
    const journey = within(screen.getByRole('region', { name: 'Progress review journey' }));
    for (const name of ['Alex Learner', 'Morgan Learner']) {
      const links = journey.getAllByRole('link', { name: new RegExp(`^${name}: Review`) });
      expect(links.map(link => link.getAttribute('aria-label')?.split(',')[0].replace(`${name}: `, ''))).toEqual(
        ['Review 1', 'Review 2', 'Review 3', 'Review 4', 'Review 5']);
      expect(links[0]).toHaveAccessibleName(`${name}: Review 1, Waiting for signatures, 10 Dec 2026`);
      expect(links[1]).toHaveAccessibleName(`${name}: Review 2, Completed, 10 Sept 2026`);
    }
    // The appointment due first is still the next review, irrespective of plan order.
    cleanup();
    showPage('/employers/8/learners');
    await screen.findByRole('link', { name: 'View Alex Learner' });
    await waitFor(() => expect(table().getAllByRole('link', { name: '1 Aug 2026' })).toHaveLength(2));
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

  it.each(['/employers/8', '/employers/8/reviews'])('keeps review loading and failure distinct from an empty timeline and retries failed reads on %s', async path => {
    api.reviews.mockRejectedValueOnce(new Error('temporary'));
    showPage(path);
    const alex = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(await alex.findByRole('alert')).toHaveTextContent('Reviews could not be loaded for this learner.');
    expect(alex.queryByText('No progress reviews planned yet.')).not.toBeInTheDocument();
    await userEvent.click(alex.getByRole('button', { name: 'Retry reviews' }));
    expect(await alex.findByRole('list')).toBeVisible();
    expect(alex.queryByRole('alert')).not.toBeInTheDocument();

    cleanup();
    api.reviews.mockImplementation(() => new Promise(() => undefined));
    showPage(path);
    const loading = within(await screen.findByRole('article', { name: 'Alex Learner reviews' }));
    expect(loading.getByRole('status')).toHaveAccessibleName(expect.stringContaining('Loading progress reviews'));
    expect(loading.queryByText('No progress reviews planned yet.')).not.toBeInTheDocument();
  });

  it('keeps progress-review links on the Reviews page', async () => {
    showPage('/employers/8/reviews');
    const journey = await screen.findByRole('region', { name: 'Progress review journey' });
    expect(within(journey).getByRole('link', { name: 'Alex Learner' })).toHaveAttribute('href', '/employers/8/learner/apprenticeship/11?tab=reviews');
    expect(screen.queryByRole('region', { name: 'Action required' })).not.toBeInTheDocument();
    expect(screen.queryByText('No signatures needed for these learners.')).not.toBeInTheDocument();
  });

  // The join link follows the meetings panel's rule: the employer is only sent
  // to a meeting Microsoft has confirmed. A local booking is not that proof.
  it('offers the review join link only once the invitation is confirmed', async () => {
    api.reviews.mockImplementation(async (_employer: unknown, _kind: unknown, id: unknown) => ({
      events: [makeReview(`pr-${id}`, { meetingLink: 'https://teams.example.test/meet/1', invited: true, syncState: 'synced' })],
      definitions: {},
    }));
    showPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Reviews due this month: 2\./ }));
    const join = within(await screen.findByRole('dialog', { name: 'Reviews due this month' }))
      .getAllByRole('link', { name: /^Join / });
    expect(join).toHaveLength(2);
    expect(join[0]).toHaveAttribute('href', 'https://teams.example.test/meet/1');
    expect(join[0]).toHaveAttribute('target', '_blank');
    expect(join[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('withholds the join link while the Teams invitation is unconfirmed', async () => {
    api.reviews.mockImplementation(async (_employer: unknown, _kind: unknown, id: unknown) => ({
      events: [makeReview(`pr-${id}`, { meetingLink: 'https://teams.example.test/meet/1', invited: false })],
      definitions: {},
    }));
    showPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Reviews due this month: 2\./ }));
    const panel = within(await screen.findByRole('dialog', { name: 'Reviews due this month' }));
    expect(panel.queryByRole('link', { name: /^Join / })).not.toBeInTheDocument();
    expect(panel.getAllByText('Invitation not confirmed. Contact your coach.')).toHaveLength(2);
    expect(panel.getAllByRole('link', { name: 'View review' })).toHaveLength(2);
  });

  // Every summary card opens its own records in place. Read-only: no links out,
  // and the overview stays put instead of navigating to a filtered section.
  it('opens the records behind each summary card in a dialog', async () => {
    portal.learners[1].isActive = true;
    metrics.learners['11'].risk = 'need-attention';
    metrics.learners['12'].risk = 'at-risk';
    const cards: [RegExp, string, string[]][] = [
      [/^Total learners: 2\./, 'Total learners', ['Alex Learner', 'Morgan Learner']],
      [/^Active on programme: 2\./, 'Active on programme', ['Alex Learner', 'Morgan Learner']],
      [/^Reviews due this month: 3\./, 'Reviews due this month', ['Alex Learner', 'Alex Learner', 'Morgan Learner']],
      [/^Needs attention: 2\./, 'Needs attention', ['Alex Learner', 'Morgan Learner']],
    ];
    showPage();
    for (const [name, title, expected] of cards) {
      await userEvent.click(await screen.findByRole('button', { name }));
      const panel = within(await screen.findByRole('dialog', { name: title }));
      const listed = panel.getAllByRole('listitem');
      expect(listed).toHaveLength(expected.length);
      expected.forEach((learner, index) => expect(listed[index]).toHaveTextContent(learner));
      // Only a review row has actions of its own; the learner lists stay read-only.
      if (title === 'Reviews due this month') expect(panel.getAllByRole('link', { name: 'View review' })).toHaveLength(3);
      else expect(panel.queryByRole('link')).not.toBeInTheDocument();
      await userEvent.click(panel.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/employers\/8$/);
  });

  it('uses the same OTJ statuses for the overview, table, filters and Needs attention', async () => {
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
    await waitFor(() => expect(table().getByText('At risk')).toBeVisible());
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

  });

  it('shows missing metrics as unavailable instead of zero or healthy progress', async () => {
    metrics.learners = {};
    portal.learners.forEach(learner => { learner.otjhProgress = null; });
    showPage();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Learner summary' })).toHaveTextContent('Needs attentionUnavailable'));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Learning performance' })).queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    // The engagement panel was removed from the dashboard; it recorded nothing.
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
    showPage();
    for (const name of ['Modules', 'Progress review journey']) {
      const section = within(await screen.findByRole('region', { name }));
      expect(section.getByRole('heading', { name: 'No learners linked yet' })).toBeVisible();
    }
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
