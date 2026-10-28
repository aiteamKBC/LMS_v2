import { weeklyContractFixture } from '@/test/weeklyContractFixture';
import { dashboardHeaderFixture } from '@/test/dashboardHeaderFixture';
import { dashboardMonthlyFixture } from '@/test/dashboardMonthlyFixture';
import * as React from 'react';
import { Component, type ReactNode } from 'react';
import * as Router from 'react-router-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { ToastProvider } from '@/hooks/useToast';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { rememberLearner } from '@/hooks/useMyLearner';
import type { LearnerDetail } from '@/api/learnerDetail';
import { learnerLiveSessionHref } from '../liveSessionRoute';
import LearnerOverview from '../page';

/*
 * Request graph of the Student Dashboard (page.tsx) at the network layer:
 * which GETs a cold load, tab switches, deep links, focus events and a
 * learner switch produce. Only `fetch` is replaced; every hook and cache is real.
 */

const viewer = vi.hoisted(() => ({ role: 'learner' as string }));
vi.mock("@/hooks/useAuth.helpers", () => ({ useAuth: () => ({
  isInitialized: true, isAdmin: viewer.role === 'admin', hasPermission: () => true, canSeeNavItem: () => true,
  auth: { isAuthenticated: true, account: viewer.role === 'learner'
    ? { id: 1, role: 'learner', subjectType: 'learner', subjectId: 265, learnerType: 'commercial' }
    : { id: 2, role: viewer.role, subjectType: 'staff', subjectId: 9 },
  user: { id: '1', fullName: 'Viewer', email: 'viewer@example.test' }, roles: [] },
}) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children, pageTitle }: { children: ReactNode; pageTitle: string }) =>
  <main data-testid="workspace"><h1>{pageTitle}</h1>{children}</main> }));

const NOW = new Date('2026-10-15T09:00:00Z');
const SESSION_START = '2026-10-20T09:00:00Z';
const SESSION_DAY = '2026-10-20';

/** Per-learner synthetic plan: two live sessions in one module, dated a week apart. */
function plan(id: string) {
  const moduleTitle = `Module ${id}`;
  const moduleId = `mod-${id}`;
  return {
    modules: [moduleTitle],
    week: [
      { module: moduleTitle, week: 'Week 1', moduleId, weekId: `w1-${id}` },
      { module: moduleTitle, week: 'Week 2', moduleId, weekId: `w2-${id}` },
    ],
    components: [
      { module: moduleTitle, week: 'Week 1', component: 'Kick-off session', expectedOtjh: 1, moduleId, weekId: `w1-${id}`,
        componentId: `LS1-${id}`, type: 'live_session', sessionDate: '2026-10-13', sessionDateTimeUtc: '2026-10-13T09:00:00Z' },
      { module: moduleTitle, week: 'Week 2', component: 'Second live session', expectedOtjh: 1, moduleId, weekId: `w2-${id}`,
        componentId: `LS2-${id}`, type: 'live_session', sessionDate: SESSION_DAY, sessionDateTimeUtc: SESSION_START },
    ],
  };
}

const summary = (id: string, status = 'Active') => ({ id, name: `Learner ${id}`, email: `l${id}@example.test`, phone: '',
  learnerType: 'commercial' as const, programme: 'Leadership', programmeStatus: status, cohort: '', group: '', employer: '',
  lineManager: '', isActive: true, studentActivityAvailable: false });

/** The full learner-detail payload the hero link used before the change. */
const fullDetail = (id: string, status = 'Active') => ({ ...summary(id, status), ...plan(id),
  components: plan(id).components.map(component => ({ ...component, description: '<p>Join the session</p>' })),
  ksbs: [], quizAttempts: [], videoProgress: [], componentProgress: [], activityFeed: [], totalExpectedOtjh: 0 });

