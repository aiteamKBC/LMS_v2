import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { coachFetch } from '@/lib/coachFetch';
import { acquireAttendanceDetail, attendanceDetailKey } from '../api/attendanceDetailCache';
import { useAttendanceDetail } from './useAttendanceDetail';

vi.mock('@/lib/coachFetch', () => ({ coachFetch: vi.fn() }));
const payload = (id = '320') => ({ learner: { id, name: `Learner ${id}` }, records: [], summary: { sessions: 0 }, pagination: { page: 1, pageSize: 20, total: 0, hasMore: false } });
const scope = 'coach@example.com';
function pendingRequests() {
  const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
  vi.mocked(coachFetch).mockImplementation((_url, init) => new Promise((resolve, reject) => {
    const signal = init!.signal as AbortSignal;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    pending.push({ signal, resolve });
  }));
  return pending;
}
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe('Coach attendance detail request ownership', () => {
  beforeEach(() => { clearAllCachedResources(); vi.mocked(coachFetch).mockReset(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not abort a slow request while the same learner remains mounted', async () => {
    vi.useFakeTimers();
    const pending = pendingRequests();
    const hook = renderHook(() => useAttendanceDetail('320', true, scope));
    await act(async () => vi.advanceTimersByTime(21_000));
    expect(pending[0].signal.aborted).toBe(false);
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.error).toBeNull();
    hook.unmount();
    await act(async () => {});
    expect(pending[0].signal.aborted).toBe(true);
  });

  it('starts one request under StrictMode and keeps it through same-key rerenders', async () => {
    const pending = pendingRequests();
    const hook = renderHook(({ id }) => useAttendanceDetail(id, true, scope), { initialProps: { id: '320' }, wrapper: strict });
    await act(async () => {});
    hook.rerender({ id: '320' });
    expect(coachFetch).toHaveBeenCalledTimes(1);
    expect(pending[0].signal.aborted).toBe(false);
    await act(async () => pending[0].resolve(new Response(JSON.stringify(payload()))));
    expect(hook.result.current.learner?.id).toBe('320');
    expect(hook.result.current.error).toBeNull();
  });

  it('shares the exact promise and keeps the request until the last consumer leaves', async () => {
    const pending = pendingRequests();
    const key = attendanceDetailKey(scope, '320');
    const first = acquireAttendanceDetail(key);
    const second = acquireAttendanceDetail(key);
    const rejected = first.promise.catch(error => error);
    expect(first.promise).toBe(second.promise);
    expect(coachFetch).toHaveBeenCalledTimes(1);
    first.release();
    await Promise.resolve();
    expect(pending[0].signal.aborted).toBe(false);
    second.release();
    await Promise.resolve();
    expect(pending[0].signal.aborted).toBe(true);
    expect((await rejected).name).toBe('AbortError');
  });

  it('shares across mounted hooks and does not cancel another consumer on navigation', async () => {
    const pending = pendingRequests();
    const first = renderHook(() => useAttendanceDetail('320', true, scope));
    const second = renderHook(() => useAttendanceDetail('320', true, scope));
    expect(coachFetch).toHaveBeenCalledTimes(1);
    first.unmount();
    await act(async () => {});
    expect(pending[0].signal.aborted).toBe(false);
    await act(async () => pending[0].resolve(new Response(JSON.stringify(payload()))));
    expect(second.result.current.learner?.id).toBe('320');
  });

  it('cancels the old learner only on key change and does not display cancellation as failure', async () => {
    const pending = pendingRequests();
    const hook = renderHook(({ id }) => useAttendanceDetail(id, true, scope), { initialProps: { id: '320' } });
    hook.rerender({ id: '321' });
    await act(async () => {});
    expect(coachFetch).toHaveBeenCalledTimes(2);
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
    expect(hook.result.current.error).toBeNull();
    await act(async () => pending[1].resolve(new Response(JSON.stringify(payload('321')))));
    expect(hook.result.current.learner?.id).toBe('321');
    expect(hook.result.current.error).toBeNull();
  });

  it('separates coach/view-as contexts and waits for identity initialization', async () => {
    const pending = pendingRequests();
    const hook = renderHook(({ enabled, identity }) => useAttendanceDetail('320', enabled, identity), { initialProps: { enabled: false, identity: '' } });
    expect(coachFetch).not.toHaveBeenCalled();
    hook.rerender({ enabled: true, identity: scope });
    hook.rerender({ enabled: true, identity: 'view-as:other@example.com' });
    await act(async () => {});
    expect(coachFetch).toHaveBeenCalledTimes(2);
    expect(pending[0].signal.aborted).toBe(true);
    expect(hook.result.current.error).toBeNull();
  });

  it('reuses a fresh revisit and requests once after the 60-second TTL expires', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(coachFetch).mockImplementation(async () => new Response(JSON.stringify(payload())));
    const first = renderHook(() => useAttendanceDetail('320', true, scope));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    now += 59_999;
    const fresh = renderHook(() => useAttendanceDetail('320', true, scope));
    await waitFor(() => expect(fresh.result.current.learner?.id).toBe('320'));
    expect(coachFetch).toHaveBeenCalledTimes(1);
    fresh.unmount();
    now += 1;
    const expired = renderHook(() => useAttendanceDetail('320', true, scope), { wrapper: strict });
    await waitFor(() => expect(expired.result.current.loading).toBe(false));
    expect(coachFetch).toHaveBeenCalledTimes(2);
  });

  it('reload bypasses the fresh snapshot after an existing save', async () => {
    vi.mocked(coachFetch).mockImplementation(async () => new Response(JSON.stringify(payload())));
    const hook = renderHook(() => useAttendanceDetail('320', true, scope));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(coachFetch).toHaveBeenCalledTimes(2);
  });

  it('resets to page one in a single request when the learner changes from page two', async () => {
    vi.mocked(coachFetch).mockImplementation(async url => {
      const params = new URL(String(url), 'http://localhost').searchParams;
      return new Response(JSON.stringify({ ...payload(params.get('learner_id')!), pagination: {
        page: Number(params.get('page')), pageSize: 20, total: 25, hasMore: params.get('page') === '1',
      } }));
    });
    const hook = renderHook(({ id }) => useAttendanceDetail(id, true, scope), { initialProps: { id: '320' } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.setPage(2));
    await waitFor(() => expect(hook.result.current.pagination?.page).toBe(2));
    hook.rerender({ id: '321' });
    await waitFor(() => expect(hook.result.current.learner?.id).toBe('321'));
    expect(hook.result.current.pagination?.page).toBe(1);
    expect(coachFetch).toHaveBeenCalledTimes(3);
    expect(String(vi.mocked(coachFetch).mock.calls[2][0])).toContain('learner_id=321&page=1');
  });

  it('invalidates all cached pages after a save and returns to page one', async () => {
    vi.mocked(coachFetch).mockImplementation(async () => new Response(JSON.stringify(payload())));
    const hook = renderHook(() => useAttendanceDetail('320', true, scope));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    act(() => hook.result.current.setPage(2));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(coachFetch).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.page).toBe(1);
    expect(coachFetch).toHaveBeenCalledTimes(3);
    act(() => hook.result.current.setPage(2));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(coachFetch).toHaveBeenCalledTimes(4);
  });

  it('retries actual failures rather than caching them', async () => {
    vi.mocked(coachFetch).mockRejectedValueOnce(new Error('Offline'));
    const hook = renderHook(() => useAttendanceDetail('320', true, scope));
    await waitFor(() => expect(hook.result.current.error).toBe('Offline'));
    vi.mocked(coachFetch).mockResolvedValueOnce(new Response(JSON.stringify(payload())));
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.learner?.id).toBe('320'));
    expect(hook.result.current.error).toBeNull();
  });
});
