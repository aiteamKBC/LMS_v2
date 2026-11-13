import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurriculumSessions, type CurriculumSession } from '@/lib/curriculumApi';
import { useDeliverySessions } from '../useDeliverySessions';

const refresh = vi.hoisted(() => ({ callback: () => {}, enabled: false }));
vi.mock('@/lib/curriculumApi', () => ({ fetchCurriculumSessions: vi.fn() }));
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: (callback: () => void, options: { enabled: boolean }) => {
  refresh.callback = callback; refresh.enabled = options.enabled;
} }));
const fetchSessions = vi.mocked(fetchCurriculumSessions);
const sessions = [{ id: 's1', type: 'Live Session', date: '2026-11-13' }] as CurriculumSession[];
const deferred = () => {
  let resolve!: (value: CurriculumSession[]) => void;
  const promise = new Promise<CurriculumSession[]>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => { fetchSessions.mockReset().mockResolvedValue(sessions); });
afterEach(cleanup);

describe('Delivery calendar request lifecycle', () => {
  it('waits for the overview, reads once, and does not reload for chart rerenders', async () => {
    const hook = renderHook(({ enabled }) => useDeliverySessions(enabled, 'account-a'), { initialProps: { enabled: false } });
    expect(fetchSessions).not.toHaveBeenCalled();
    expect(hook.result.current.loading).toBe(true);
    expect(refresh.enabled).toBe(false);
    hook.rerender({ enabled: true });
    await waitFor(() => expect(hook.result.current.sessions).toEqual(sessions));
    hook.rerender({ enabled: true });
    expect(fetchSessions).toHaveBeenCalledTimes(1);
    expect(fetchSessions).toHaveBeenCalledWith(expect.any(AbortSignal), { revalidate: false });
  });

  it('preserves known dates on a background failure without forcing a server rebuild', async () => {
    const hook = renderHook(() => useDeliverySessions(true, 'account-a'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    fetchSessions.mockRejectedValueOnce(new Error('Calendar unavailable'));
    act(() => refresh.callback());
    await waitFor(() => expect(hook.result.current.error).toBe('Calendar unavailable'));
    expect(hook.result.current.sessions).toEqual(sessions);
    expect(fetchSessions).toHaveBeenLastCalledWith(expect.any(AbortSignal), { revalidate: true });
  });

  it('ignores late results from the previous account or after unmount', async () => {
    const old = deferred(); const current = deferred();
    fetchSessions.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const hook = renderHook(({ scope }) => useDeliverySessions(true, scope), { initialProps: { scope: 'account-a' } });
    const oldSignal = fetchSessions.mock.calls[0][0]!;
    hook.rerender({ scope: 'account-b' });
    expect(oldSignal.aborted).toBe(true);
    expect(hook.result.current.sessions).toEqual([]);
    await act(async () => { old.resolve(sessions); });
    expect(hook.result.current.sessions).toEqual([]);
    const currentSessions = [{ ...sessions[0], id: 'account-b-session' }];
    await act(async () => { current.resolve(currentSessions); });
    expect(hook.result.current.sessions).toEqual(currentSessions);
    const signal = fetchSessions.mock.calls[1][0]!;
    hook.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('reports an initial failure rather than inventing empty calendar success', async () => {
    fetchSessions.mockRejectedValueOnce(new Error('Calendar unavailable'));
    const hook = renderHook(() => useDeliverySessions(true, 'account-a'));
    await waitFor(() => expect(hook.result.current.error).toBe('Calendar unavailable'));
    expect(hook.result.current.loading).toBe(false);
  });
});
