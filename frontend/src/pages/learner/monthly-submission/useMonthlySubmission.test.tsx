import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { invalidateLearnerReads } from '@/api/learnerRead';
import type { LearnerDetail } from '@/api/learnerDetail';
import { CaseFileContext, type CaseFileSession } from '@/features/coach/case-file/hooks/caseFileSessionContext';
import { MONTHLY_SUBMISSION_FRESH_MS, useMonthlyAssignmentDetail, useMonthlySubmission } from './useMonthlySubmission';

const LIST_URL = '/learner_api/monthly-submission/commercial/125/';
const list = {
  learner: { id: '125', name: 'Learner' },
  components: [{ componentId: 'A1', type: 'assignment', component: 'Assignment · Data', module: 'M', week: 'W',
    expectedOtjh: 7, contentAvailable: true }],
  componentMarkingStatus: { A1: { status: 'accepted', feedback: 'Good', reviewedBy: 'Coach', reviewedAt: null } },
  videoProgress: [], componentProgress: [{ componentId: 'A1', kind: 'component', passed: null }],
};
let fail = false;
let now = 1_000_000;
const fetcher = vi.fn(async (url: string) => {
  if (url.includes('/assignments/')) {
    const id = decodeURIComponent(url.split('/assignments/')[1].replace(/\/$/, ''));
    return { ok: true, status: 200, json: async () => ({ componentId: id === 'wrong' ? 'A1' : id, assignmentBrief: `Brief ${id}` }) };
  }
  return fail ? { ok: false, status: 503, json: async () => ({ error: 'Could not load your monthly assignments. Please try again.' }) }
    : { ok: true, status: 200, json: async () => list };
});
const listReads = () => fetcher.mock.calls.filter(([url]) => url === LIST_URL).length;

beforeEach(() => {
  fail = false;
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', fetcher);
});
const respond = fetcher.getMockImplementation()!;
afterEach(() => { clearAllCachedResources(); fetcher.mockClear(); fetcher.mockImplementation(respond); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function returnToTab() {
  act(() => { window.dispatchEvent(new Event('focus')); });
}

it('reads only the Monthly Submission list, never learner detail', async () => {
  const { result } = renderHook(() => useMonthlySubmission('commercial', '125'));
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.real?.name).toBe('Learner'));
  expect(result.current).toMatchObject({ loading: false, loadError: null, includesDetails: false });
  expect(result.current.real?.components.map(row => row.componentId)).toEqual(['A1']);
  expect(result.current.real?.componentMarkingStatus?.A1.feedback).toBe('Good');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([LIST_URL]);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('learner-detail'))).toBe(false);
});

it('refreshes on return to the tab only once the rows have expired', async () => {
  const { result } = renderHook(() => useMonthlySubmission('commercial', '125'));
  await waitFor(() => expect(result.current.real).not.toBeNull());
  now += 5_000;
  returnToTab();
  expect(listReads()).toBe(1);
  now += MONTHLY_SUBMISSION_FRESH_MS;
  returnToTab();
  await waitFor(() => expect(listReads()).toBe(2));
  // Rows stay on screen while they refresh.
  expect(result.current.real?.name).toBe('Learner');
});

it('refreshes after any save or submission invalidates learner reads', async () => {
  const { result } = renderHook(() => useMonthlySubmission('commercial', '125'));
  await waitFor(() => expect(result.current.real).not.toBeNull());
  act(() => { invalidateLearnerReads(); });
  await waitFor(() => expect(listReads()).toBe(2));
});

it('reports a failed read and retries it on the next return, even while fresh', async () => {
  fail = true;
  const { result } = renderHook(() => useMonthlySubmission('commercial', '125'));
  await waitFor(() => expect(result.current.loadError).toBe('Could not load your monthly assignments. Please try again.'));
  expect(result.current.loading).toBe(false);
  const failedReads = listReads();
  fail = false;
  now += 2_000;
  returnToTab();
  await waitFor(() => expect(result.current.real?.name).toBe('Learner'));
  expect(listReads()).toBe(failedReads + 1);
  expect(result.current.loadError).toBeNull();
});

