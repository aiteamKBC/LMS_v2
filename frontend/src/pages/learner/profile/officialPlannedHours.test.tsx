import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '@/api/learnerDetail';
import { AuthContext, type RbacContextValue } from '@/hooks/useAuth.helpers';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { CaseFileContext, type CaseFileSession } from '@/features/coach/case-file/hooks/caseFileSessionContext';
import Page from './page';

const selected = vi.hoisted(() => ({ kind: 'commercial', id: '125' }));
vi.mock('@/hooks/useMyLearner', () => ({ useMyLearner: () => selected }));
vi.mock('@/hooks/useAuth', async () => ({ useAuth: (await import('@/hooks/useAuth.helpers')).useAuth }));
vi.mock('@/hooks/useOnboardingRedirect', () => ({ useOnboardingRedirect: () => false }));
vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/feature/LearnerProfilePhoto', () => ({ LearnerProfilePhoto: () => null }));
vi.mock('@/api/learnerAttendance', () => ({ fetchLearnerAttendance: vi.fn(async () => null) }));

function payload(official: unknown = 288, id = '125') {
  return { id, name: `Synthetic ${id}`, programmeStatus: 'Active', plannedHours: '420', completedHours: '120',
    totalExpectedOtjh: 400, modules: [], components: [], week: [], ksbs: [], officialPlannedHours: official } as api.LearnerDetail;
}
function deferred() {
  let resolve!: (value: api.LearnerDetail) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<api.LearnerDetail>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function auth(accountId = 1, role = 'learner') {
  return { auth: { account: { id: accountId, role, subjectType: role === 'learner' ? 'learner' : 'staff', subjectId: accountId } } } as RbacContextValue;
}
function tree(account = auth()) {
  return <AuthContext.Provider value={account}><MemoryRouter><Page /></MemoryRouter></AuthContext.Provider>;
}
function row(label: string) { return screen.getByText(label).parentElement!; }

beforeEach(() => {
  selected.kind = 'commercial'; selected.id = '125';
  vi.spyOn(api, 'peekLearnerDetail').mockReturnValue(undefined);
  vi.spyOn(api, 'fetchLearnerDetail').mockResolvedValue(payload());
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  vi.stubGlobal('AppIcon', () => null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  [288, '288h'], [0, '0h'], [null, 'Unavailable'], [-1, 'Unavailable'], ['288', 'Unavailable'],
  [NaN, 'Unavailable'], [Infinity, 'Unavailable'], [-Infinity, 'Unavailable'], [true, 'Unavailable'],
  [{ hours: 288 }, 'Unavailable'], [[], 'Unavailable'],
])('renders official %j strictly and preserves legacy totals', async (value, expected) => {
  vi.mocked(api.fetchLearnerDetail).mockResolvedValue(payload(value));
  render(tree());
  await waitFor(() => expect(row('Official Planned Hours')).toHaveTextContent(expected));
  expect(row('Component + Review Planned Hours')).toHaveTextContent('420h');
  expect(screen.getByText(/420h planned.*29% complete/)).toBeVisible();
  expect(screen.queryByText(/Official.*Completion/)).not.toBeInTheDocument();
  expect(api.fetchLearnerDetail).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('handles old responses without substituting legacy 420 or component 400', async () => {
  const old = payload(); delete old.officialPlannedHours;
  vi.mocked(api.fetchLearnerDetail).mockResolvedValue(old);
  render(tree());
  await waitFor(() => expect(row('Official Planned Hours')).toHaveTextContent('Unavailable'));
});

it.each(['commercial', 'apprenticeship'])('uses the existing %s detail request in staff preview', async kind => {
  selected.kind = kind;
  render(tree(auth(7, 'staff')));
  await waitFor(() => expect(row('Official Planned Hours')).toHaveTextContent('288h'));
  expect(api.fetchLearnerDetail).toHaveBeenCalledExactlyOnceWith(kind, '125', { revalidate: false });
});

it('preserves initial loading, error and retry', async () => {
  const first = deferred(), retry = deferred();
  vi.mocked(api.fetchLearnerDetail).mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  render(tree());
  expect(screen.queryByText('Official Planned Hours')).not.toBeInTheDocument();
  await act(async () => first.reject(new Error('Synthetic failure')));
  expect(screen.getByRole('alert')).toHaveTextContent('Synthetic failure');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Official Planned Hours')).not.toBeInTheDocument();
  await act(async () => retry.resolve(payload(0)));
  expect(row('Official Planned Hours')).toHaveTextContent('0h');
  expect(api.fetchLearnerDetail).toHaveBeenCalledTimes(2);
});

it('suppresses cached official hours during revalidation and retry without erasing legacy data', async () => {
  const first = deferred(), retry = deferred();
  vi.mocked(api.peekLearnerDetail).mockReturnValue(payload());
  vi.mocked(api.fetchLearnerDetail).mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  render(tree());
  expect(row('Official Planned Hours')).toHaveTextContent('Loading');
  expect(row('Official Planned Hours')).not.toHaveTextContent('288h');
  expect(row('Component + Review Planned Hours')).toHaveTextContent('420h');
  await act(async () => first.reject(new Error('Refresh failed')));
  expect(screen.queryByText('Official Planned Hours')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(row('Official Planned Hours')).toHaveTextContent('Loading');
  expect(row('Component + Review Planned Hours')).toHaveTextContent('420h');
  await act(async () => retry.resolve(payload(0)));
  expect(row('Official Planned Hours')).toHaveTextContent('0h');
});

it('hides prior learner and account data while the replacement request is pending', async () => {
  const nextLearner = deferred(), nextAccount = deferred();
  vi.mocked(api.fetchLearnerDetail).mockResolvedValueOnce(payload()).mockReturnValueOnce(nextLearner.promise).mockReturnValueOnce(nextAccount.promise);
  const view = render(tree());
  await waitFor(() => expect(row('Official Planned Hours')).toHaveTextContent('288h'));
  selected.id = '132'; view.rerender(tree());
  expect(screen.queryByText('Synthetic 125')).not.toBeInTheDocument();
  await act(async () => nextLearner.resolve(payload(300, '132')));
  expect(row('Official Planned Hours')).toHaveTextContent('300h');
  // Even a still-visible snapshot cannot bridge the account boundary.
  vi.mocked(api.peekLearnerDetail).mockReturnValue(payload(300, '132'));
  view.rerender(tree(auth(2)));
  expect(screen.queryByText('Official Planned Hours')).not.toBeInTheDocument();
  await act(async () => nextAccount.resolve(payload(0, '132')));
  expect(row('Official Planned Hours')).toHaveTextContent('0h');
});

it.each(['resolve', 'reject'] as const)('an older refresh cannot settle fetching when it will %s', async settlement => {
  const older = deferred(), newer = deferred();
  vi.mocked(api.fetchLearnerDetail).mockResolvedValueOnce(payload()).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const { result } = renderHook(() => useLearnerDetailParam('commercial', '125'));
  expect(result.current.isFetching).toBe(true);
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  act(() => result.current.refresh());
  expect(result.current.isFetching).toBe(true);
  expect(result.current.loading).toBe(false);
  act(() => result.current.refresh());
  await act(async () => settlement === 'resolve' ? older.resolve(payload(900)) : older.reject(new Error('Old failure')));
  expect(result.current.isFetching).toBe(true);
  expect(result.current.real?.officialPlannedHours).toBe(288);
  expect(result.current.loadError).toBeNull();
  await act(async () => newer.resolve(payload(0)));
  expect(result.current.isFetching).toBe(false);
  expect(result.current.real?.officialPlannedHours).toBe(0);
  expect(api.fetchLearnerDetail).toHaveBeenCalledTimes(3);
});

it('preserves the Coach session branch and isolates a replacement session', async () => {
  const retry = deferred(), replacement = deferred();
  const detail = vi.fn().mockResolvedValueOnce(payload()).mockReturnValueOnce(retry.promise);
  let session = { learnerId: '125', detail } as unknown as CaseFileSession;
  const wrapper = ({ children }: { children: ReactNode }) => <CaseFileContext.Provider value={session}>{children}</CaseFileContext.Provider>;
  const { result, rerender } = renderHook(() => useLearnerDetailParam('commercial', '125'), { wrapper });
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  expect(detail).toHaveBeenCalledWith(false);
  act(() => result.current.refresh());
  expect(result.current.isFetching).toBe(true);
  expect(result.current.real?.officialPlannedHours).toBe(288);
  expect(detail).toHaveBeenLastCalledWith(true);
  session = { learnerId: '125', detail: vi.fn(() => replacement.promise) } as unknown as CaseFileSession;
  rerender();
  expect(result.current.real).toBeNull();
  await act(async () => retry.resolve(payload(900)));
  expect(result.current.isFetching).toBe(true);
  expect(result.current.real).toBeNull();
  await act(async () => replacement.resolve(payload(0)));
  expect(result.current.isFetching).toBe(false);
  expect(api.fetchLearnerDetail).not.toHaveBeenCalled();
  expect(api.peekLearnerDetail).not.toHaveBeenCalled();
});

it('does not fetch when disabled and ignores an unmounted completion', async () => {
  const pending = deferred();
  vi.mocked(api.fetchLearnerDetail).mockReturnValue(pending.promise);
  const { result, rerender, unmount } = renderHook(({ enabled }) => useLearnerDetailParam('commercial', '125', false, enabled), { initialProps: { enabled: false } });
  expect(result.current.isFetching).toBe(false);
  expect(api.fetchLearnerDetail).not.toHaveBeenCalled();
  rerender({ enabled: true });
  expect(result.current.isFetching).toBe(true);
  unmount();
  await act(async () => pending.resolve(payload()));
});

it('reports cached first-frame fetching and settles on failure while retaining the snapshot', async () => {
  const pending = deferred();
  vi.mocked(api.peekLearnerDetail).mockReturnValue(payload());
  vi.mocked(api.fetchLearnerDetail).mockReturnValue(pending.promise);
  const frames: boolean[] = [];
  const { result } = renderHook(() => {
    const state = useLearnerDetailParam('commercial', '125');
    frames.push(state.isFetching);
    return state;
  });
  expect(frames.every(Boolean)).toBe(true);
  expect(result.current.loading).toBe(false);
  await act(async () => pending.reject(new Error('Refresh failed')));
  expect(result.current.isFetching).toBe(false);
  expect(result.current.real?.officialPlannedHours).toBe(288);
  expect(result.current.loadError).toBe('Refresh failed');
});

it.each(['learner', 'account'] as const)('ignores stale completion across a pending %s switch', async boundary => {
  const older = deferred(), newer = deferred();
  vi.mocked(api.fetchLearnerDetail).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  let account = auth();
  const wrapper = ({ children }: { children: ReactNode }) => <AuthContext.Provider value={account}>{children}</AuthContext.Provider>;
  const { result, rerender } = renderHook(({ id }) => useLearnerDetailParam('commercial', id), { wrapper, initialProps: { id: '125' } });
  if (boundary === 'account') account = auth(2);
  const id = boundary === 'learner' ? '132' : '125';
  rerender({ id });
  await act(async () => older.resolve(payload(900)));
  expect(result.current.isFetching).toBe(true);
  expect(result.current.real).toBeNull();
  await act(async () => newer.resolve(payload(0, id)));
  expect(result.current.isFetching).toBe(false);
  expect(result.current.real?.officialPlannedHours).toBe(0);
});

it('marks the first render of a re-enabled cached read as fetching', async () => {
  const pending = deferred();
  vi.mocked(api.fetchLearnerDetail).mockResolvedValueOnce(payload()).mockReturnValueOnce(pending.promise);
  const frames: boolean[] = [];
  const { result, rerender } = renderHook(({ enabled }) => {
    const state = useLearnerDetailParam('commercial', '125', false, enabled);
    frames.push(state.isFetching);
    return state;
  }, { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  rerender({ enabled: false });
  expect(result.current.isFetching).toBe(false);
  frames.length = 0;
  rerender({ enabled: true });
  expect(frames.every(Boolean)).toBe(true);
  expect(result.current.real?.officialPlannedHours).toBe(288);
  await act(async () => pending.resolve(payload(0)));
  expect(result.current.isFetching).toBe(false);
});
