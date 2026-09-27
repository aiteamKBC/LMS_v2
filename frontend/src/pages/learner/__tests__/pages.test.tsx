import * as React from 'react';
import { Component, type ReactNode, type ComponentType } from 'react';
import * as Router from 'react-router-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppIcon } from '@/components/feature/AppIcon';
import { ToastProvider } from '@/hooks/useToast';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { rememberLearner } from '@/hooks/useMyLearner';
import { invalidateLearnerReads } from '@/api/learnerRead';

const viewer = vi.hoisted(() => ({ kind: 'commercial', role: 'learner' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  isInitialized: true, isAdmin: false, hasPermission: () => true, canSeeNavItem: () => true,
  auth: { isAuthenticated: true, account: { id: 1, role: viewer.role, subjectType: 'learner', subjectId: 125, learnerType: viewer.kind },
    user: { id: '125', fullName: 'Test learner', email: 'learner@example.test' }, roles: [] },
}) }));
// Navigation chrome has its own tests. Keep every page and its data hooks real.
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children, pageTitle }: { children: ReactNode; pageTitle: string }) =>
  <main data-testid="workspace"><h1>{pageTitle}</h1>{children}</main> }));

const modules = import.meta.glob<{ default: ComponentType }>('/src/pages/learner/**/page.tsx');
Object.assign(modules, import.meta.glob<{ default: ComponentType }>('/src/pages/workspace/learner/page.tsx'));
const config = ['src/router/config.tsx', 'src/router/studentWorkspaceRoutes.tsx']
  .map(path => readFileSync(resolve(path), 'utf8')).join('\n');
const components = new Map([...config.matchAll(/const (\w+) = lazyRoute\(\(\) => import\(["'](\.\.\/pages\/(?:learner|workspace\/learner)\/[^"'\n]+)["']\)\)/g)]
  .map(match => [match[1], match[2].replace('../pages/', '/src/pages/') + '.tsx']));
const routes = new Map<string, string>();
for (const match of config.matchAll(/path:\s*["']([^"']+)["']\s*,\s*element:\s*<(\w+)/g)) {
  const file = components.get(match[2]);
  if (file && (!routes.has(file) || match[1].includes(':kind'))) routes.set(file, match[1]);
}

const detail = () => ({ id: '125', name: 'Test learner', email: 'learner@example.test', phone: '',
  learnerType: viewer.kind, programme: 'Leadership', programmeStatus: 'Active', cohort: '', group: '', employer: '',
  lineManager: '', isActive: true, modules: [], week: [], components: [], ksbs: [], quizAttempts: [], videoProgress: [],
  componentProgress: [], activityFeed: [], totalExpectedOtjh: 0, studentActivityAvailable: false });

