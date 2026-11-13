import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyLearningPage from './page';
import type { MyLearningCatalogue } from '@/api/myLearning';
import { clearAllCachedResources } from '@/api/cachedRequest';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { role: 'staff', id: 1 } }, isInitialized: true }) }));
vi.mock('@/hooks/useMyLearner', () => ({ useResolvedLearner: (kind: string, id: string) => ({ kind, id }) }));
vi.mock('@/hooks/useLearnerWorkspaceAccess', () => ({ useLearnerWorkspaceAccess: () => ({ canProgress: false, showReadOnlyNotice: false }) }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.stubGlobal('AppIcon', () => <span />);

const catalogue = (): MyLearningCatalogue => ({
  learner: { id: '7', kind: 'commercial', name: 'Synthetic learner', programme: 'Programme', cohort: '', group: '' },
  summary: { current: { subjects: 1, total: 2, completed: 1, percent: 50 }, previous: { subjects: 1, total: 3, completed: 1, percent: 33.33 }, subjectCount: 2 },
  modules: [{ id: 'current:M1', title: 'One', source: 'current', moduleId: 'M1', activityCount: 2, completedActivityCount: 1, progress: 50,
    status: 'In progress', nextTitle: 'Final test', finalTestPassed: false, actualHours: 1,
    planModule: { start_date: '2026-01-01', end_date: '2026-12-31', tutor_name: 'Tutor', total_otjh: 10, educational_session_count: 2 } },
  { id: 'legacy:50', title: 'Old', source: 'legacy', activityCount: 3, completedActivityCount: 1, progress: 33.33,
    status: 'In progress', finalTestPassed: false, actualHours: 2 }],
  otjh: { actual: 3, planned: 10 }, upcoming: [], hasMoreUpcoming: false,
});
const moduleRead = (subject = 'current:M1') => ({ subjectId: subject,
  detail: { id: '7', name: 'Synthetic learner', programme: 'Programme', modules: ['One'], week: [], components: [{
    componentId: 'C1', moduleId: 'M1', module: 'One', week: 'Week 1', component: 'Quiet lesson', type: 'reading', contentAvailable: false }],
  quizAttempts: [], componentProgress: [], videoProgress: [] },
  activity: null, metadata: { covers: {}, current_subjects: [{ id: 'M1', title: 'One' }], builder_subjects: {} },
  schedule: { modules: [], moduleLinks: {}, generatedAt: '' }, sessions: [],
  overview: subject.startsWith('current:') ? { summary: 'Authored introduction', description: '', targetAudience: [], prerequisites: [], requirements: [],
    instructor: { name: 'Tutor', bio: '', photoUrl: '' } } : null });

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
const visited: string[] = [];
function Probe() {
  const location = useLocation();
  visited.push(`${location.pathname}${location.search}`);
  return null;
}
function route(path = '/learner/my-learning/commercial/7') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/learner/my-learning/:kind/:id" element={<><MyLearningPage /><Probe /></>} />
    <Route path="*" element={<Probe />} />
  </Routes></MemoryRouter></StrictMode>);
}
const last = () => visited[visited.length - 1] || '';

beforeEach(() => {
  visited.length = 0;
  clearAllCachedResources();
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = String(input);
    if (url.includes('/certificates/')) return reply({ template: null, csrfToken: '' });
    if (url.includes('/modules/current%3AFOREIGN/')) return reply({ error: "Module not found in this learner's plan." }, 404);
    if (url.includes('/modules/')) return reply(moduleRead(decodeURIComponent(url.split('/modules/')[1].replace(/\/$/, ''))));
    if (/\/my-learning\/commercial\/7\/$/.test(url)) return reply(catalogue());
    throw new Error(`Unexpected API request: ${url}`);
  }));
});
afterEach(() => { clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Module Overview navigation', () => {
  it('opens a New LMS card on its overview, then Continue learning opens the existing experience with no second read', async () => {
    route();
    fireEvent.click(await screen.findByRole('button', { name: /New LMS.*One.*Open subject/ }));
    expect(await screen.findByText('Authored introduction')).toBeVisible();
    expect(last()).toContain('overview=current%3AM1');
    expect(last()).not.toContain('subject=');
    fireEvent.click(screen.getAllByRole('button', { name: 'Continue learning' })[0]);
    await waitFor(() => expect(visited.some(entry => entry.includes('subject=current%3AM1'))).toBe(true));
    expect(visited.filter(entry => entry.includes('subject=')).every(entry => !entry.includes('overview='))).toBe(true);
    expect(urls().filter(url => url.includes('/modules/'))).toEqual(['/learner_api/my-learning/commercial/7/modules/current%3AM1/']);
  });

  it('returns from the overview to the catalogue', async () => {
    route('/learner/my-learning/commercial/7?overview=current%3AM1');
    fireEvent.click(await screen.findByRole('button', { name: 'My modules' }));
    await waitFor(() => expect(last()).toBe('/learner/my-learning/commercial/7'));
    expect(await screen.findByRole('heading', { name: 'My Learning' })).toBeVisible();
  });

  it('keeps Old LMS cards opening directly', async () => {
    route();
    fireEvent.click(await screen.findByRole('button', { name: /Old LMS.*Old.*Open subject/ }));
    await waitFor(() => expect(last()).toContain('subject=legacy%3A50'));
    expect(visited.some(entry => entry.includes('overview='))).toBe(false);
  });

  it('keeps ?subject= deep links on the existing experience', async () => {
    route('/learner/my-learning/commercial/7?subject=current%3AM1');
    await waitFor(() => expect(urls().some(url => url.includes('/modules/current%3AM1/'))).toBe(true));
    await waitFor(() => expect(screen.queryByText('Loading subjects')).not.toBeInTheDocument());
    expect(screen.queryByText('Authored introduction')).not.toBeInTheDocument();
    expect(visited.some(entry => entry.includes('overview='))).toBe(false);
  });

  it('sends an overview link for an Old LMS subject straight to that subject', async () => {
    route('/learner/my-learning/commercial/7?overview=legacy%3A50');
    await waitFor(() => expect(last()).toContain('subject=legacy%3A50'));
    expect(last()).not.toContain('overview=');
  });

  it('refuses an overview for a module outside the learner plan', async () => {
    route('/learner/my-learning/commercial/7?overview=current%3AFOREIGN');
    expect(await screen.findByRole('alert')).toHaveTextContent('This module is not available in your learning plan.');
    expect(screen.queryByText('Authored introduction')).not.toBeInTheDocument();
  });
});
