import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurriculumJson } from '@/lib/curriculumApi';
import { useDeliverySessions } from '../useDeliverySessions';
import { useDeliveryRead } from '../useDeliveryData';
import type { DeliveryLiveSession } from '../deliveryDashboard';

const refresh = vi.hoisted(() => ({ callback: () => {} }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumJson: vi.fn() }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: (callback: () => void) => { refresh.callback = callback; } }));
const read = vi.mocked(fetchCurriculumJson);
const sessions: DeliveryLiveSession[] = [{ id: 's1', type: 'Live Session', date: '2026-11-13' }];
const deferred = () => {
  let resolve!: (value: { sessions: DeliveryLiveSession[] }) => void;
  const promise = new Promise<{ sessions: DeliveryLiveSession[] }>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => { read.mockReset().mockResolvedValue({ sessions, undatedSessionCount: 2 }); });
afterEach(cleanup);

describe('Delivery small-read lifecycle', () => {
  it('reads the dedicated live-date endpoint immediately, without another read for chart rerenders', async () => {
    const hook = renderHook(() => useDeliverySessions('account-a'));
    await waitFor(() => expect(hook.result.current.sessions).toEqual(sessions));
    expect(hook.result.current.undatedSessionCount).toBe(2);
    hook.rerender();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('/curriculum/delivery-dashboard/sessions/', {
      signal: expect.any(AbortSignal), revalidate: true, timeoutMs: 30_000,
    });
  });

  it('does not make live dates wait for a slow summary', async () => {
    read.mockImplementation(path => path.endsWith('/sessions/') ? Promise.resolve({ sessions }) : new Promise(() => {}));
    const summary = renderHook(() => useDeliveryRead('/curriculum/delivery-dashboard/', 'account-a'));
    const dates = renderHook(() => useDeliverySessions('account-a'));
    await waitFor(() => expect(dates.result.current.sessions).toEqual(sessions));
    expect(summary.result.current.loading).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps known dates visible on a background failure and allows retry', async () => {
    const hook = renderHook(() => useDeliverySessions('account-a'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    read.mockRejectedValueOnce(new Error('Calendar unavailable'));
    act(() => refresh.callback());
    await waitFor(() => expect(hook.result.current.error).toBe('Calendar unavailable'));
    expect(hook.result.current.sessions).toEqual(sessions);
    expect(hook.result.current.undatedSessionCount).toBe(2);
    expect(hook.result.current.loading).toBe(false);
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.error).toBe(null));
  });

  it('ignores late results from a previous account or after unmount', async () => {
    const old = deferred(); const current = deferred();
    read.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const hook = renderHook(({ scope }) => useDeliverySessions(scope), { initialProps: { scope: 'account-a' } });
    const oldSignal = read.mock.calls[0][1]!.signal!;
    hook.rerender({ scope: 'account-b' });
    expect(oldSignal.aborted).toBe(true);
    expect(hook.result.current.sessions).toEqual([]);
    expect(hook.result.current.undatedSessionCount).toBeUndefined();
    await act(async () => { old.resolve({ sessions }); });
    expect(hook.result.current.sessions).toEqual([]);
    const currentSessions = [{ ...sessions[0], id: 'account-b-session' }];
    await act(async () => { current.resolve({ sessions: currentSessions }); });
    expect(hook.result.current.sessions).toEqual(currentSessions);
    const signal = read.mock.calls[1][1]!.signal!;
    hook.unmount(); expect(signal.aborted).toBe(true);
  });

  it('reports an initial failure rather than inventing zero sessions', async () => {
    read.mockRejectedValueOnce(new Error('Calendar unavailable'));
    const hook = renderHook(() => useDeliverySessions('account-a'));
    await waitFor(() => expect(hook.result.current.error).toBe('Calendar unavailable'));
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.undatedSessionCount).toBeUndefined();
  });

  it('refreshes the undated count on the existing read and accepts an older payload', async () => {
    const hook = renderHook(() => useDeliverySessions('account-a'));
    await waitFor(() => expect(hook.result.current.undatedSessionCount).toBe(2));
    read.mockResolvedValueOnce({ sessions, undatedSessionCount: 0 });
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.undatedSessionCount).toBe(0));
    read.mockResolvedValueOnce({ sessions });
    act(() => hook.result.current.reload());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(hook.result.current.undatedSessionCount).toBeUndefined());
    expect(hook.result.current.sessions).toEqual(sessions);
  });
});