const compactWeekly = (id: string) => ({ id, programme: 'Leadership', cohort: '', group: '', ...plan(id),
  components: [...plan(id).components.map(component => ({ ...component, contentAvailable: true })),
    { module: 'Other module', moduleId: `other-${id}`, week: 'Week 1', weekId: `other-w-${id}`,
      component: 'Other assigned activity', componentId: `other-c-${id}`, type: 'reading', contentAvailable: true }],
  quizAttempts: [], videoProgress: [], componentProgress: [{ kind: 'component', componentId: `LS1-${id}`, passed: true }] });

const schedule = (id: string) => ({ months: {}, actual: [], actualAvailable: false, modules: [], moduleLinks: {},
  sessions: [{ id: `s-${id}`, moduleId: `mod-${id}`, title: `Live session for ${id}`, start: SESSION_START,
    end: '2026-10-20T10:00:00Z', minutes: 60, joinUrl: null, status: 'scheduled', attended: null }],
  reviews: [], coach: { name: '', bookingUrl: null }, contractStatus: 'not-available', generatedAt: '' });

function weeklySchedule(id: string) {
  return { ...schedule(id), modules: [{ id: `mod-${id}`, title: `Module ${id}`,
    start_date: '2026-10-13', end_date: '2026-10-26', curriculumSlots: [
      { slotNumber: 1, date: '2026-10-13', day: 'Tuesday', type: 'live-session', sessionNumber: 1, holidays: [], weekId: `w1-${id}`, weekTitle: 'Week 1' },
      { slotNumber: 2, date: SESSION_DAY, day: 'Tuesday', type: 'live-session', sessionNumber: 2, holidays: [], weekId: `w2-${id}`, weekTitle: 'Week 2' },
    ] }, { id: `other-${id}`, title: 'Other module', start_date: null, end_date: null,
      curriculumSlots: [{ slotNumber: 1, date: '2026-10-13', day: 'Tuesday', type: 'live-session', sessionNumber: 1,
        holidays: [], weekId: `other-w-${id}`, weekTitle: 'Other week' }] }], moduleActivityHours: {} };
}
let status = 'Active';
let deadlineDate: string | null = null;
let missing: string[] = [];
let hold: { match: RegExp; promise: Promise<void> } | null = null;

