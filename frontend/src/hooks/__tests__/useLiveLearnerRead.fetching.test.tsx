import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLiveLearnerRead } from '../useLiveLearnerRead';

const listeners = vi.hoisted(() => new Set<() => void>());
vi.mock('@/api/learnerRead', () => ({ subscribeLearnerReadInvalidation: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } }));
afterEach(() => { cleanup(); listeners.clear(); });
function deferred() {
  let resolve!: (value: number) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<number>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const peek = () => undefined;
function setup() {
  const requests: ReturnType<typeof deferred>[] = [];
  const read = vi.fn(() => { const request = deferred(); requests.push(request); return request.promise; });
  const hook = renderHook(({ id, active }) => useLiveLearnerRead('commercial', id, true, read, peek, active), { initialProps: { id: 'one', active: true } });
  return { ...hook, requests, read };
}
describe('current learner fetching lifecycle', () => {
  it('initial, success, manual refresh, failure and retry retain the loading contract', async () => {
    const { result, requests, read } = setup();
    expect(result.current).toMatchObject({ isFetching: true, loading: true, data: null });
    await act(async () => requests[0].resolve(120));
    expect(result.current).toMatchObject({ isFetching: false, loading: false, data: 120 });
    act(() => result.current.refresh());
    expect(result.current).toMatchObject({ isFetching: true, loading: false, data: 120 });
    await act(async () => requests[1].reject(new Error('offline')));
    expect(result.current).toMatchObject({ isFetching: false, loading: false, data: 120, error: 'offline' });
    act(() => result.current.refresh());
    expect(result.current.isFetching).toBe(true);
    await act(async () => requests[2].resolve(125));
    expect(result.current).toMatchObject({ isFetching: false, data: 125, error: '' });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('invalidation supersedes pending work and old completion cannot clear the current request', async () => {
    const { result, requests } = setup();
    act(() => listeners.forEach(fn => fn()));
    await act(async () => requests[0].resolve(999));
    expect(result.current).toMatchObject({ isFetching: true, data: null });
    await act(async () => requests[1].resolve(120));
    expect(result.current).toMatchObject({ isFetching: false, data: 120 });
    act(() => listeners.forEach(fn => fn()));
    expect(result.current).toMatchObject({ isFetching: true, loading: false, data: 120 });
    await act(async () => requests[2].resolve(121));
    expect(result.current.isFetching).toBe(false);
  });
  it('reactivation fetches while retaining its snapshot; cancelled work cannot clear the new fetch', async () => {
    const { result, requests, rerender } = setup();
    await act(async () => requests[0].resolve(120));
    rerender({ id: 'one', active: false });
    expect(result.current.isFetching).toBe(false);
    rerender({ id: 'one', active: true });
    expect(result.current).toMatchObject({ isFetching: true, loading: false, data: 120 });
    act(() => result.current.refresh());
    await act(async () => requests[1].resolve(999));
    expect(result.current.isFetching).toBe(true);
    await act(async () => requests[2].resolve(121));
    expect(result.current).toMatchObject({ isFetching: false, data: 121 });
  });
  it('a late previous learner response cannot publish data or finish the new learner request', async () => {
    const { result, requests, rerender } = setup();
    rerender({ id: 'two', active: true });
    await act(async () => requests[0].resolve(999));
    expect(result.current).toMatchObject({ isFetching: true, data: null });
    await act(async () => requests[1].resolve(120));
    expect(result.current).toMatchObject({ isFetching: false, data: 120 });
  });
  it('unmount on account change isolates pending work from the next account', async () => {
    const previous = setup(); previous.unmount();
    const current = setup();
    await act(async () => previous.requests[0].resolve(999));
    expect(current.result.current).toMatchObject({ isFetching: true, data: null });
    await act(async () => current.requests[0].resolve(120));
    expect(current.result.current).toMatchObject({ isFetching: false, data: 120 });
  });
});
