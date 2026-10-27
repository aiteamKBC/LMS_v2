import { StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import MyLearningPage from './page';
import { useMyLearningSearch, useMyLearningCatalogue, useMyLearningModule, myLearningCatalogue, type MyLearningCatalogue } from '@/api/myLearning';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import { buildUnifiedLearningSummary } from './learningSummary';
import type { LearnerDetail } from '@/api/learnerDetail';
import contractFixture from '@/test/myLearningFixtures.json';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { role: 'staff', id: 1 } }, isInitialized: true }) }));
vi.mock('@/hooks/useMyLearner', () => ({ useResolvedLearner: (kind: string, id: string) => ({ kind, id }) }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: false, showReadOnlyNotice: false }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.stubGlobal('AppIcon', () => <span />);

const makeCatalogue = (kind: 'commercial' | 'apprenticeship' = 'commercial', id = '7'): MyLearningCatalogue => ({
  learner: { id, kind, name: 'Synthetic learner', programme: 'Programme', cohort: '', group: '' },
  summary: { current: { subjects: 1, total: 2, completed: 1, percent: 50 }, previous: { subjects: 1, total: 3, completed: 1, percent: 33.33 }, subjectCount: 2 },
  modules: [{ id: 'current:M1', title: 'One', source: 'current', moduleId: 'M1', activityCount: 2, completedActivityCount: 1, progress: 50,
    status: 'In progress', nextTitle: 'Final test', finalTestPassed: false, actualHours: 1,
    planModule: { start_date: '2026-01-01', end_date: '2026-12-31', tutor_name: 'Tutor', total_otjh: 10, educational_session_count: 2 } },
    { id: 'legacy:50', title: 'Old', source: 'legacy', activityCount: 3, completedActivityCount: 1, progress: 33.33,
      status: 'In progress', finalTestPassed: false, actualHours: 2 }],
  otjh: { actual: 3, planned: 10 }, upcoming: [], hasMoreUpcoming: false,
});
const makeModule = (subject = 'current:M1', id = '7') => ({ subjectId: subject,
  detail: { id, name: 'Synthetic learner', programme: 'Programme', modules: ['One'], week: [], components: [{
    componentId: 'C1', moduleId: 'M1', module: 'One', component: 'Quiet lesson', type: 'reading', contentAvailable: false }], quizAttempts: [], componentProgress: [], videoProgress: [] },
  activity: null, metadata: { covers: {}, current_subjects: [{ id: 'M1', title: 'One' }], builder_subjects: {} },
  schedule: { modules: [], moduleLinks: {}, generatedAt: '' }, sessions: [] });
const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
const reply = (data: unknown) => new Response(JSON.stringify(data));
function route(path = '/learner/my-learning/commercial/7') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/learner/my-learning/:kind/:id" element={<MyLearningPage />} />
  </Routes></MemoryRouter></StrictMode>);
}
beforeEach(() => {
  clearAllCachedResources();
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = String(input);
    if (url.includes('/search/')) return reply({ matches: [{ id: 'current:M1' }], nextOffset: null });
    if (url.includes('/certificates/')) return reply({ template: null, csrfToken: '' });
    if (/\/my-learning\/(commercial|apprenticeship)\/7\/$/.test(url)) return reply(makeCatalogue(url.includes('/apprenticeship/') ? 'apprenticeship' : 'commercial'));
    if (url.includes('/modules/')) return reply(makeModule());
    throw new Error(`Unexpected API request: ${url}`);
  }));
});
afterEach(() => { clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('compact My Learning route', () => {
  it.each(['commercial', 'apprenticeship'] as const)('shows each module cohort independently of the learner cohort (%s)', async kind => {
    const catalogue = makeCatalogue(kind);
    catalogue.learner.cohort = 'Account cohort';
    catalogue.modules[0].planModule!.cohort_name = 'October 2026';
    catalogue.modules.push({ ...catalogue.modules[0], id: 'current:M2', moduleId: 'M2', title: 'Two',
      planModule: { ...catalogue.modules[0].planModule, cohort_name: 'February 2026' } });
    vi.mocked(fetch).mockImplementation(async input => reply(String(input).includes('/certificates/')
      ? { template: null, csrfToken: '' } : catalogue));
    route(`/learner/my-learning/${kind}/7`);
    await screen.findByRole('heading', { name: 'One' });
    const cards = new Map(screen.getAllByRole('heading', { level: 3 }).map(heading => [heading.textContent, heading.closest('article')!]));
    const card = (title: string) => cards.get(title)!;
    expect(card('One')).toHaveTextContent('Cohort: October 2026');
    expect(card('Two')).toHaveTextContent('Cohort: February 2026');
    expect(card('Old')).toHaveTextContent('Cohort: Not available');
    expect(card('One')).not.toHaveTextContent('Account cohort');
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    expect(within(card('One')).getByText('October 2026')).toBeVisible();
    expect(within(card('Two')).getByText('February 2026')).toBeVisible();
  });

  it('retries a failed initial catalogue read and replaces the error with real subjects', async () => {
    let failed = true;
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('/certificates/')
      ? reply({ template: null, csrfToken: '' })
      : failed ? new Response(JSON.stringify({ error: 'Could not load your learning. Please try again.' }), { status: 400 })
        : reply(makeCatalogue()));
    route();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load your learning. Please try again.')).toBeVisible();
    failed = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'One' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['commercial', 'apprenticeship'])('uses one catalogue read for %s and preserves the visible module UI', async kind => {
    route(`/learner/my-learning/${kind}/7`);
    await screen.findByRole('heading', { name: 'One' });
    expect(urls().filter(url => url.includes('/my-learning/'))).toEqual([`/learner_api/my-learning/${kind}/7/`]);
    expect(urls().filter(url => url.includes('/certificates/'))).toHaveLength(1);
    expect(urls().some(url => /learner-detail|student-activity|subject-covers|metrics|training-plan-dashboard/.test(url))).toBe(false);
    expect(screen.getByText('1 of 2 activities completed')).toBeVisible();
    expect(screen.getByText(/1 of 3 previous activities completed/)).toBeVisible();
    expect(within(screen.getByRole('navigation', { name: 'My Learning section' })).getByRole('button', { name: 'Modules' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quizzes' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Assignments' })).toBeVisible();
    const requests = urls().length;
    fireEvent.change(screen.getByRole('textbox', { name: 'Search modules or activities' }), { target: { value: 'Quiet lesson' } });
    expect(await screen.findByRole('heading', { name: 'One' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Old' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'progress' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'started' } });
    expect(urls()).toHaveLength(requests + 1);
    expect(urls().filter(url => url.includes('/search/'))).toHaveLength(1);
  });

  it('renders cached cards immediately while a refresh preserves search and publishes new totals atomically', async () => {
    await myLearningCatalogue.read('commercial', '7');
    route();
    expect(screen.getByRole('heading', { name: 'One' })).toBeVisible();
    const search = screen.getByRole('textbox', { name: 'Search modules or activities' });
    fireEvent.change(search, { target: { value: 'Quiet lesson' } });
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('/certificates/')
      ? reply({ template: null, csrfToken: '' }) : new Promise(resolve => { finish = resolve; }));
    act(() => invalidateLearnerReads());
    expect(screen.getByText('1 of 2 activities completed')).toBeVisible();
    expect(search).toHaveValue('Quiet lesson');
    const updated = makeCatalogue();
    updated.summary.current = { subjects: 1, total: 3, completed: 2, percent: 66.67 };
    updated.modules[0] = { ...updated.modules[0], activityCount: 3, completedActivityCount: 2, progress: 66.67 };
    await act(async () => finish(reply(updated)));
    expect(screen.getByText('2 of 3 activities completed')).toBeVisible();
    expect(search).toHaveValue('Quiet lesson');
    expect(screen.queryByText('1 of 2 activities completed')).not.toBeInTheDocument();
  });

  it('retains complete saved cards and exposes a genuine refresh failure', async () => {
    route();
    await screen.findByRole('heading', { name: 'One' });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Catalogue refresh unavailable' }), { status: 400 }));
    act(() => invalidateLearnerReads());
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalogue refresh unavailable');
    expect(screen.getByRole('heading', { name: 'One' })).toBeVisible();
    expect(screen.getByText('1 of 2 activities completed')).toBeVisible();
  });

  it.each(['current-only', 'legacy-only', 'mixed'])('keeps %s counts and source filters', async variant => {
    const fixture = makeCatalogue();
    if (variant === 'current-only') {
      fixture.modules = fixture.modules.filter(card => card.source === 'current');
      fixture.summary.previous = { subjects: 0, total: 0, completed: 0, percent: 0 };
      fixture.summary.subjectCount = 1;
    } else if (variant === 'legacy-only') {
      fixture.modules = fixture.modules.filter(card => card.source === 'legacy');
      fixture.summary.current = { subjects: 0, total: 0, completed: 0, percent: 0 };
      fixture.summary.subjectCount = 1;
    }
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('/certificates/') ? reply({ template: null, csrfToken: '' }) : reply(fixture));
    route();
    await screen.findByRole('heading', { name: variant === 'legacy-only' ? 'Old' : 'One' });
    expect(screen.getByText(`${fixture.summary.current.completed} of ${fixture.summary.current.total} activities completed`)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Old LMS' }));
    expect(screen.queryByRole('heading', { name: 'One' })).not.toBeInTheDocument();
    if (variant !== 'current-only') expect(screen.getByRole('heading', { name: 'Old' })).toBeVisible();
  });

  it('decodes the production-generated shared JSON contracts and launches the selected reading', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('/certificates/')
      ? reply({ template: null, csrfToken: '' }) : String(input).includes('/modules/')
        ? reply(contractFixture.module) : reply(contractFixture.catalogue));
    route();
    fireEvent.click(await screen.findByRole('button', { name: /New LMS.*Example module.*Open subject/ }));
    await waitFor(() => expect(urls().filter(url => url.includes('/modules/'))).toHaveLength(1));
    expect(urls().find(url => url.includes('/modules/'))).toContain('current%3AM1');
  });

  it('loads only the opened module and reuses its cache on revisits', async () => {
    route();
    fireEvent.click(await screen.findByRole('button', { name: /New LMS.*One.*Open subject/ }));
    await screen.findByRole('button', { name: 'All subjects' });
    expect(urls().filter(url => url.includes('/modules/'))).toEqual(['/learner_api/my-learning/commercial/7/modules/current%3AM1/']);
    expect(urls().some(url => /learner-detail|student-activity|subject-covers|metrics|training-plan-dashboard/.test(url))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'All subjects' }));
    fireEvent.click(await screen.findByRole('button', { name: /New LMS.*One.*Open subject/ }));
    await screen.findByRole('button', { name: 'All subjects' });
    expect(urls().filter(url => url.includes('/modules/'))).toHaveLength(1);
  });

  it('shows an invalid module error without falling back to unrelated content', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('/modules/')
      ? new Response(JSON.stringify({ error: 'Module not found in this learner plan.' }), { status: 404 })
      : reply(makeCatalogue()));
    route('/learner/my-learning/commercial/7?subject=current%3AFOREIGN');
    expect(await screen.findByRole('alert')).toHaveTextContent('Module not found');
    expect(screen.queryByRole('heading', { name: 'One' })).not.toBeInTheDocument();
  });

  it('refreshes the catalogue and open module after progress invalidation', async () => {
    route('/learner/my-learning/commercial/7?subject=current%3AM1');
    await screen.findByRole('button', { name: 'All subjects' });
    act(() => invalidateLearnerReads());
    await waitFor(() => expect(urls().filter(url => url.includes('/modules/'))).toHaveLength(2));
    await waitFor(() => expect(urls().filter(url => url.endsWith('/7/'))).toHaveLength(2));
  });
});