function body(url: string): unknown {
  const id = url.match(/\/(?:commercial|apprenticeship)\/(\d+)\//)?.[1] || '265';
  if (url.includes('/curriculum/cache-epoch/')) return { epoch: 0, changes: [] };
  if (url.includes('/profile-photo/')) return null;
  if (url.includes('/dashboard/') && url.endsWith('/header/minimal/')) return dashboardHeaderFixture({ learner: summary(id, status), schedule: { ...schedule(id), modules: [{ id: `mod-${id}`, title: `Module ${id}`, start_date: null, end_date: null }] }, week: { deadlines: deadlineDate ? [{ id: 'A1', type: 'assignment', title: 'Due assignment', date: deadlineDate, subjectId: `current:mod-${id}` }] : [] }, lectureHref: learnerLiveSessionHref(fullDetail(id) as unknown as LearnerDetail, { date: SESSION_START, moduleId: `mod-${id}`, title: `Live session for ${id}` }, 'commercial', id) });
  if (/\/dashboard\/.*\/monthly\//.test(url)) return dashboardMonthlyFixture(new URL(url, 'https://example.test').searchParams.get('month') || '2026-10');
  if (/\/dashboard\/.*\/training\/$/.test(new URL(url, 'https://example.test').pathname)) {
    const selectedModule = { id: `current:mod-${id}`, title: `Module ${id}`, moduleId: `mod-${id}`,
      start: '2026-10-13', end: '2026-10-26', done: 1, activityCount: 2, progress: 50,
      detail: { id: `mod-${id}`, title: `Module ${id}`, description: '', start_date: '2026-10-13', end_date: '2026-10-26', coach_name: '', tutor_name: '' },
      activityCounts: { live_session: 2 }, ksbCodes: [], achievedKsbCodes: null, ksbMappingMissing: false,
      weeks: 2, actual: null, sessions: [], activities: [] };
    return { timeline: { start: '2026-10', end: '2026-10', modules: [selectedModule], reviews: [], months: {}, coachName: '' },
      selectedModuleId: selectedModule.id, selectedModule };
  }
  if (/\/dashboard\/.*\/overview\/$/.test(url)) return {
    metrics: { ksb: { completed: 0, total: 0, percent: null },
      otjh: { actual: 0, targetToDate: null } },
    attendance: { sessions: 0, present: 0 }, reviews: { completed: 0, total: 0, percent: null },
    modules: [], programme: [], hours: { months: [], planned: null, end: '' },
    programmeStartDate: null, programmeEndDate: null,
  };
  if (url.includes('/learner-summary/')) return summary(id, status);
  if (url.includes('/learner-detail/')) return fullDetail(id, status);
  if (/\/dashboard\/.*\/weekly\/plan\/[^/]+\//.test(url)) {
    const parsed = new URL(url, 'https://example.test');
    const weekId = decodeURIComponent(parsed.pathname.split('/')[7]);
    return weeklyContractFixture({ ...compactWeekly(id), schedule: weeklySchedule(id), selectedWeekId: weekId });
  }
  if (/\/dashboard\/.*\/weekly\/plan\/$/.test(new URL(url, 'https://example.test').pathname)) return weeklyContractFixture({ ...compactWeekly(id), schedule: weeklySchedule(id) });
  if (url.includes('/training-plan-dashboard/')) return schedule(id);
  if (url.includes('/overview-week/')) return { weekStart: '2026-10-12', weekEnd: '2026-10-18', timezone: 'Europe/London',
    planSubjects: [], modules: [], deadlines: [], undatedActivities: 0, expectedHours: null, missingExpectedHours: 0,
    otjh: { actual: 0, historical: 0, new: 0, undatedHistoricalRows: 0 },
    metrics: { migrated: false, programme: { completed: 0, total: 0, percent: null, status: 'empty' },
      ksb: { completed: 0, total: 0, percent: null, status: 'empty', codes: [] },
      otjh: { historical: 0, new: 0, actual: 0, planned: null } } };
  if (url.includes('/subject-covers/')) return { covers: {}, current_subjects: [], builder_subjects: {}, modules: {} };
  if (url.includes('/attendance/') && url.includes('/lectures/')) return {
    lectures: [], modules: [], summary: null, recentActivity: [],
    totals: { total: 0, attended: 0, absent: 0, covered: 0, upcoming: 0, attendanceRate: null },
    mode: { available: false, mode: 'live', requestedMode: null, status: 'active', emailSent: false, managerAvailable: false, remindersEnabled: true, updatedAt: null },
  };
  if (url.includes('/attendance/')) return { attendance: null };
  if (url.includes('/metrics/')) return { migrated: false,
    programme: { completed: 0, total: 0, percent: null, status: 'empty' },
    ksb: { completed: 0, total: 0, percent: null, status: 'empty', codes: [] },
    otjh: { historical: 0, new: 0, actual: 0, planned: null } };
  if (url.includes('/monthly-logs/')) return {
    learner: { id: Number(id), aptem_id: null, name: `Learner ${id}`, programme: 'Leadership', coach_name: '' },
    months: [], training_plan_totals: { accepted_hours: 0, planned_hours: null },
    total_months: 0, completed_months: 0, read_only: false, csrf_token: 'csrf',
  };
  if (url.includes('/review-history/')) return { learnerId: Number(id), category: 'progress-review', reviews: [] };
  if (url.includes('/module-progress/')) return { modules: [] };
  if (url.includes('/rewards-summary/')) return { points: { learnerId: id, earned: 0, committed: 0, balance: 0 }, rewards: [] };
  if (url.startsWith('/engagement_api/')) return { rewards: [], claims: [], recognitions: [], events: [], bookings: [], clubs: [], grants: [], decks: [], entries: [], earned: 0, balance: 0, committed: 0, total: 0, count: 0 };
  missing.push(url);
  return null;
}

class PageBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p data-testid="page-crash">{this.state.error}</p> : this.props.children; }
}

