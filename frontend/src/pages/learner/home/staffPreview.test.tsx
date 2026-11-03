import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { useMyLearner, useResolvedLearner, rememberLearner, rememberSignedInLearner } from '@/hooks/useMyLearner';
import { clearAllCachedResources } from '@/api/cachedRequest';
import Home from './page';

const session = vi.hoisted(() => ({ account: { id: 7, role: 'admin', subjectType: 'staff', subjectId: 502, email: 'admin@example.test', permissions: [] } }));
vi.mock('@/api/auth', async original => ({ ...await original<typeof import('@/api/auth')>(),
  apiMe: vi.fn(async () => session.account), apiLogout: vi.fn(async () => undefined),
  apiLogin: vi.fn(async () => session.account),
}));
vi.mock('@/api/chat', () => ({ clearChatSession: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ LEARNER_FEEDBACK_ENABLED: false, LEARNER_POST_LECTURE_FEEDBACK_ENABLED: false, CHAT_ENABLED: false }));
vi.mock('@/components/SupportChatWidget', () => ({ SupportChatWidget: () => null }));
vi.mock('./StudentHomeHeader', () => ({ StudentHomeHeader: () => null }));
vi.mock('./ContinueLearning', () => ({ ContinueLearning: () => null }));

function Identity() {
  const { kind, id } = useParams();
  const resolved = useResolvedLearner(kind, id);
  const mine = useMyLearner();
  return <output data-testid="selected">{resolved.kind}:{resolved.id}/{mine.kind}:{mine.id}</output>;
}
function Ready() {
  const { isInitialized, auth, login } = useAuth();
  if (!isInitialized) return null;
  return <><button onClick={() => login('next@example.test', 'synthetic')}>Switch account</button><output data-testid="account">{auth.account?.role}:{auth.account?.subjectType}</output><Routes>
    <Route path="/workspace/learner" element={<Home />} />
    <Route path="/workspace/learner/:kind/:id" element={<Home />} />
    <Route path="/workspace/learner/dashboard/:kind/:id" element={<Identity />} />
    <Route path="/learner/my-progress/:kind/:id" element={<Identity />} />
  </Routes></>;
}
function mount(path: string) { return render(<MemoryRouter initialEntries={[path]}><AuthProvider><Ready /></AuthProvider></MemoryRouter>); }
function calls(fragment: string) { return transport.mock.calls.filter(([url]) => String(url).includes(fragment)); }
let transport: ReturnType<typeof vi.fn>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  localStorage.clear(); clearAllCachedResources(); rememberSignedInLearner(undefined, undefined);
  session.account = { id: 7, role: 'admin', subjectType: 'staff', subjectId: 502, email: 'admin@example.test', permissions: [] };
  vi.stubGlobal('AppIcon', () => null);
  transport = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/learner-summary/')) return json({ id: url.includes('/601/') ? '601' : '502', name: url.includes('/601/') ? 'Other Learner' : 'Aya Example', programmeStatus: 'Active' });
    if (url.includes('section=upcoming')) return json({ events: [] });
    if (url.includes('section=home-summary')) return json({ weekStart: '2026-11-02', weekEnd: '2026-11-08', modules: [], homeProgress: {
      period: { start: null, end: '2026-11-08' }, otjh: { actual: 0, submitted: 0, planned: null, percent: null },
      modules: { completed: 0, total: 0 }, activities: null, assignments: null, lectures: null,
    } });
    throw new Error(`Unexpected mocked request: ${url}`);
  });
  vi.stubGlobal('fetch', transport);
});
afterEach(() => { cleanup(); rememberSignedInLearner(undefined, undefined); localStorage.clear(); clearAllCachedResources(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it.each(['commercial', 'apprenticeship'])('restores the selected %s learner on bare Home reload with one read per resource', async kind => {
  const initial = mount(`/workspace/learner/${kind}/502`);
  expect(await screen.findByRole('heading', { name: 'Aya' })).toBeVisible();
  await waitFor(() => expect(calls('section=home-summary')).toHaveLength(1));
  expect(screen.getByTestId('account')).toHaveTextContent('admin:staff');
  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', `/workspace/learner/dashboard/${kind}/502`);
  initial.unmount();
  // Recreate document-local cache/state; retain only persisted preview storage.
  const stored = localStorage.getItem('my_learner')!;
  rememberSignedInLearner(undefined, undefined); clearAllCachedResources();
  localStorage.setItem('my_learner', stored); transport.mockClear();
  mount('/workspace/learner');
  expect(await screen.findByRole('heading', { name: 'Aya' })).toBeVisible();
  await waitFor(() => expect(calls('section=home-summary')).toHaveLength(1));
  expect(calls('/learner-summary/')).toHaveLength(1);
  expect(calls('section=upcoming')).toHaveLength(1);
  expect(transport.mock.calls.every(([url]) => String(url).includes(`/${kind}/502/`))).toBe(true);
});

it('uses the selected identity in Dashboard and Progress routes, then replaces it for another learner', async () => {
  let view = mount('/workspace/learner/commercial/502');
  await screen.findByRole('heading', { name: 'Aya' });
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
  expect(await screen.findByTestId('selected')).toHaveTextContent('commercial:502/commercial:502');
  view.unmount();
  view = mount('/learner/my-progress/commercial/502');
  expect(await screen.findByTestId('selected')).toHaveTextContent('commercial:502/commercial:502');
  view.unmount();
  view = mount('/workspace/learner/apprenticeship/601');
  expect(await screen.findByRole('heading', { name: 'Other' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Aya' })).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('my_learner')!).id).toBe('601');
});

it('does not inherit a previous staff account selection or use matching staff subject IDs', async () => {
  const view = mount('/workspace/learner/commercial/502');
  await screen.findByRole('heading', { name: 'Aya' }); view.unmount();
  session.account = { ...session.account, id: 8 };
  transport.mockClear();
  mount('/workspace/learner');
  expect(await screen.findByText(/We could not verify your learner profile/)).toBeVisible();
  expect(transport).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Aya' })).not.toBeInTheDocument();
});

it('preserves a server authorization denial and never loads Home cards for that learner', async () => {
  transport.mockResolvedValue(json({ error: 'Preview forbidden' }, 403));
  mount('/workspace/learner/commercial/502');
  expect(await screen.findByText('Preview forbidden')).toBeVisible();
  expect(calls('/learner-summary/')).toHaveLength(1);
  expect(calls('section=home-summary')).toHaveLength(0);
  expect(screen.queryByRole('heading', { name: 'Aya' })).not.toBeInTheDocument();
});

it('requires a fresh explicit selection for old unowned storage', async () => {
  rememberLearner('commercial', '502');
  mount('/workspace/learner');
  expect(await screen.findByText(/We could not verify your learner profile/)).toBeVisible();
  expect(transport).not.toHaveBeenCalled();
});

it('drops mounted Home data on an account switch even when the explicit learner URL stays the same', async () => {
  mount('/workspace/learner/commercial/502');
  await screen.findByRole('heading', { name: 'Aya' });
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
  let finish!: (response: Response) => void;
  transport.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  session.account = { ...session.account, id: 8 };
  fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(4));
  expect(screen.queryByRole('heading', { name: 'Aya' })).not.toBeInTheDocument();
  await act(async () => finish(json({ id: '502', name: 'Verified Again', programmeStatus: 'Active' })));
  expect(await screen.findByRole('heading', { name: 'Verified' })).toBeVisible();
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(6));
});