describe('module state isolation', () => {
  it('never renders another learner or selected module while a request is pending', async () => {
    let select!: (id: string) => void;
    function Consumer() {
      const location = useLocation(); const navigate = useNavigate();
      const id = location.pathname.slice(1) || '7';
      select = id => navigate('/' + id);
      const result = useMyLearningCatalogue('commercial', id);
      const detail = useMyLearningModule('commercial', id, 'current:M1');
      return <output>{result.data?.learner.id}:{detail.data?.detail.id}</output>;
    }
    const mounted = render(<MemoryRouter initialEntries={['/7']}><Consumer /></MemoryRouter>);
    await waitFor(() => expect(mounted.container).toHaveTextContent('7:7'));
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    act(() => select('8'));
    expect(mounted.container).toHaveTextContent(':');
    expect(mounted.container).not.toHaveTextContent('7');
  });
});

describe('compact activity search', () => {
  it('debounces typing, aborts superseded requests and ignores late results across learners', async () => {
    const pending: { signal: AbortSignal; finish: (value: Response) => void }[] = [];
    vi.mocked(fetch).mockImplementation((_input,init) => new Promise(resolve => pending.push({ signal: init!.signal!, finish: resolve })));
    const hook=renderHook(({ id,query }) => useMyLearningSearch('commercial',id,query,true),{ initialProps:{ id:'7',query:'q' } });
    hook.rerender({id:'7',query:'quiet'});
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    hook.rerender({id:'8',query:'quiet'});
    expect(pending[0].signal.aborted).toBe(true);
    expect(hook.result.current.ids).toEqual([]);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => pending[0].finish(reply({matches:[{id:'current:FOREIGN'}],nextOffset:null})));
    expect(hook.result.current.ids).toEqual([]);
    await act(async () => pending[1].finish(reply({matches:[{id:'current:OWN'}],nextOffset:null})));
    expect(hook.result.current.ids).toEqual(['current:OWN']);
    hook.rerender({id:'8',query:''});
    expect(hook.result.current.ids).toEqual([]);
  });

  it('consumes bounded pages and exposes search errors', async () => {
    vi.mocked(fetch).mockImplementation(async input => reply(String(input).endsWith('offset=0')
      ? { matches:[{id:'current:M1'}],nextOffset:50 } : { matches:[{id:'legacy:50'}],nextOffset:null }));
    const hook=renderHook(({ query }) => useMyLearningSearch('apprenticeship','7',query,true),{ initialProps:{query:'lesson'} });
    await waitFor(() => expect(hook.result.current.ids).toEqual(['current:M1','legacy:50']));
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(fetch).mockResolvedValue(new Response('{}',{status:503}));
    hook.rerender({query:'different'});
    await waitFor(() => expect(hook.result.current.error).toMatch(/Could not search/));
  });
});