const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
const count = (pattern: RegExp) => urls().filter(url => pattern.test(url)).length;
const WEEKLY = /\/learner_api\/dashboard\/.*\/weekly\//;
const DETAIL = /\/learner_api\/learner-detail\//;
const OVERVIEW = /\/dashboard\/.*\/overview\//;
const SUMMARY = /\/learner_api\/learner-summary\//;
const HEADER = /\/learner_api\/dashboard\/.*\/header\//;
const SCHEDULE = /\/training-plan-dashboard\/.*section=overview/;
const WEEK = /\/overview-week\//;
const PHOTO = /\/profile-photo\//;
/** Requests the Dashboard makes for itself (not the shared curriculum epoch poll). */
const dashboardUrls = () => urls().filter(url => url.startsWith('/learner_api/') || url.startsWith('/engagement_api/'));

async function settle(ms = 60) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
}

function NextLearner() {
  const navigate = Router.useNavigate();
  return <button onClick={() => navigate('/workspace/learner/commercial/266/dashboard')}>Next learner</button>;
}

function renderDashboard(path = '/workspace/learner/commercial/265/dashboard') {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider><PageBoundary>
    <NextLearner />
    <Routes>
      <Route path="/workspace/learner/:kind/:id/dashboard" element={<LearnerOverview />} />
      <Route path="*" element={<p data-testid="redirected">Redirected</p>} />
    </Routes>
  </PageBoundary></ToastProvider></MemoryRouter>);
}

const expectedHref = (id: string) => learnerLiveSessionHref(fullDetail(id) as unknown as LearnerDetail,
  { date: SESSION_START, title: `Live session for ${id}`, moduleId: `mod-${id}` }, 'commercial', id);

function attendLink() {
  const hero = within(screen.getByLabelText('Learner programme'));
  const card = hero.getByRole('group', { name: /^Next live session:/ });
  return within(card).getByRole('link', { name: 'Attend' });
}

async function waitForDashboard(id = '265') {
  expect(await screen.findByRole('heading', { name: `Learner ${id}` })).toBeVisible();
}

beforeEach(() => {
  clearAllCachedResources(); localStorage.clear(); sessionStorage.clear();
  viewer.role = 'learner'; status = 'Active'; missing = []; hold = null; deadlineDate = null;
  rememberLearner('commercial', '265');
  window.history.replaceState(null, '', '/');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('React', React);
  // Match the production auto-imports without changing the tested components.
  for (const [key, value] of Object.entries({ ...React, ...Router, AppIcon })) {
    if (key === 'AppIcon' || key === 'React' || key.startsWith('use') || ['Link', 'Navigate', 'NavLink', 'Outlet'].includes(key)) vi.stubGlobal(key, value);
  }
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (hold && hold.match.test(url)) await hold.promise;
    return new Response(JSON.stringify(body(url)));
  }));
});