it('keeps the staff case-file preview on its existing session detail read', async () => {
  const detail = { id: '125', name: 'Previewed learner', components: [] } as unknown as LearnerDetail;
  const session = { learnerId: '125', read: vi.fn(), detail: vi.fn(async () => detail) } as unknown as CaseFileSession;
  const wrapper = ({ children }: { children: ReactNode }) => <CaseFileContext.Provider value={session}>{children}</CaseFileContext.Provider>;
  const { result } = renderHook(() => useMonthlySubmission('commercial', '125'), { wrapper });
  await waitFor(() => expect(result.current.real?.name).toBe('Previewed learner'));
  expect(result.current.includesDetails).toBe(true);
  expect(session.detail).toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it('reads the selected assignment only when its details are needed', async () => {
  const off = renderHook(() => useMonthlyAssignmentDetail('commercial', '125', 'A1', false));
  expect(off.result.current.data).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  const { result, rerender } = renderHook(({ id }) => useMonthlyAssignmentDetail('commercial', '125', id, true), { initialProps: { id: 'A1' } });
  await waitFor(() => expect(result.current.data?.assignmentBrief).toBe('Brief A1'));
  expect(fetcher).toHaveBeenLastCalledWith('/learner_api/monthly-submission/commercial/125/assignments/A1/', expect.anything());
  rerender({ id: 'wrong' });
  await waitFor(() => expect(result.current.error).toBe('The server returned a different assignment. Please try again.'));
  expect(result.current.data).toBeNull();
});

it('reuses a selected assignment within 30 seconds and refetches after expiry', async () => {
  const detailReads = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/assignments/A1/')).length;
  const { result, rerender } = renderHook(({ id }) => useMonthlyAssignmentDetail('commercial', '125', id, true), { initialProps: { id: 'A1' } });
  await waitFor(() => expect(result.current.data?.assignmentBrief).toBe('Brief A1'));
  rerender({ id: 'A2' });
  await waitFor(() => expect(result.current.data?.assignmentBrief).toBe('Brief A2'));
  now += 20_000;
  rerender({ id: 'A1' });
  await waitFor(() => expect(result.current.data?.assignmentBrief).toBe('Brief A1'));
  expect(detailReads()).toBe(1);
  rerender({ id: 'A2' });
  await waitFor(() => expect(result.current.data?.assignmentBrief).toBe('Brief A2'));
  now += 11_000;
  rerender({ id: 'A1' });
  await waitFor(() => expect(detailReads()).toBe(2));
  expect(result.current.data?.assignmentBrief).toBe('Brief A1');
});

it('drops cached assignment details after any save, submit or upload', async () => {
  const detailReads = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/assignments/A1/')).length;
  const { result, rerender } = renderHook(({ id }) => useMonthlyAssignmentDetail('commercial', '125', id, true), { initialProps: { id: 'A1' } });
  await waitFor(() => expect(result.current.data).not.toBeNull());
  rerender({ id: 'A2' });
  await waitFor(() => expect(result.current.data?.componentId).toBe('A2'));
  // Every learner save path ends in invalidateLearnerReads().
  act(() => { invalidateLearnerReads(); });
  rerender({ id: 'A1' });
  await waitFor(() => expect(detailReads()).toBe(2));
});

it('retries a failed detail read past the cache', async () => {
  let failDetail = true;
  fetcher.mockImplementation(async (url: string) => {
    if (url.includes('/assignments/')) {
      return failDetail ? { ok: false, status: 503, json: async () => ({ error: 'Could not load this assignment. Please try again.' }) }
        : { ok: true, status: 200, json: async () => ({ componentId: 'A1', assignmentBrief: 'Brief A1' }) };
    }
    return { ok: true, status: 200, json: async () => list };
  });
  const { result } = renderHook(() => useMonthlyAssignmentDetail('commercial', '125', 'A1', true));
  await waitFor(() => expect(result.current.error).toBe('Could not load this assignment. Please try again.'));
  failDetail = false;
  act(() => { result.current.retry(); });
  await waitFor(() => expect(result.current.data?.assignmentBrief).toBe('Brief A1'));
  expect(result.current.error).toBeNull();
});
