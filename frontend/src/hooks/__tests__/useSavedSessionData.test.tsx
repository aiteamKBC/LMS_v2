import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSavedSessionData } from '../useSavedSessionData';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('saved session refresh', () => {
  it('discovers new saved results while retaining data and suppressing overlapping reads', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let finish!: (value: number) => void;
    const load = vi.fn().mockResolvedValueOnce(1).mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useSavedSessionData<number>(load));
    await tick();
    expect(result.current.data).toBe(1);
    await tick(30_000);
    expect(result.current.data).toBe(1);
    expect(result.current.loading).toBe(false);
    act(() => { result.current.refresh(); window.dispatchEvent(new Event('focus')); });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => finish(2));
    expect(result.current.data).toBe(2);
  });

  it('pauses in a hidden tab, refreshes on return and keeps saved data on failure', async () => {
    vi.useFakeTimers();
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const load = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('Temporarily unavailable'));
    const { result } = renderHook(() => useSavedSessionData<number>(load));
    await tick(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    visible.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(1);
    expect(result.current.error).toBe('Temporarily unavailable');
  });

  it('aborts previous identity reads and ignores late responses after navigation', async () => {
    vi.useFakeTimers();
    let finish!: (value: number) => void;
    const first = vi.fn((_signal: AbortSignal) => new Promise<number>(resolve => { finish = resolve; }));
    const second = vi.fn().mockResolvedValue(2);
    const { result, rerender, unmount } = renderHook(({ load }) => useSavedSessionData<number>(load), { initialProps: { load: first } });
    rerender({ load: second });
    await tick();
    expect(first.mock.calls[0][0].aborted).toBe(true);
    await act(async () => finish(1));
    expect(result.current.data).toBe(2);
    unmount();
    await tick(60_000);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