afterEach(() => {
  cleanup();
  clearAllCachedResources();
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Student Dashboard request graph', () => {
  it('hides protected cached content if Header reports a real permission failure', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => String(input).endsWith('/header/minimal/')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Permission revoked' }), { status: 403 })) : original(input, init));
    renderDashboard();
    expect(await screen.findByText('Permission revoked')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
  it('rejects incomplete Header data without starting protected tab reads', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ learner: {}, weeklyCandidates: [] })));
    renderDashboard();
    expect(await screen.findByText('Dashboard Header response required.')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(dashboardUrls()).toEqual(['/learner_api/dashboard/commercial/265/header/minimal/']);
  });
  it.each(['weekly', 'monthly', 'training', 'overview', 'rewards'])('opens %s after the canonical Header resolves', async tab => {
    let release!: () => void;
    hold = { match: /\/header\/minimal\/$/, promise: new Promise(resolve => { release = resolve; }) };
    window.history.replaceState(null, '', `/workspace/learner/commercial/265/dashboard?tab=${tab}`);
    renderDashboard(`/workspace/learner/commercial/265/dashboard?tab=${tab}`);
    await settle();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(count(HEADER)).toBe(1);
    expect(dashboardUrls().filter(url => /\/(weekly|monthly|training|overview)\//.test(url))).toEqual([]);
    await act(async () => release());
    await waitForDashboard();
    expect(screen.getByRole('tab', { name: { weekly: 'Weekly Learning', monthly: 'Monthly Plan', training: 'Training Plan', overview: 'Overview', rewards: 'Rewards' }[tab]! })).toHaveAttribute('aria-selected', 'true');
  });

  it('retries a failed canonical Header before starting protected tabs', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => String(input).endsWith('/header/minimal/')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Header unavailable' }), { status: 503 })) : original(input, init));
    renderDashboard();
    expect(await screen.findByText('Header unavailable')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    vi.mocked(fetch).mockImplementation(original);
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    await waitForDashboard();
    expect(count(HEADER)).toBe(3);
  });

  it.each(['learner', 'staff'])('blocks all protected content on Header denial as %s', async role => {
    viewer.role = role;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 }));
    renderDashboard();
    expect(await screen.findByText('Access denied')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(dashboardUrls()).toEqual(['/learner_api/dashboard/commercial/265/header/minimal/']);
  });
  it('uses the authoritative Header module to select the initial week in exactly two dashboard reads', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/header/minimal/')) {
        const header = body(url) as object;
        return new Response(JSON.stringify({ ...header, initialWeeklyModuleId: 'mod-265' }));
      }
      if (url.includes('/weekly/plan/?')) return new Response(JSON.stringify(weeklyContractFixture({ ...compactWeekly('265'),
        components: compactWeekly('265').components.filter(c => c.weekId === 'w1-265'), schedule: weeklySchedule('265'),
        selectedModuleId: 'mod-265', selectedWeekId: 'slot:mod-265:1',
        weekSummaries: [{ moduleId: 'mod-265', weekId: 'w1-265', slotNumber: 1, progress: { total: 1, completed: 1, percent: 100 } }],
      })));
      return original(input, init);
    });
    renderDashboard();
    await waitForDashboard();
    await waitFor(() => expect(screen.getByText('Kick-off session')).toBeInTheDocument());
    await settle();
    expect(urls().filter(url => WEEKLY.test(url))).toEqual(['/learner_api/dashboard/commercial/265/weekly/plan/?moduleId=mod-265']);
    expect(count(HEADER)).toBe(1);
    expect(dashboardUrls().filter(url => url.includes('/dashboard/'))).toHaveLength(2);
  });
  it('refreshes the nearest assignment after its UK due day ends', async () => {
    deadlineDate = '2026-10-15';
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    renderDashboard(); await waitForDashboard();
    await waitFor(() => expect(count(WEEKLY)).toBe(1)); await settle();
    expect(screen.getByText('Due assignment')).toBeVisible();
    vi.setSystemTime(new Date('2026-10-15T23:00:01Z'));
    act(() => { vi.advanceTimersByTime(30_000); });
    await waitFor(() => expect(count(HEADER)).toBe(2));
    expect(count(WEEKLY)).toBe(1);
  });
  it('refreshes Header once when its compact session expires, without reloading Weekly', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    renderDashboard(); await waitForDashboard();
    await waitFor(() => expect(count(WEEKLY)).toBe(1));
    await settle();
    vi.setSystemTime(new Date('2026-10-20T09:00:01Z'));
    act(() => { vi.advanceTimersByTime(30_000); });
    await waitFor(() => expect(count(HEADER)).toBe(2));
    act(() => { vi.advanceTimersByTime(60_000); });
    await settle();
    expect(count(HEADER)).toBe(2);
    expect(count(WEEKLY)).toBe(1);
  });
  it.each(['commercial', 'apprenticeship'])('renders %s weeks, progress, activities and sessions with a slot-free Header', async kind => {
    viewer.role = 'staff';
    renderDashboard(`/workspace/learner/${kind}/265/dashboard`);
    await waitForDashboard();
    expect(await screen.findByRole('table')).toBeVisible();
    expect(screen.queryByText('Your weekly plan will appear here')).not.toBeInTheDocument();
    expect(screen.getByText('Kick-off session')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Week 1 activity progress' })).toHaveAttribute('aria-valuenow', '100');
    fireEvent.click(screen.getByRole('button', { name: /^Week 2/ }));
    expect(await screen.findByText('Second live session')).toBeVisible();
    expect(within(screen.getByLabelText('Weekly learning plan')).getByText('Live session for 265')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'other-265' } });
    expect(await screen.findByText('Other assigned activity')).toBeVisible();
    expect(count(WEEKLY)).toBe(3); // Initial week plus one read for each new selection.
    fireEvent.change(screen.getByRole('combobox', { name: 'Module' }), { target: { value: 'mod-265' } });
    expect(await screen.findByText('Kick-off session')).toBeVisible();
    expect(count(WEEKLY)).toBe(3); // The initial selected week was primed in cache.
    const hero = within(screen.getByLabelText('Learner programme'));
    expect(hero.getByRole('link', { name: /View all/i })).toHaveAttribute('href', `/learner/my-learning/${kind}/265`);
  });

  it('shows a Weekly API failure instead of an empty schedule', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => new URL(String(input), 'https://example.test').pathname.endsWith('/weekly/plan/')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Weekly read denied' }), { status: 403 }))
      : original(input, init));
    renderDashboard(); await waitForDashboard();
    expect(await screen.findByText('Could not load your weekly plan')).toBeVisible();
    expect(screen.getByText('Weekly read denied')).toBeVisible();
    expect(screen.queryByText('Your weekly plan will appear here')).not.toBeInTheDocument();
  });

  it('computes a real activity route for the fixture (sanity)', () => {
    expect(expectedHref('265')).toBe('/learner/component/commercial/265/LS2-265?module=Module%20265&week=Week%202');
  });

  it.each(['learner', 'staff'])('cold load on Weekly as %s: compact weekly read once, no learner-detail', async role => {
    viewer.role = role;
    renderDashboard();
    await waitForDashboard();
    expect(screen.getByRole('tab', { name: 'Weekly Learning' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => {
      expect(count(WEEKLY)).toBe(1);
      expect(count(HEADER)).toBe(1);
      expect(count(SCHEDULE)).toBe(0);
      expect(count(WEEK)).toBe(0);
    });
    await settle();
    console.info(`[${role}] Weekly cold-load requests:\n  ${dashboardUrls().join('\n  ')}`);
    expect(count(DETAIL)).toBe(0);
    expect(count(WEEKLY)).toBe(1);
    expect(urls().filter(url => WEEKLY.test(url))).toEqual(['/learner_api/dashboard/commercial/265/weekly/plan/']);
    expect(count(SUMMARY)).toBe(0);
    expect(count(HEADER)).toBe(1);
    expect(count(SCHEDULE)).toBe(0);
    expect(count(WEEK)).toBe(0);
    expect(count(PHOTO)).toBeLessThanOrEqual(1);
    // Hidden-tab reads stay closed.
    expect(dashboardUrls().filter(url => /\/metrics\/|\/attendance\/|\/monthly-logs\/|\/student-activity\/|\/subject-covers\//.test(url))).toEqual([]);
    expect(new Set(dashboardUrls()).size).toBe(dashboardUrls().length);
    expect(missing).toEqual([]);
    expect(screen.queryByTestId('page-crash')).not.toBeInTheDocument();
  });

  it('links the hero Next live session card to its header navigation metadata', async () => {
    renderDashboard();
    await waitForDashboard();
    const expected = expectedHref('265');
    expect(expected).toBeTruthy();
    await waitFor(() => expect(attendLink()).toHaveAttribute('href', expected!));
    expect(count(DETAIL)).toBe(0);
    // Not the undated/other-week session of the same module.
    expect(attendLink().getAttribute('href')).not.toContain('LS1-265');
  });

  it('fetches Overview once when opened, and tab revisits reuse cached reads', async () => {
    renderDashboard();
    await waitForDashboard();
    await waitFor(() => expect(count(WEEKLY)).toBe(1));
    expect(count(DETAIL)).toBe(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => expect(count(OVERVIEW)).toBe(1));
    expect(urls().filter(url => OVERVIEW.test(url))).toEqual(['/learner_api/dashboard/commercial/265/overview/']);
    expect(count(DETAIL)).toBe(0);
    await settle();

    fireEvent.click(screen.getByRole('tab', { name: 'Weekly Learning' }));
    await settle();
    expect(count(WEEKLY)).toBe(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await settle();
    expect(count(DETAIL)).toBe(0);
    expect(count(OVERVIEW)).toBe(1);
    expect(count(WEEKLY)).toBe(1);
    expect(attendLink()).toHaveAttribute('href', expectedHref('265')!);
    expect(screen.queryByTestId('page-crash')).not.toBeInTheDocument();
  });

  it('deep link ?tab=overview reads only Header and Overview and still links the hero card', async () => {
    window.history.replaceState(null, '', '/workspace/learner/commercial/265/dashboard?tab=overview');
    renderDashboard('/workspace/learner/commercial/265/dashboard?tab=overview');
    await waitForDashboard();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(count(OVERVIEW)).toBe(1));
    await waitFor(() => expect(attendLink()).toHaveAttribute('href', expectedHref('265')!));
    await settle();
    console.info(`[?tab=overview] requests:\n  ${dashboardUrls().join('\n  ')}`);
    expect(count(WEEKLY)).toBe(0);
    expect(count(DETAIL)).toBe(0);
    expect(count(OVERVIEW)).toBe(1);
  });

  it('a Fresh user viewing their own record gets the waiting page without dashboard reads', async () => {
    status = 'Fresh user';
    renderDashboard();
    expect(await screen.findByRole('heading', { name: "Your enrolment hasn't started yet" })).toBeVisible();
    await settle(100);
    console.info(`[fresh learner] requests:\n  ${dashboardUrls().join('\n  ')}`);
    expect(dashboardUrls().filter(url => /\/training-plan-dashboard\/|\/overview-week\/|\/weekly-learning\/|\/learner-detail\//.test(url))).toEqual([]);
    expect(count(SUMMARY)).toBe(0);
    expect(count(HEADER)).toBe(1);
    expect(count(/\/bootstrap\//)).toBe(0);
  });

  it('staff reviewing a Fresh learner still get the Dashboard and its reads', async () => {
    viewer.role = 'staff';
    status = 'Fresh user';
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await waitFor(() => {
      expect(count(WEEKLY)).toBe(1);
      expect(count(HEADER)).toBe(1);
      expect(count(SCHEDULE)).toBe(0);
      expect(count(WEEK)).toBe(0);
    });
    expect(screen.queryByRole('heading', { name: "Your enrolment hasn't started yet" })).not.toBeInTheDocument();
    expect(count(DETAIL)).toBe(0);
  });

  it('window focus, visibility and online events after load do not trigger new requests', async () => {
    renderDashboard();
    await waitForDashboard();
    await waitFor(() => expect(attendLink()).toHaveAttribute('href', expectedHref('265')!));
    await settle();
    const before = dashboardUrls();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      vi.setSystemTime(Date.now() + 1_500);
      act(() => {
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('online'));
      });
    }
    await settle();
    expect(dashboardUrls()).toEqual(before);
  });

  it('switching learner reads the new learner\'s weekly plan and never shows the previous learner\'s link', async () => {
    viewer.role = 'staff';
    renderDashboard();
    await waitForDashboard('265');
    await waitFor(() => expect(attendLink()).toHaveAttribute('href', expectedHref('265')!));

    let release!: () => void;
    hold = { match: /\/dashboard\/commercial\/266\/weekly\//, promise: new Promise<void>(resolve => { release = resolve; }) };
    fireEvent.click(screen.getByRole('button', { name: 'Next learner' }));
    await waitForDashboard('266');
    await waitFor(() => expect(count(/\/dashboard\/commercial\/266\/weekly\//)).toBe(1));
    // While 266's plan is in flight nothing from 265 may be linked.
    const pendingHref = attendLink().getAttribute('href') || '';
    expect(pendingHref).not.toContain('/265/');
    expect(pendingHref).not.toContain('LS2-265');
    expect(screen.queryByRole('heading', { name: 'Learner 265' })).not.toBeInTheDocument();

    await act(async () => { release(); });
    await waitFor(() => expect(attendLink()).toHaveAttribute('href', expectedHref('266')!));
    await settle();
    expect(count(/\/dashboard\/commercial\/266\/weekly\//)).toBe(1);
    expect(count(/\/dashboard\/commercial\/265\/weekly\//)).toBe(1);
    expect(count(DETAIL)).toBe(0);
    expect(screen.queryByTestId('page-crash')).not.toBeInTheDocument();
  });
  it('loads each tab once, keeps Header cached, and Rewards requests nothing', async () => {
    renderDashboard(); await waitForDashboard();
    await waitFor(() => expect(count(WEEKLY)).toBe(1));
    for (const [label, section] of [['Monthly Plan', 'monthly'], ['Training Plan', 'training'], ['Overview', 'overview']] as const) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
      await waitFor(() => expect(urls().filter(url => new URL(url, 'https://example.test').pathname.endsWith(section === 'monthly' ? '/monthly/plan/' : `/${section}/`))).toHaveLength(1));
      fireEvent.click(screen.getByRole('tab', { name: 'Weekly Learning' }));
      fireEvent.click(screen.getByRole('tab', { name: label }));
      await settle();
      expect(urls().filter(url => new URL(url, 'https://example.test').pathname.endsWith(section === 'monthly' ? '/monthly/plan/' : `/${section}/`))).toHaveLength(1);
    }
    const before = dashboardUrls();
    fireEvent.click(screen.getByRole('tab', { name: 'Rewards' })); await settle();
    expect(dashboardUrls()).toEqual(before);
    expect(count(HEADER)).toBe(1);
    expect(dashboardUrls().filter(url => /learner-detail|learner-summary|overview-week|training-plan-dashboard|module-progress|student-activity|subject-covers|monthly-logs|\/metrics\/|\/attendance\//.test(url))).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('loads only selected Monthly months, preserves selection on tab switches, and reuses valid cached months', async () => {
    renderDashboard(); await waitForDashboard();
    await waitFor(() => expect(count(WEEKLY)).toBe(1));
    expect(count(/\/monthly\//)).toBe(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Monthly Plan' }));
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeVisible();
    expect(count(/\/monthly\//)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeVisible();
    expect(count(/\/monthly\//)).toBe(2);
    expect(urls().filter(url => /\/monthly\//.test(url)).map(url => new URL(url, 'https://example.test').searchParams.get('month'))).toEqual([null, '2026-11']);
    fireEvent.click(screen.getByRole('tab', { name: 'Weekly Learning' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Monthly Plan' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeVisible();
    expect(count(/\/monthly\//)).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeVisible();
    await settle();
    expect(count(/\/monthly\//)).toBe(2);
    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeVisible();
    expect(count(/\/monthly\//)).toBe(3);
    expect(dashboardUrls().filter(url => /learner-detail|overview-week|training-plan-dashboard|student-activity|subject-covers|monthly-logs/.test(url))).toEqual([]);
  });

  it('shows a cold Monthly error instead of empty collections and retries the compact read', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let failed = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes('/monthly/') && !failed) {
        failed = true; return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 });
      }
      return original(input, init);
    });
    renderDashboard(); await waitForDashboard();
    fireEvent.click(screen.getByRole('tab', { name: 'Monthly Plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized');
    expect(screen.queryByText('No lectures scheduled for this month.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Loading monthly learning and coaching')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry monthly learning' }));
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeVisible();
    expect(count(/\/monthly\//)).toBe(2);
  });

});