function payload(url: string): unknown {
  if (url.includes('/curriculum/cache-epoch/')) return { epoch: 0, changes: [] };
  if (url.includes('/curriculum/cache-epoch/')) return { epoch: 0, changes: [] };
  if (url.includes('/profile-photo/')) return null;
  if (url.includes('/overview-week/')) return { weekStart: '2026-09-07', weekEnd: '2026-09-13', timezone: 'Europe/London', planSubjects: [], modules: [], deadlines: [], undatedActivities: 0, expectedHours: null, missingExpectedHours: 0, otjh: { actual: 0, historical: 0, new: 0, undatedHistoricalRows: 0 },
    metrics: { migrated: false, programme: { completed: 0, total: 0, percent: null, status: 'empty' },
      ksb: { completed: 0, total: 0, percent: null, status: 'empty', codes: [] },
      otjh: { historical: 0, new: 0, actual: 0, planned: null } } };
  if (/\/learner-(detail|summary)\//.test(url)) return detail();
  if (url.includes('/subject-covers/')) return { covers: {}, current_subjects: [], builder_subjects: {}, modules: {} };
  if (url.includes('/training-plan-dashboard/')) return { months: {}, actual: [], actualAvailable: false, modules: [], moduleLinks: {}, sessions: [], reviews: [], coach: { name: '', bookingUrl: null }, contractStatus: 'not-available', generatedAt: '' };
  if (url.includes('/reflection/submissions/')) return { statuses: [], assignments: [], submission: null };
  if (url.includes('/review-history/')) return { learnerId: 125, category: 'progress-review', reviews: [] };
  if (url.includes('/attendance/') && url.includes('/lectures/')) return {
    lectures: [], modules: [], summary: null, recentActivity: [],
    totals: { total: 0, attended: 0, absent: 0, covered: 0, upcoming: 0, attendanceRate: null },
    mode: { available: false, mode: 'live', requestedMode: null, status: 'active', emailSent: false, managerAvailable: false, remindersEnabled: true, updatedAt: null },
  };
  if (url.includes('/attendance/')) return { attendance: null };
  if (url.includes('/rewards-summary/')) return { points: { learnerId: '125', earned: 0, committed: 0, balance: 0 }, rewards: [] };
  if (url.includes('/metrics/')) return { migrated: false,
    programme: { completed: 0, total: 0, percent: null, status: 'empty' },
    ksb: { completed: 0, total: 0, percent: null, status: 'empty', codes: [] },
    otjh: { historical: 0, new: 0, actual: 0, planned: null } };
  if (url.includes('/monthly-logs/')) return {
    learner: { id: 125, aptem_id: null, name: 'Test learner', programme: 'Leadership', coach_name: '' },
    months: [], total_months: 0, completed_months: 0, read_only: false, csrf_token: 'csrf',
  };
  if (url.includes('/absence-reports/')) return { count: 0, results: [], missedSessions: [] };
  if (url.includes('/monthly-reports/')) return { reports: [], savedSignature: '', savedSignatureName: '' };
  if (url.includes('/all-students-schema/')) return { students: [] };
  if (url.includes('/evidence/') && url.includes('/historical/')) return { items: [] };
  if (url.includes('/evidence/')) return { results: [] };
  if (url.includes('/certificates/')) return { configured: false, template: null, certificate: null };
  if (url.includes('/onboarding-reviews/')) return { learner: detail(), coach: { name: '' }, reviews: [], completed: false };
  if (url.includes('/calendar-connections/')) return { connections: [], busy: [], errors: [], connectedProviders: [] };
  if (url.includes('/calendar/')) return { learner: { kind: viewer.kind, id: 125 }, events: [] };
  if (url.includes('/coach/')) return { coachName: '', coachEmail: '' };
  if (url.startsWith('/engagement_api/')) return { rewards: [], claims: [], recognitions: [], events: [], bookings: [], clubs: [], grants: [], decks: [], entries: [], earned: 0, balance: 0, committed: 0, total: 0, count: 0 };
  if (url.includes('/quizzes/') || url.startsWith('/quiz_api/')) return { id: 1, name: 'Test quiz', questions: [], passingScore: 80 };
  if (url.includes('/reviews/')) return { programme: 'Leadership', documents: [], reviews: [], sections: [], answers: {}, signatures: { learner: { signed: false }, admin: { signed: false } } };
  // Documents that have never been issued are a valid empty state.
  if (/agreement|ilr-document|training-plan-document/.test(url)) return {
    learner: detail(), agreement: null, document: null,
    particulars: { apprenticeName: 'Test learner' }, learnerDetails: {}, answers: {},
    meta: { datesFrom: '', moduleCount: 0 },
    programme: {}, employment: {}, learningPlan: [], planModules: [], otjh: {}, epa: {}, contacts: {}, delivery: {}, costs: {},
  };
  if (/wizard-bootstrap|extended-ilr/.test(url)) return { board: null, ilr: {}, ksbProfile: null };
  throw new Error(`Missing fixture for ${url}`);
}

class PageBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p data-testid="page-crash">{this.state.error}</p> : this.props.children; }
}

beforeEach(() => {
  clearAllCachedResources(); localStorage.clear(); sessionStorage.clear();
  viewer.kind = 'commercial'; viewer.role = 'learner'; rememberLearner('commercial', '125');
  vi.stubGlobal('React', React);
  // Match the production auto-imports without changing the tested components.
  for (const [key, value] of Object.entries({ ...React, ...Router, AppIcon })) {
    if (key === 'AppIcon' || key === 'React' || key.startsWith('use') || ['Link', 'Navigate', 'NavLink', 'Outlet'].includes(key)) vi.stubGlobal(key, value);
  }
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('every learner page', () => {
  it.each(Object.keys(modules).sort().flatMap(file => (['commercial', 'apprenticeship'] as const).map(kind => ({ file, kind }))))('$kind $file renders with empty server data and survives a service failure', async ({ file, kind }) => {
    viewer.kind = kind; rememberLearner(kind, '125');
    const Page = (await modules[file]()).default;
    expect(typeof Page).toBe('function');
    const pattern = routes.get(file) || '/learner/test-page';
    const path = pattern.replace(/:kind/g, kind).replace(/:id\b/g, '125').replace(/:\w+/g, '1');
    for (const fail of [false, true]) {
      cleanup(); clearAllCachedResources();
      const missing: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        // This suite is entirely offline, including any incidental POSTs.
        if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ error: 'Writes are not part of the page-read test' }), { status: 403 });
        if (fail) return new Response(JSON.stringify({ error: 'Service unavailable. Please try again.' }), { status: 503 });
        let data: unknown;
        try { data = payload(url); } catch { missing.push(url); data = {}; }
        if (url.includes('/profile-photo/')) return new Response(null, { status: 204 });
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }));
      await act(async () => {
        render(<MemoryRouter initialEntries={[path]}><ToastProvider><PageBoundary><Routes>
          <Route path={pattern} element={<Page />} /><Route path="*" element={<p>Page redirected</p>} />
        </Routes></PageBoundary></ToastProvider></MemoryRouter>);
      });
      await waitFor(() => expect(screen.queryByTestId('page-crash')?.textContent || '').toBe(''));
      await waitFor(() => expect(document.querySelector('.kbc-skeleton')).not.toBeInTheDocument());
      expect(missing, `Unmodelled reads in ${file}: ${missing.join(", ")}`).toEqual([]);
      expect(document.body.textContent?.trim()).not.toBe('');
      expect(screen.queryByLabelText('Loading page')).not.toBeInTheDocument();
    }
  });
});

