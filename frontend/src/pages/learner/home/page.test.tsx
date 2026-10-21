import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Suspense } from 'react';
import { Link, MemoryRouter, useLocation, useParams, useRoutes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudentHome from './page';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { studentWorkspaceRoutes } from '@/router/studentWorkspaceRoutes';
import { homeSummary, upcomingSchedule, type OverviewWeek, type UpcomingEvent } from '@/api/learnerOverview';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { rememberSignedInLearner } from '@/hooks/useMyLearner';
import { resetFirstLoginDetailsRedirect } from '@/hooks/useFirstLoginDetailsRedirect';

const state = vi.hoisted(() => ({ profileError: '', name: 'Alex Morgan', role: 'learner', learnerType: 'apprenticeship', firstLoginRequired: false, programmeStatus: 'Active', events: [] as UpcomingEvent[], scheduleError: '', refresh: vi.fn(), modules: [] as OverviewWeek['modules'] }));
// Keep the real support widget; its decorative animation needs canvas outside jsdom.
vi.mock('lottie-react', () => ({ Lottie: () => null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: 3, subjectId: 71, learnerType: state.learnerType, role: state.role, displayName: state.name } }, logout: vi.fn(), retryInitialization: vi.fn() }) }));
vi.mock('@/api/firstLoginDetails', () => ({ fetchFirstLoginDetails: vi.fn(async () => ({ required: state.firstLoginRequired })) }));
vi.mock('@/hooks/useLearnerSummaryParam', () => ({ useLearnerSummaryParam: vi.fn(() => ({ real: { id: 71, name: state.name, programmeStatus: state.programmeStatus }, loadError: state.profileError, loading: false, refresh: state.refresh })) }));
vi.mock('@/hooks/useLiveLearnerRead', () => ({ useLiveLearnerRead: vi.fn((_kind, _id, _enabled, read) => ({ data: { weekStart: '2026-09-07', weekEnd: '2026-09-13', modules: state.modules,
  events: state.events, homeProgress: {
  period: { start: '2026-01-01', end: '2026-09-13' },
  otjh: { actual: 42, submitted: 10, planned: 100, percent: 42, missingPlannedActivities: 0 },
  activities: { completed: 21, total: 50 }, assignments: { completed: 3, total: 6 },
  lectures: { completed: 8, total: 10 }, modules: { completed: 1, total: 5 }, undatedActivities: 0,
} }, loading: false, error: read === homeSummary.read ? '' : state.scheduleError, refresh: vi.fn() })) }));
vi.mock('@/pages/workspace/learner/page', () => ({ default: function MockDashboard() {
  const { kind, id } = useParams();
  return <><aside aria-label="Learner sidebar"><Link to={kind && id ? `/workspace/learner/${kind}/${id}` : '/workspace/learner'}>Return home</Link></aside><h1>Dashboard console</h1></>;
} }));
function Location() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}</output>; }
function page() { return render(<MemoryRouter initialEntries={['/learner/home?kind=commercial&id=999']}><StudentHome/><Location/></MemoryRouter>); }
function WorkspaceRoutes() { return useRoutes(studentWorkspaceRoutes); }
function workspace(path: string) { return render(<MemoryRouter initialEntries={[path]}><Suspense fallback={<p>Loading</p>}><WorkspaceRoutes/></Suspense><Location/></MemoryRouter>); }
beforeEach(() => { resetFirstLoginDetailsRedirect(); state.learnerType = 'apprenticeship'; state.firstLoginRequired = false; state.profileError = ''; state.role = 'learner'; state.programmeStatus = 'Active'; state.events = []; state.scheduleError = ''; state.modules = []; rememberSignedInLearner(undefined, undefined); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); });
describe('connected student home', () => {
  it('uses only the authenticated identity, with real progress and empty events', () => {
    localStorage.setItem('my_learner', JSON.stringify({ kind: 'commercial', id: 999 }));
    page();
    expect(useLearnerSummaryParam).toHaveBeenCalledWith('apprenticeship', '71');
    expect(useLiveLearnerRead).toHaveBeenCalledWith('apprenticeship', '71', true, homeSummary.read, homeSummary.peek);
    expect(useLiveLearnerRead).toHaveBeenCalledWith('apprenticeship', '71', true, upcomingSchedule.read, upcomingSchedule.peek);
    expect(screen.getByRole('heading', { name: 'Alex' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('link', { name: /8 of 10 Lectures attended/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /21 of 50 Activities completed/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /21 of 50 Activities completed/ })).toHaveAttribute('href', '/learner/my-learning');
    const upcoming = within(screen.getByRole('complementary', { name: 'Upcoming' }));
    expect(upcoming.queryAllByRole('listitem')).toHaveLength(0);
    expect(upcoming.getByText('No sessions, assignments or reviews next week.')).toBeInTheDocument();
    expect(upcoming.getByRole('link', { name: 'View all upcoming events' })).toHaveAttribute('href', '/learner/calendar');
    expect(screen.queryByText(/Jamie|68%|Marketing Principles/)).not.toBeInTheDocument();
    localStorage.removeItem('my_learner');
  });
  it('renders every next-week event the server returned in its chronological order, with working destinations', () => {
    // Wednesday 14 October 2026; next week is Monday 19 to Friday 23 October.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));
    state.events = [
      { id: 'native:a', type: 'assignment', title: 'My assignment', date: '2026-10-19' },
      { id: 's1', type: 'session', title: 'First lecture', date: '2026-10-20T08:00:00+00:00' },
      { id: 'r', type: 'review', title: 'My progress review', date: '2026-10-21T10:00:00+01:00', booked: true },
      { id: 's2', type: 'session', title: 'Second lecture', date: '2026-10-22T08:00:00+00:00' },
      { id: 's3', type: 'session', title: 'Friday lecture', date: '2026-10-23T13:00:00+00:00' },
    ];
    page();
    const upcoming = within(screen.getByRole('complementary', { name: 'Upcoming' }));
    const rows = upcoming.getAllByRole('listitem');
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(
      ['Upcoming assignment', 'Upcoming lecture', 'Upcoming review', 'Upcoming lecture', 'Upcoming lecture']);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/learner/monthly-submission');
    expect(within(rows[0]).getByRole('link')).toHaveTextContent('Assignment due');
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/learner/attendance');
    expect(within(rows[1]).getByRole('link')).toHaveTextContent('Learning session');
    expect(within(rows[2]).getByRole('link')).toHaveTextContent('My progress reviewProgress review');
    expect(within(rows[2]).getByRole('link')).toHaveAttribute('href', '/learner/calendar');
    expect(within(rows[1]).getByText('20 Oct')).toBeInTheDocument();
    expect(within(rows[4]).getByText('Fri')).toBeInTheDocument();
    expect(within(rows[4]).getByRole('link')).toHaveTextContent('Friday lecture');
    expect(upcoming.getByRole('link', { name: 'View all upcoming events' })).toHaveAttribute('href', '/learner/calendar');
    fireEvent.click(within(rows[2]).getByRole('link'));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/calendar');
  });
  it.each([1, 2])('shows only the %i events the server returned, without placeholder rows', count => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));
    state.events = [
      { id: 'r', type: 'review', title: 'Review to book', date: '2026-10-19', booked: false },
      { id: 's1', type: 'session', title: 'First lecture', date: '2026-10-20T09:00:00+00:00' },
    ].slice(0, count) as UpcomingEvent[];
    page();
    const upcoming = within(screen.getByRole('complementary', { name: 'Upcoming' }));
    expect(upcoming.getAllByRole('listitem')).toHaveLength(count);
    expect(upcoming.getByText('Review to be booked')).toBeInTheDocument();
    expect(upcoming.queryByText('No sessions, assignments or reviews next week.')).not.toBeInTheDocument();
  });
  it('reports a failed upcoming read with a retry instead of an empty card', () => {
    state.scheduleError = 'Unavailable';
    page();
    const upcoming = within(screen.getByRole('complementary', { name: 'Upcoming' }));
    expect(upcoming.getByRole('alert')).toHaveTextContent('Some upcoming activity could not be loaded.');
    expect(upcoming.queryByText('No sessions, assignments or reviews next week.')).not.toBeInTheDocument();
    expect(upcoming.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it.each([
    // A learner's own links stay id-free; their pages resolve them from the
    // session, so the address bar never shows their type or id.
    ['Monthly Submission', '/learner/monthly-submission'],
    ['Dashboard', '/workspace/learner/dashboard'], ['Attend or Report Absence', '/learner/attendance'],
    ['Book for Monthly Coaching Session', '/learner/monthly-coaching'],
  ])('connects %s to its existing LMS route', (label, href) => {
    page();
    const link = screen.getByRole('link', { name: new RegExp(`^${label}`) });
    expect(link).toHaveAttribute('href', href);
    fireEvent.click(link);
    expect(screen.getByTestId('destination')).toHaveTextContent(href);
  });
  it('shows the portal header while keeping the learning navigation in the shield', () => {
    page();
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: 'Kent Business College learner home' })).toBeVisible();
    expect(header.getByText('Learner Portal')).toBeVisible();
    expect(header.getByRole('button', { name: 'Help & Support' })).toBeVisible();
    expect(header.getByRole('button', { name: 'Alex Morgan, account menu' })).toBeVisible();
    expect(header.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/workspace/learner/dashboard');
  });
  it('continues the signed-in learner’s current module, ignoring an identity supplied in the URL', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
    state.modules = [{ id: 'current:M1', title: 'Leadership', weekLabels: ['Week 2'], completed: 0, total: 3,
      percent: 0, ksbCodes: [], ksbMappingMissing: false }];
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Continue Learning' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/my-learning?subject=current%3AM1&week=2026-09-07');
  });
  it('shows a retry state if the personal profile fails', () => {
    state.profileError = 'Could not load the current learner'; page();
    expect(screen.queryByRole('heading', { name: 'Alex' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i })); expect(state.refresh).toHaveBeenCalled();
  });

  it.each(['/workspace/learner', '/learner/home'])('renders the landing page at %s and opens the console only through Dashboard', async path => {
    workspace(path);
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
    expect(screen.queryByRole('complementary', { name: 'Learner sidebar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all progress' })).toHaveAttribute('href', '/workspace/learner/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard console' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Learner sidebar' })).toBeVisible();
    expect(screen.getByTestId('destination')).toHaveTextContent('/workspace/learner/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'Return home' }));
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
  });

  // Student Home opens once an apprentice's programme has started. Before
  // that, each enrolment stage has its own page (requested 2026-09-27; this
  // replaces the earlier "landing page at every stage" rule for apprentices).
  it.each([
    ['Fresh user', '/workspace/learner/dashboard'],
    ['Onboarding', '/learner/onboarding'],
    ['Delivery', '/workspace/learner/dashboard'],
    ['Ready to enrol', '/workspace/learner/dashboard'],
  ])('sends an apprentice at programme status %s to %s instead of the landing page', async (status, destination) => {
    state.programmeStatus = status;
    workspace('/workspace/learner');
    await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent(new RegExp(`^${destination}$`)));
    expect(screen.queryByRole('heading', { name: 'Alex' })).not.toBeInTheDocument();
  });

  it('sends a new apprentice to the first-sign-in screens first', async () => {
    state.programmeStatus = 'Fresh user';
    state.firstLoginRequired = true;
    workspace('/workspace/learner');
    await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent(/^\/learner\/welcome$/));
  });

  it.each(['Fresh user', 'Onboarding', 'Delivery'])('keeps the landing page as a commercial learner’s entry at programme status %s', async status => {
    state.learnerType = 'commercial';
    state.programmeStatus = status;
    workspace('/workspace/learner');
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
    expect(screen.getByTestId('destination')).toHaveTextContent(/^\/workspace\/learner$/);
  });

  it.each(['admin', 'staff'])('starts a selected %s learner preview at the landing page and keeps its identity in Dashboard', async role => {
    state.role = role;
    workspace('/workspace/learner/commercial/502');
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
    expect(useLearnerSummaryParam).toHaveBeenCalledWith('commercial', '502');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/workspace/learner/dashboard/commercial/502');
    expect(screen.getByRole('link', { name: 'View all progress' })).toHaveAttribute('href', '/workspace/learner/dashboard/commercial/502');
    // A staff preview keeps the learner in every link, so the sidebar routes to them.
    expect(screen.getByRole('link', { name: /^Attend or Report Absence/ })).toHaveAttribute('href', '/learner/attendance/commercial/502');
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard console' })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Return home' }));
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
    expect(screen.getByTestId('destination')).toHaveTextContent('/workspace/learner/commercial/502');
  });

  it('uses the same selected learner for a bare staff workspace entry', async () => {
    state.role = 'admin';
    localStorage.setItem('my_learner', JSON.stringify({ kind: 'apprenticeship', id: '502' }));
    workspace('/workspace/learner');
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
    expect(useLearnerSummaryParam).toHaveBeenCalledWith('apprenticeship', '502');
  });
});
