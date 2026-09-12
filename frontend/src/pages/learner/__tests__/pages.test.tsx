import * as React from 'react';
import { Component, type ReactNode, type ComponentType } from 'react';
import * as Router from 'react-router-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppIcon } from '@/components/feature/AppIcon';
import { ToastProvider } from '@/hooks/useToast';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { rememberLearner } from '@/hooks/useMyLearner';

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
const config = readFileSync(resolve('src/router/config.tsx'), 'utf8');
const components = new Map([...config.matchAll(/const (\w+) = lazyRoute\(\(\) => import\("(\.\.\/pages\/(?:learner|workspace\/learner)\/[^"\n]+)"\)\)/g)]
  .map(match => [match[1], match[2].replace('../pages/', '/src/pages/') + '.tsx']));
const routes = new Map<string, string>();
for (const match of config.matchAll(/path:\s*"([^"]+)"\s*,\s*element:\s*<(\w+)/g)) {
  const file = components.get(match[2]);
  if (file && (!routes.has(file) || match[1].includes(':kind'))) routes.set(file, match[1]);
}

const detail = () => ({ id: '125', name: 'Test learner', email: 'learner@example.test', phone: '',
  learnerType: viewer.kind, programme: 'Leadership', programmeStatus: 'Active', cohort: '', group: '', employer: '',
  lineManager: '', isActive: true, modules: [], week: [], components: [], ksbs: [], quizAttempts: [], videoProgress: [],
  componentProgress: [], activityFeed: [], totalExpectedOtjh: 0, studentActivityAvailable: false });

function payload(url: string): unknown {
  if (url.includes('/profile-photo/')) return null;
  if (url.includes('/overview-week/')) return { weekStart: '2026-09-07', weekEnd: '2026-09-13', timezone: 'Europe/London', planSubjects: [], modules: [], deadlines: [], undatedActivities: 0, expectedHours: null, missingExpectedHours: 0, otjh: { actual: 0, historical: 0, new: 0, undatedHistoricalRows: 0 } };
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
  if (url.includes('/metrics/')) return { migrated: false,
    programme: { completed: 0, total: 0, percent: null, status: 'empty' },
    ksb: { completed: 0, total: 0, percent: null, status: 'empty', codes: [] },
    otjh: { historical: 0, new: 0, actual: 0, planned: null } };
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

describe('learner loading and recovery', () => {
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
      for (const endpoint of ['/metrics/', '/attendance/', '/overview-week/', '/training-plan-dashboard/']) {
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

  it('keeps the waiting page for a commercial learner without previous learning before programme start', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/learner-summary/')
        ? { ...detail(), programmeStatus: 'Delivery', programmeStartDate: null,
          accessGate: { blocked: true, reasons: ['start-date-missing'], startDate: '', outstandingDocuments: [] } }
        : payload(url)));
    }));
    const Page = (await modules['/src/pages/workspace/learner/page.tsx']()).default;
    render(<MemoryRouter><ToastProvider><Page /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Your start date has not been set yet' })).toBeVisible();
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