async function renderLearnerPage(file: string) {
  const Page = (await modules[`/src/pages/learner/${file}/page.tsx`]()).default;
  return render(<React.StrictMode><MemoryRouter><ToastProvider><PageBoundary><Page /></PageBoundary></ToastProvider></MemoryRouter></React.StrictMode>);
}

function NavigationDestination() {
  const location=Router.useLocation();
  const navigate=Router.useNavigate();
  return <><output data-testid="navigation-destination">{location.pathname}{location.search}</output>
    <button onClick={()=>navigate(-1)}>Return to dashboard</button></>;
}

describe('learner loading and recovery', () => {
  it('uses the learner start date and Audit planned end date in the learner programme header', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/learner-summary/')) return new Response(JSON.stringify({
        ...detail(), learnerStartDate: '2026-01-10', programmeStartDate: '2026-02-01', programmeEndDate: '2027-01-31',
        learningAccess: { blocked: false, startDate: '2026-02-01' },
      }));
      if (url.includes('/training-plan-dashboard/') && url.includes('section=contract')) {
        return new Response(JSON.stringify({
          months: {}, contractStatus: 'ready',
          programmeStartDate: '2026-01-19', programmeEndDate: '2027-01-31',
        }));
      }
      if (url.includes('/monthly-logs/')) return new Response(JSON.stringify({
        learner: { id: 125, aptem_id: 7001, name: 'Test learner', programme: 'Leadership', coach_name: '', planned_end_date: '2027-10-17' },
        months: [
          { month: '2026-01', source: 'legacy', training_plan_target: 3, actual_hours: 1.5, not_accepted_hours: 0 },
          { month: '2026-09', source: 'lms', training_plan_target: 20, actual_hours: 2, not_accepted_hours: 0 },
        ],
        total_months: 2, completed_months: 0, read_only: false, csrf_token: 'csrf',
      }));
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);

    const hero = within(await screen.findByLabelText('Learner programme'));
    expect(await hero.findByText('10 January 2026')).toBeVisible();
    expect(hero.getByText('17 October 2027')).toBeVisible();
    expect(hero.queryByText('31 January 2027')).not.toBeInTheDocument();
    expect(hero.queryByText('2 February 2026')).not.toBeInTheDocument();
    const chart = within(await screen.findByRole('region', { name: 'Off-the-job hours by month' }));
    expect(await chart.findByRole('button', {
      name: 'January 2026: target 3 hours, submitted 0 hours, completed 1.5 hours',
    })).toBeVisible();
    expect(chart.getByRole('button', { name: /January 2027:/ })).toBeVisible();
    expect(chart.queryByRole('button', { name: /December 2025:/ })).not.toBeInTheDocument();
  });

  it('keeps the learning tab in the URL and follows browser Back and quiz deep links', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(payload(String(input))))));
    const Page = (await modules['/src/pages/learner/my-learning/page.tsx']()).default;
    function NavigationControls() {
      const location = Router.useLocation();
      const navigate = Router.useNavigate();
      return <><output data-testid="learning-location">{location.pathname}{location.search}</output>
        <button onClick={() => navigate(-1)}>Browser Back</button>
        <Router.Link to="/learner/quizzes/commercial/125">Quiz deep link</Router.Link></>;
    }
    render(<MemoryRouter initialEntries={['/learner/modules/commercial/125?subject=current%3AM1']}><ToastProvider>
      <Page /><NavigationControls />
    </ToastProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Assignments' }));
    expect(screen.getByTestId('learning-location')).toHaveTextContent('subject=current%3AM1&tab=assignments');
    fireEvent.click(screen.getByRole('button', { name: 'Quizzes' }));
    expect(await screen.findByText('No quizzes linked yet')).toBeVisible();
    expect(screen.getByTestId('learning-location')).toHaveTextContent('tab=quizzes');
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
    expect(screen.getByTestId('learning-location')).toHaveTextContent('tab=assignments');
    expect(screen.queryByText('No quizzes linked yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Quiz deep link' }));
    expect(await screen.findByText('No quizzes linked yet')).toBeVisible();
  });

  it('opens newly assigned work from the My Learning Assignments tab without prior submissions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-detail/') ? { ...detail(), modules: ['Project'], components: [
        { componentId: 'NEW-ASSIGNMENT', moduleId: 'M1', module: 'Project', week: 'Week 1', component: 'Assigned project report',
          type: 'assignment', assignmentBrief: 'Describe the project results.', expectedOtjh: 2 },
      ] } : payload(url)));
    }));
    const Page = (await modules['/src/pages/learner/my-learning/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Routes>
      <Route path="/" element={<Page />} /><Route path="*" element={<NavigationDestination />} />
    </Routes></ToastProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Assignments' }));
    const start = await screen.findByRole('link', { name: 'Start assignment' });
    expect(screen.getByText('Assigned project report')).toBeVisible();
    fireEvent.click(start);
    expect(screen.getByTestId('navigation-destination')).toHaveTextContent('/learner/monthly-submission/commercial/125/NEW-ASSIGNMENT');
  });

  it.each([false,true])('uses current placement facts and opens the focused module and weekly plan (imported subject: %s)', async imported => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-12T12:00:00Z'));
    const placement={programme:'Marketing Level 4',cohort:'October 2026',group:'G1'};
    const module=(id:string,title:string,start_date:string,end_date:string,changes={})=>({id,title,start_date,end_date,
      programme_name:placement.programme,cohort_name:placement.cohort,group_name:placement.group,description:'',tutor_name:'',coach_name:'Omar',...changes});
    let plan={...(payload('/training-plan-dashboard/') as Record<string,unknown>),
      moduleLinks:imported?{'legacy:77':{id:'marketing',title:'Marketing Impact and Planning'}}:{},
      coach:{name:'Omar Elshafey',bookingUrl:null},modules:[
      module('social','Social Media','2027-02-15','2027-05-20'),
      module('old','Aya Modual','2026-08-03','2026-10-23',{cohort_name:'Final Cohort',group_name:'Aya Group',coach_name:'Test Coach'}),
      module('marketing','Marketing Impact and Planning','2026-10-05','2027-02-11'),
    ]};
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/') ? {...detail(),...placement}
        : url.includes('/training-plan-dashboard/') ? plan
        : url.includes('/overview-week/') ? {...(payload(url) as Record<string,unknown>),latestModuleId:'current:social',modules:[{id:'current:social',title:'Social Media',weekLabels:[],completed:0,total:0,percent:null,ksbCodes:[],ksbMappingMissing:false}]}
        : payload(url)));
    }));
    const Page=(await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Routes>
      <Route path="/" element={<Page />} /><Route path="*" element={<NavigationDestination />} />
    </Routes></ToastProvider></MemoryRouter>);
    const hero=within(await screen.findByLabelText('Learner programme'));
    expect(await hero.findByRole('link', { name: 'Marketing Impact and Planning' })).toBeVisible();
    expect(hero.getByText('Next module')).toBeVisible();
    expect(hero.getByText('Omar Elshafey')).toBeVisible();
    expect(hero.queryByText('Social Media')).not.toBeInTheDocument();
    expect(hero.queryByText('Test Coach')).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/coach/'))).toBe(false);
    plan={...plan,coach:{name:'Replacement coach',bookingUrl:null},modules:plan.modules.map(item=>item.id==='marketing'?{...item,start_date:'2026-09-10'}:item)};
    act(()=>invalidateLearnerReads());
    expect(await hero.findByText('Replacement coach')).toBeVisible();
    expect(hero.getByText('Current module')).toBeVisible();
    fireEvent.click(hero.getByRole('button',{name:'Continue learning'}));
    expect(screen.getByTestId('navigation-destination')).toHaveTextContent(
      `/learner/my-learning/commercial/125?subject=${imported?'legacy%3A77':'current%3Amarketing'}&week=current`);
    fireEvent.click(screen.getByRole('button',{name:'Return to dashboard'}));
    const returnedHero=within(await screen.findByLabelText('Learner programme'));
    fireEvent.click(returnedHero.getByRole('button',{name:"Learner's Map"}));
    expect(screen.getByTestId('navigation-destination')).toHaveTextContent('/learner/learning-plan/modules/commercial/125');
  });

  it.each([
    { present: 8, sessions: 10, fail: false, caption: '80% attendance', rate: '80' },
    { present: 1, sessions: 3, fail: false, caption: '67% attendance', rate: '67' },
    { present: 0, sessions: 3, fail: false, caption: '0% attendance', rate: '0' },
    { present: 0, sessions: 0, fail: false, caption: 'No attendance records yet', rate: null },
    { present: null, sessions: null, fail: true, caption: 'Attendance unavailable', rate: null },
  ])('shows attendance counts and rate without a fixed target ($caption)', async ({ present, sessions, fail, rate }) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/attendance/')) return new Response(JSON.stringify(fail
        ? { error: 'Attendance unavailable' }
        : { attendance: sessions ? { present, sessions, attendanceRate: Number(rate) } : null }), { status: fail ? 503 : 200 });
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    const card = within(await screen.findByRole('link', { name: 'Open Attendance' }));
    expect(await card.findByText(present == null || sessions == null ? '--' : `${present} / ${sessions}`, { selector: 'p' })).toBeVisible();
    expect(card.getByText('Attended').nextElementSibling).toHaveTextContent(present == null ? '--' : String(present));
    expect(card.getByText('Sessions to date').nextElementSibling).toHaveTextContent(sessions == null ? '--' : String(sessions));
    expect(card.queryByText('Target')).not.toBeInTheDocument();
    expect(card.queryByText('90%')).not.toBeInTheDocument();
    if (rate == null) expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    else expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', rate);
  });

  it.each([0, 12])('shows KSB progress as unavailable when activity mappings are incomplete (%s known)', async (known) => {
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/metrics/')) return new Response(JSON.stringify({
        ...(payload(url) as Record<string, unknown>),
        ksb: { completed: null, total: null, percent: null, status: 'unavailable',
          reason: 'activity_points_missing', mappedCompleted: known, mappedTotal: 20, unmappedActivities: 3 },
      }));
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    const card = within(await screen.findByRole('link', { name: 'Open KSB Progress' }));
    await waitFor(() => expect(card.getByText('Current').nextElementSibling).toHaveTextContent('--'));
    expect(card.getByText('--', { selector: 'p' })).toBeVisible();
    expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(card.queryByText('Target')).not.toBeInTheDocument();
    expect(card.queryByText('100%')).not.toBeInTheDocument();
  });

  it('keeps programme and KSB metrics while using Monthly Logs for completed hours', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/overview-week/')) return new Response(JSON.stringify({
        ...(payload(url) as Record<string, unknown>),
        metrics: {
          migrated: false,
          programme: { completed: 1, total: 1, percent: 100, status: 'available' },
          ksb: { completed: 1, total: 1, percent: 100, status: 'available', codes: [] },
          otjh: { historical: 10, new: 62.7, actual: 72.7, completed_actual: 15, planned: 533.75 },
        },
      }));
      if (url.includes('/metrics/')) return new Response(JSON.stringify({
        migrated: false,
        programme: { completed: 36, total: 307, percent: 11.73, status: 'available' },
        ksb: { completed: 14, total: 32, percent: 43.75, status: 'available', codes: [] },
        otjh: { historical: 10, new: 62.7, actual: 72.7, completed_actual: 15, planned: 527.75 },
      }));
      if (url.includes('/monthly-logs/')) return new Response(JSON.stringify({
        ...(payload(url) as Record<string, unknown>),
        months: [{ month: '2026-09', actual_hours: 12.5, not_accepted_hours: 8 }],
      }));
      if (url.includes('section=contract')) return new Response(JSON.stringify({
        contractStatus: 'ready', months: { '2026-09': { planned: 50, label: '', topics: [], source: 'contract', activities: [] } },
      }));
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);

    const programme = within(await screen.findByRole('link', { name: 'Open Programme Progress' }));
    await waitFor(() => expect(programme.getByText('Current').nextElementSibling).toHaveTextContent('11.73%'));
    expect(programme.getByText('36 / 307', { selector: 'p' })).toBeVisible();

    const otjh = within(screen.getByRole('link', { name: 'Open OTJ Hours' }));
    await waitFor(() => expect(otjh.getByText('Actual').nextElementSibling).toHaveTextContent('12.50 h'));
    expect(otjh.getByText('Planned hours').nextElementSibling).toHaveTextContent('50.00 h');
    expect(otjh.getByText('12.50 / 50.00 h', { selector: 'p' })).toBeVisible();
    expect(otjh.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');

    const ksb = within(screen.getByRole('link', { name: 'Open KSB Progress' }));
    expect(ksb.getByText('Current').nextElementSibling).toHaveTextContent('43.75%');
    expect(ksb.getByText('14 / 32', { selector: 'p' })).toBeVisible();

    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests.filter(url => url.includes('/overview-week/'))).toHaveLength(1);
    expect(requests.some(url => url.includes('section=dashboard'))).toBe(false);
    expect(requests.filter(url => url.includes('/metrics/'))).toHaveLength(1);
  });

  it.each(['logs', 'pdf'])('keeps the card aligned with Monthly Logs when the %s source fails', async (failed) => {
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/monthly-logs/')) return new Response(JSON.stringify(failed === 'logs'
        ? { error: 'Logs unavailable' }
        : { ...(payload(url) as Record<string, unknown>), months: [{ month: '2026-09', actual_hours: 5, not_accepted_hours: 9 }] }), { status: failed === 'logs' ? 503 : 200 });
      if (url.includes('section=contract')) return new Response(JSON.stringify(failed === 'pdf'
        ? { error: 'PDF unavailable' }
        : { contractStatus: 'ready', months: { '2026-09': { planned: 50, label: '', topics: [], source: 'contract', activities: [] } } }), { status: failed === 'pdf' ? 503 : 200 });
      if (url.includes('/metrics/')) return new Response(JSON.stringify({
        ...(payload(url) as Record<string, unknown>), otjh: { historical: 400, actual: 500, new: 100, planned: 600, completed_actual: 402 },
      }));
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    const card = within(await screen.findByRole('link', { name: 'Open OTJ Hours' }));
    await waitFor(() => expect(card.getByText('Actual').nextElementSibling).toHaveTextContent(failed === 'logs' ? 'Unavailable' : '5.00 h'));
    await waitFor(() => expect(card.getByText('Planned hours').nextElementSibling).toHaveTextContent(failed === 'pdf' ? 'Unavailable' : '50.00 h'));
    if (failed === 'pdf') expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('uses Monthly Logs even when the legacy metrics value differs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/metrics/')) return new Response(JSON.stringify({
        ...(payload(url) as Record<string, unknown>),
        migrated: true, aptem_planned_total: 410,
        otjh: { historical: 400, actual: 500, new: 100, planned: 600, completed_actual: 999 },
      }));
      if (url.includes('/monthly-logs/')) return new Response(JSON.stringify({
        learner: { id: 125, aptem_id: 7001, name: 'Test learner', programme: 'Leadership', coach_name: '' },
        months: [{ month: '2026-09', source: 'lms', training_plan_target: 30, actual_hours: 2.5, not_accepted_hours: 0 }],
        total_months: 1, completed_months: 0, read_only: false, csrf_token: 'csrf',
      }));
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    const card = within(await screen.findByRole('link', { name: 'Open OTJ Hours' }));
    await waitFor(() => expect(card.getByText('Actual').nextElementSibling).toHaveTextContent('2.50 h'));
    await waitFor(() => expect(card.getByText('Planned hours').nextElementSibling).toHaveTextContent('410.00 h'));
    expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('uses the accepted Monthly Logs total across retained and LMS months', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/metrics/')) return new Response(JSON.stringify({
        migrated: true, aptem_planned_total: 410,
        programme: { completed: 36, total: 307, percent: 11.73, status: 'available' },
        ksb: { completed: 14, total: 32, percent: 43.75, status: 'available', codes: [] },
        otjh: { historical: 294.63, new: 0, actual: 294.63, completed_actual: 297.13, planned: 353 },
      }));
      if (url.includes('/monthly-logs/')) return new Response(JSON.stringify({
        learner: { id: 125, aptem_id: 7001, name: 'Test learner', programme: 'Leadership', coach_name: '' },
        months: [
          { month: '2026-08', source: 'legacy', training_plan_target: 30, actual_hours: 18, not_accepted_hours: 0 },
          { month: '2026-09', source: 'lms', training_plan_target: 30, actual_hours: 2.5, not_accepted_hours: 4 },
        ],
        total_months: 2, completed_months: 1, read_only: false, csrf_token: 'csrf',
      }));
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);

    const otjh = within(await screen.findByRole('link', { name: 'Open OTJ Hours' }));
    await waitFor(() => expect(otjh.getByText('Actual').nextElementSibling).toHaveTextContent('20.50 h'));
    expect(otjh.getByText('Planned hours').nextElementSibling).toHaveTextContent('410.00 h');
  });

  it('shows unavailable header facts when the schedule fails instead of claiming the coach is unassigned', async () => {
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      return url.includes('/training-plan-dashboard/')
        ? new Response(JSON.stringify({error:'Plan unavailable'}),{status:503})
        : new Response(JSON.stringify(payload(url)));
    }));
    const Page=(await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    const hero=within(await screen.findByLabelText('Learner programme'));
    expect((await hero.findAllByText('Unavailable')).length).toBeGreaterThanOrEqual(2);
    expect(hero.queryByText('Not yet assigned')).not.toBeInTheDocument();
  });

  it('opens the exact review booking form from the dashboard Schedule action without submitting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url=String(input);
      return new Response(JSON.stringify(url.includes('/calendar/commercial/125/')
        ? {learner:{kind:'commercial',id:125},events:[{
          id:'monthly-1',eventKey:'mcr:211:1:2026-10-31',title:'Monthly Coaching',source:'mcr',type:'coaching',sequence:1,
          status:'not-scheduled',date:'2026-10-31',targetDate:'2026-10-31',scheduledDate:null,scheduledTime:null,
          durationMinutes:60,coachName:'Assigned coach',coachEmail:'coach@example.test',meetingProvider:'',meetingLink:'',notes:'',invited:false,
        }]}
        : payload(url)));
    }));
    const Page=(await modules['/src/pages/learner/calendar/page.tsx']()).default;
    render(<MemoryRouter initialEntries={['/learner/calendar?kind=commercial&learner=125&event=mcr%3A211%3A1%3A2026-10-31&action=schedule']}>
      <ToastProvider><Page /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading',{name:'Schedule Monthly Coaching Meeting'})).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.some(([,init])=>init?.method && init.method!=='GET')).toBe(false);
  });

  it('shows an assigned programme and plan before cohort start with study open', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), name: 'Ayman Learner', programme: 'Marketing Executive Level 4', cohort: 'October 2026',
          programmeStatus: 'Delivery', programmeStartDate: '2026-10-01',
          learningAccess: { blocked: true, startDate: '2026-10-01' },
          accessGate: { blocked: true, reasons: ['start-date-future'], startDate: '2026-10-01', outstandingDocuments: [] } }
        : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Ayman Learner' })).toBeVisible();
    expect(screen.getByText('Your programme starts on 1 October 2026')).toBeVisible();
    expect(screen.getByText('Marketing Executive Level 4', { exact: false })).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Monthly study plan' })).toBeVisible();
    // The upcoming date is a notice, not a lock: the learner can study now.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue learning' })).toBeEnabled());
    expect(screen.queryByText('Your programme starts soon')).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
  });

  it('opens learning using the cohort date even when the individual date and saved status are still in the future', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), programmeStatus: 'Delivery', programmeStartDate: '2026-10-01',
          learningAccess: { blocked: false, startDate: '2026-09-10' },
          accessGate: { blocked: true, reasons: ['start-date-future'], startDate: '2026-10-01', outstandingDocuments: [] } }
        : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await waitFor(()=>expect(screen.getByRole('button', { name: 'Continue learning' })).toBeEnabled());
    expect(screen.getByText('10 September 2026')).toBeVisible();
    expect(screen.queryByText('1 October 2026')).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Monthly study plan' })).toBeVisible();
  });

  it.each(['admin', 'staff'])('lets %s review a prepared learner before any invitation, with no historical learning', async role => {
    viewer.role = role;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), programmeStatus: 'Delivery', isActive: false, studentActivityAvailable: false,
          programmeStartDate: '2025-10-01', accessGate: {
            blocked: true, reasons: ['invitation'], startDate: '2025-10-01', outstandingDocuments: [],
          } }
        : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter initialEntries={['/workspace/learner/commercial/125']}><ToastProvider><Routes>
      <Route path="/workspace/learner/:kind/:id" element={<Page />} />
    </Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(await screen.findByText('Ready to invite')).toBeVisible();
    expect(screen.queryByText('Your start date has not been set yet')).not.toBeInTheDocument();
    await waitFor(() => {
      const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      for (const endpoint of ['/attendance/', '/overview-week/', '/training-plan-dashboard/']) {
        expect(requests.some(url => url.includes(endpoint))).toBe(true);
      }
    });
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
  });

  it.each(['admin', 'learner'])('shows the Dashboard for %s viewing imported learning before the new programme starts', async role => {
    viewer.role = role;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), programmeStatus: 'Delivery', studentActivityAvailable: true, programmeStartDate: null,
          accessGate: { blocked: true, reasons: ['start-date-missing'], startDate: '', outstandingDocuments: [] } }
        : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    const path = role === 'admin' ? '/workspace/learner/commercial/125' : '/workspace/learner';
    render(<MemoryRouter initialEntries={[path]}><ToastProvider><Routes>
      <Route path="/workspace/learner/:kind?/:id?" element={<Page />} />
    </Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await waitFor(() => {
      const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      expect(requests.some(url => url.includes('/metrics/'))).toBe(true);
      expect(requests.some(url => url.includes('/attendance/'))).toBe(true);
      expect(requests.some(url => url.includes('/overview-week/'))).toBe(true);
    });
    expect(screen.queryByText('Your start date has not been set yet')).not.toBeInTheDocument();
  });

  it('gives a commercial learner their dashboard even with no start date confirmed', async () => {
    // An unconfirmed start date is still only a date: it no longer replaces the
    // workspace with a waiting page, just a notice that the date is pending.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), programmeStatus: 'Delivery', programmeStartDate: null,
          accessGate: { blocked: true, reasons: ['start-date-missing'], startDate: '', outstandingDocuments: [] } }
        : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Your start date has not been set yet' })).not.toBeInTheDocument();
  });

  it('keeps the waiting page for a commercial learner whose learning plan is not assigned yet', async () => {
    // Not a date: there is genuinely no plan behind the workspace to open.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), programmeStatus: 'Delivery', programmeStartDate: null,
          accessGate: { blocked: true, reasons: ['plan'], startDate: '', outstandingDocuments: [] } }
        : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Your learning plan is being prepared' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests.filter(url => /\/metrics\/|\/attendance\/|\/overview-week\//.test(url))).toEqual([]);
  });

  it('keeps a super-admin learner preview on Dashboard even during onboarding', async () => {
    viewer.role = 'admin'; viewer.kind = 'apprenticeship';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), programmeStatus: 'Onboarding' } : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter initialEntries={['/workspace/learner/apprenticeship/125']}><ToastProvider><Routes>
      <Route path="/workspace/learner/:kind/:id" element={<Page />} />
      <Route path="/learner/onboarding" element={<h1>Onboarding destination</h1>} />
    </Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Onboarding destination' })).not.toBeInTheDocument();
    viewer.role = 'learner';
  });
  it('loads all dashboard cards without requesting full learner detail or historical activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/learner-detail|student-activity|subject-covers/.test(url)) throw new Error('Dashboard must not load lesson graphs');
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    await waitFor(() => {
      const paths = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
      expect(paths.some(url => url.includes('/metrics/'))).toBe(true);
      expect(paths.some(url => url.includes('/attendance/'))).toBe(true);
      expect(paths.some(url => url.includes('/overview-week/'))).toBe(true);
      expect(paths.some(url => url.includes('/training-plan-dashboard/'))).toBe(true);
    });
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Test learner' })).toBeVisible();
    await screen.findByRole('region', { name: 'Monthly study plan' });
    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests.filter(url => /learner-detail|student-activity|subject-covers/.test(url))).toEqual([]);
    expect(requests.filter(url => url.includes('overview-week'))).toHaveLength(1);
    expect(requests.some(url => url.includes('section=dashboard'))).toBe(false);
    expect(requests.filter(url => url.includes('section=overview'))).toHaveLength(1);
    expect(screen.queryByTestId('page-crash')).not.toBeInTheDocument();
  });
  it('ignores an old evidence response after navigating to another learner', async () => {
    let finish!: (response: Response) => void;
    let finishHistory!: (response: Response) => void;
    const old = new Promise<Response>(resolve => { finish = resolve; });
    const oldHistory = new Promise<Response>(resolve => { finishHistory = resolve; });
    const record = (id: string) => ({ id, filename: `Evidence-${id}.pdf`, contentType: 'application/pdf', sizeBytes: 20,
      status: 'approved', sectionRef: '', uploadedAt: null, scanResult: null, trainingPlanDetails: null });
    const previous = (id: string) => ({ id: `aptem:${id}`, source: 'aptem', source_id: Number(id), name: `Previous-${id}.docx`,
      component_name: 'Leadership', category: 'assignment', status: 'Accepted', date: '2026-08-10', otjh_hours: 2, ksb_codes: [] });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/evidence/commercial/125/historical/')) return oldHistory;
      if (url.includes('/evidence/commercial/126/historical/')) return new Response(JSON.stringify({ items: [previous('126')] }));
      if (url.includes('/evidence/commercial/125/')) return old;
      if (url.includes('/evidence/commercial/126/')) return new Response(JSON.stringify({ results: [record('126')] }));
      return new Response(JSON.stringify(payload(url)));
    }));
    const Page = (await modules['/src/pages/learner/evidence/page.tsx']()).default;
    function NextLearner() {
      const navigate = Router.useNavigate();
      return <button onClick={() => navigate('/learner/evidence/commercial/126')}>Next learner</button>;
    }
    render(<MemoryRouter initialEntries={['/learner/evidence/commercial/125']}><ToastProvider><PageBoundary>
      <NextLearner /><Routes><Route path="/learner/evidence/:kind/:id" element={<Page />} /></Routes>
    </PageBoundary></ToastProvider></MemoryRouter>);
    fireEvent.click(screen.getByText('Next learner'));
    fireEvent.click(await screen.findByRole('button', { name: 'Expand all months' }));
    expect(await screen.findByText('Evidence-126.pdf')).toBeInTheDocument();
    expect(await screen.findByText('Previous-126.docx')).toBeInTheDocument();
    await act(async () => {
      finish(new Response(JSON.stringify({ results: [record('125')] })));
      finishHistory(new Response(JSON.stringify({ items: [previous('125')] })));
    });
    expect(screen.queryByText('Evidence-125.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous-125.docx')).not.toBeInTheDocument();
    expect(screen.getByText('Previous-126.docx')).toBeInTheDocument();
    expect(screen.getByText('Evidence-126.pdf')).toBeInTheDocument();
  });

  it.each([
    { file: 'attendance', optional: '/absence-reports/', visible: 'No lectures yet' },
    { file: 'profile', optional: '/attendance/', visible: 'Personal details' },
  ])('$file displays core data while its optional request is still pending', async ({ file, optional, visible }) => {
    let finish!: (response: Response) => void;
    const slow = new Promise<Response>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes(optional)
      ? slow : new Response(JSON.stringify(payload(String(input))))));
    await renderLearnerPage(file);
    expect(await screen.findByText(visible)).toBeInTheDocument();
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.length).toBe(new Set(urls).size);
    await act(async () => finish(new Response(JSON.stringify({ error: 'Optional service failed' }), { status: 503 })));
    expect(screen.getByText(visible)).toBeInTheDocument();
    expect(screen.queryByTestId('page-crash')).not.toBeInTheDocument();
  });

  it('recovers attendance with Try again after the server comes back', async () => {
    let failed = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      failed && String(input).includes('/attendance/')
        ? new Response(JSON.stringify({ error: 'Attendance unavailable' }), { status: 503 })
        : new Response(JSON.stringify(payload(String(input))))));
    await renderLearnerPage('attendance');
    expect(await screen.findByText('Attendance unavailable')).toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('No lectures yet')).toBeInTheDocument();
    expect(screen.queryByText('Attendance unavailable')).not.toBeInTheDocument();
  });
});
