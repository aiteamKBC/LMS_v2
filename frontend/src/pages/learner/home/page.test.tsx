import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Suspense } from 'react';
import { Link, MemoryRouter, useLocation, useParams, useRoutes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudentHome from './page';
import { useLearnerSummaryParam } from '@/hooks/useLearnerSummaryParam';
import { studentWorkspaceRoutes } from '@/router/studentWorkspaceRoutes';
import { overviewHome, type OverviewWeek } from '@/api/learnerOverview';
import { useLiveLearnerRead } from '@/hooks/useLiveLearnerRead';
import { rememberSignedInLearner } from '@/hooks/useMyLearner';
import { ThemeProvider } from '@/hooks/useTheme';

const state = vi.hoisted(() => ({ profileError: '', name: 'Alex Morgan', role: 'learner', programmeStatus: 'Active', upcoming: false, scheduleError: '', refresh: vi.fn(), modules: [] as OverviewWeek['modules'] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: 3, subjectId: 71, learnerType: 'apprenticeship', role: state.role, displayName: state.name }, user: { fullName: state.name, email: 'alex@example.com' }, roles: [] }, isAdmin: state.role === 'admin', canSeeNavItem: () => true, logout: vi.fn(), retryInitialization: vi.fn() }) }));
vi.mock('@/hooks/useLearnerSummaryParam', () => ({ useLearnerSummaryParam: vi.fn(() => ({ real: { id: 71, name: state.name, programmeStatus: state.programmeStatus }, loadError: state.profileError, loading: false, refresh: state.refresh })) }));
vi.mock('@/hooks/useLiveLearnerRead', () => ({ useLiveLearnerRead: vi.fn((_kind, _id, _enabled, read) => ({ data: { weekStart: '2026-09-07', weekEnd: '2026-09-13', modules: state.modules,
  deadlines: state.upcoming ? [{ id: 'a', title: 'My assignment', date: '2050-10-10', type: 'assignment' }] : [],
  sessions: state.upcoming ? [
    { id: 's1', title: 'First lecture', start: '2050-10-15T09:00:00Z', status: 'scheduled' },
    { id: 's2', title: 'Second lecture', start: '2050-10-16T09:00:00Z', status: 'scheduled' },
  ] : [],
  reviews: state.upcoming ? [{ id: 'r', title: 'My progress review', source: 'progress-review', scheduledDate: '2050-11-20', status: 'scheduled' }] : [], homeProgress: {
  period: { start: '2026-01-01', end: '2026-09-13', timezone: 'Europe/London' },
  otjh: { actual: 42, submitted: 10, planned: 100, percent: 42, missingPlannedActivities: 0 },
  activities: { completed: 21, total: 50 }, assignments: { completed: 3, total: 6 },
  lectures: { completed: 8, total: 10 }, modules: { completed: 1, total: 5 }, undatedActivities: 0,
} }, loading: false, error: read === overviewHome.read ? '' : state.scheduleError, refresh: vi.fn() })) }));
vi.mock('@/pages/workspace/learner/page', () => ({ default: function MockDashboard() {
  const { kind, id } = useParams();
  return <><aside aria-label="Learner sidebar"><Link to={kind && id ? `/workspace/learner/${kind}/${id}` : '/workspace/learner'}>Return home</Link></aside><h1>Dashboard console</h1></>;
} }));
function Location() { const location = useLocation(); return <output data-testid="destination">{location.pathname}{location.search}</output>; }
function page() { return render(<ThemeProvider><MemoryRouter initialEntries={['/learner/home?kind=commercial&id=999']}><StudentHome/><Location/></MemoryRouter></ThemeProvider>); }
function WorkspaceRoutes() { return useRoutes(studentWorkspaceRoutes); }
function workspace(path: string) { return render(<ThemeProvider><MemoryRouter initialEntries={[path]}><Suspense fallback={<p>Loading</p>}><WorkspaceRoutes/></Suspense><Location/></MemoryRouter></ThemeProvider>); }
beforeEach(() => { state.profileError = ''; state.role = 'learner'; state.programmeStatus = 'Active'; state.upcoming = false; state.scheduleError = ''; state.modules = []; rememberSignedInLearner(undefined, undefined); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); });
describe('connected student home', () => {
  it('uses only the authenticated identity, with real progress and empty events', () => {
    localStorage.setItem('my_learner', JSON.stringify({ kind: 'commercial', id: 999 }));
    page();
    expect(useLearnerSummaryParam).toHaveBeenCalledWith('apprenticeship', '71');
    expect(useLiveLearnerRead).toHaveBeenCalledWith('apprenticeship', '71', true, overviewHome.read, overviewHome.peek);
    expect(screen.getByRole('heading', { name: 'Alex' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('link', { name: /8 of 10 Lectures attended/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /21 of 50 Activities completed/ })).toBeInTheDocument();
    const upcoming = within(screen.getByRole('complementary', { name: 'Upcoming' }));
    expect(upcoming.getAllByRole('listitem')).toHaveLength(3);
    expect(upcoming.getByText('No upcoming lecture scheduled')).toBeInTheDocument();
    expect(upcoming.getByText('No upcoming assignment due')).toBeInTheDocument();
    expect(upcoming.getByText('No upcoming review scheduled')).toBeInTheDocument();
    expect(screen.queryByText(/Jamie|68%|Marketing Principles/)).not.toBeInTheDocument();
    localStorage.removeItem('my_learner');
  });
  it('renders the closest lecture, assignment and review in fixed order, with working destinations', () => {
    state.upcoming = true;
    page();
    const upcoming = within(screen.getByRole('complementary', { name: 'Upcoming' }));
    const rows = upcoming.getAllByRole('listitem');
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Next lecture', 'Next assignment', 'Next review']);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/learner/attendance');
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/learner/monthly-submission');
    expect(within(rows[2]).getByRole('link')).toHaveTextContent('My progress review');
    expect(within(rows[2]).getByRole('link')).toHaveAttribute('href', '/learner/calendar');
    expect(upcoming.queryByText('Second lecture')).not.toBeInTheDocument();
    fireEvent.click(within(rows[2]).getByRole('link'));
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/calendar');
  });
  it('keeps the assignment visible if the lecture/review source fails, without reporting false empty slots', () => {
    state.upcoming = true;
    state.scheduleError = 'Unavailable';
    page();
    const upcoming = within(screen.getByRole('complementary', { name: 'Upcoming' }));
    expect(upcoming.getByText('My assignment')).toBeInTheDocument();
    expect(upcoming.getAllByText('Upcoming activity unavailable')).toHaveLength(2);
    expect(upcoming.queryByText('No upcoming lecture scheduled')).not.toBeInTheDocument();
    expect(upcoming.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it.each([
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
  it('shows the shared learner header while keeping the learning actions in the shield', () => {
    page();
    const header = within(screen.getByRole('banner'));
    expect(header.getByText('Student Home')).toBeVisible();
    expect(header.getByRole('button', { name: 'Help & Support' })).toBeVisible();
    expect(header.getByRole('button', { name: 'Account menu' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Learner primary navigation' })).toBeInTheDocument();
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
    expect(screen.getByTestId('destination')).toHaveTextContent('/learner/my-learning/apprenticeship/71?subject=current%3AM1&week=2026-09-07');
  });
  it('shows a retry state if the personal profile fails', () => {
    state.profileError = 'Could not load the current learner'; page();
    expect(screen.queryByRole('heading', { name: 'Alex' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i })); expect(state.refresh).toHaveBeenCalled();
  });

  it.each(['/workspace/learner', '/learner/home'])('renders the landing page at %s and opens the console only through Dashboard', async path => {
    workspace(path);
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Learner sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard console' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Learner sidebar' })).toBeVisible();
    expect(screen.getByTestId('destination')).toHaveTextContent('/workspace/learner/dashboard');
    fireEvent.click(screen.getByRole('link', { name: 'Return home' }));
    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeVisible();
  });

  it.each(['Fresh user', 'Onboarding', 'Delivery'])('keeps the landing page as the entry for programme status %s', async status => {
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
    const dashboard = screen.getAllByRole('link', { name: 'Dashboard' }).find(link => link.getAttribute('href') === '/workspace/learner/commercial/502/dashboard')!;
    expect(dashboard).toHaveAttribute('href', '/workspace/learner/commercial/502/dashboard');
    fireEvent.click(dashboard);
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