it('preserves upcoming actions and fetches the remaining navigation links only on expansion', async () => {
  const fixture=makeCatalogue();
  fixture.upcoming=[{id:'session:1',title:'Live teaching',type:'session',date:'2099-01-01T10:00:00Z',href:'/learner/component/commercial/7/LIVE',online:true},
    {id:'deadline:1',title:'Assignment due',type:'assignment',date:'2099-01-02',href:'/learner/component/commercial/7/TASK',online:false}];
  fixture.hasMoreUpcoming=true;
  vi.mocked(fetch).mockImplementation(async input => String(input).includes('/certificates/') ? reply({template:null})
    : String(input).includes('/upcoming/') ? reply({upcoming:[...fixture.upcoming,{id:'deadline:2',title:'Later assignment',type:'assignment',date:'2099-02-01',href:'/learner/component/commercial/7/LATER',online:false}]}) : reply(fixture));
  route();
  expect(await screen.findByRole('link',{name:/Live teaching/})).toHaveAttribute('href','/learner/component/commercial/7/LIVE');
  expect(screen.getByRole('link',{name:/Assignment due/})).toHaveAttribute('href','/learner/component/commercial/7/TASK');
  expect(urls().some(url => url.includes('/upcoming/'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'View all'}));
  expect(await screen.findByRole('link',{name:/Later assignment/})).toBeVisible();
  expect(urls().filter(url => url.includes('/upcoming/'))).toHaveLength(1);
});

it('retains the frontend current/previous canonical summary fixture', () => {
  const real = { modules: ['One'], components: [
    { componentId: 'C1', moduleId: 'M1', module: 'One', component: 'Lesson', type: 'reading' },
    { componentId: 'Q1', moduleId: 'M1', module: 'One', component: 'Quiz', isQuiz: true, quizMeta: { quizId: 1 } },
    { componentId: 'Q2', moduleId: 'M1', module: 'One', component: 'Quiz 2', isQuiz: true, quizMeta: { quizId: 1 } },
    { componentId: 'L1', moduleId: 'M1', module: 'One', component: 'Live', type: 'live_session', attendanceCompleted: true }],
    componentProgress: [{ componentId: 'C1', kind: 'component' }], quizAttempts: [
      { componentId: 'Q2', quizId: 1, passed: true }, { componentId: 'Q2', quizId: 1, passed: false }, { componentId: 'OLD', quizId: 99, passed: true }],
    retiredQuizComponents: [{ componentId: 'OLD', moduleId: 'M1', module: 'One', component: 'Old quiz', isQuiz: true, quizMeta: { quizId: 99 } }] } as unknown as LearnerDetail;
  expect(buildUnifiedLearningSummary(null,real).percent).toBe(80);
});
