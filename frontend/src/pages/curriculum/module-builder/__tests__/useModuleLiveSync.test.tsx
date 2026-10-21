import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The open Module Builder hears about a colleague's save of this module within
 * a couple of seconds -- and does nothing at all while the server has live sync
 * switched off, which is how production starts.
 */

const readModuleLiveState = vi.fn();
vi.mock('../moduleAuthoringData', () => ({
  readModuleLiveState: (...args: unknown[]) => readModuleLiveState(...args),
}));

const crossTab: Array<(write: { scope: string; path: string; at: number }) => void> = [];
vi.mock('@/lib/crossTabWrites', () => ({
  publishCrossTabWrite: vi.fn(),
  subscribeCrossTabWrites: (listener: (write: { scope: string; path: string; at: number }) => void) => {
    crossTab.push(listener);
    return () => { crossTab.splice(crossTab.indexOf(listener), 1); };
  },
}));

import { useModuleLiveSync } from '../useModuleLiveSync';

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  readModuleLiveState.mockReset();
  crossTab.length = 0;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useModuleLiveSync', () => {
  it('stops after one question when the server has live sync off', async () => {
    readModuleLiveState.mockResolvedValue({ enabled: false });
    const onChange = vi.fn();
    renderHook(() => useModuleLiveSync({ moduleId: 'MOD-1', groupId: 'G-1', enabled: true, onChange }));
    await flush(0);
    await flush(30_000);
    expect(readModuleLiveState).toHaveBeenCalledTimes(1);
    expect(readModuleLiveState).toHaveBeenCalledWith(['module:MOD-1', 'group:G-1']);
    // And a same-browser announcement does nothing either.
    crossTab.forEach(listener => listener({ scope: 'module-live', path: 'module:MOD-1', at: 0 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a moved module counter once, not the first read', async () => {
    readModuleLiveState
      .mockResolvedValueOnce({ enabled: true, epochs: { 'module:MOD-1': 4 }, epoch: 100, pollMs: 2000 })
      .mockResolvedValueOnce({ enabled: true, epochs: { 'module:MOD-1': 4 }, epoch: 101, pollMs: 2000 })
      .mockResolvedValueOnce({ enabled: true, epochs: { 'module:MOD-1': 5 }, epoch: 102, pollMs: 2000 })
      .mockResolvedValue({ enabled: true, epochs: { 'module:MOD-1': 5 }, epoch: 102, pollMs: 2000 });
    const onChange = vi.fn();
    renderHook(() => useModuleLiveSync({ moduleId: 'MOD-1', enabled: true, onChange }));
    await flush(0);
    expect(onChange).not.toHaveBeenCalled();
    await flush(2000);
    // The estate moved, this module did not: nothing (the backstop waits a minute).
    expect(onChange).not.toHaveBeenCalled();
    await flush(2000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('scope');
    await flush(6000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to the estate counter at most once a minute', async () => {
    let epoch = 100;
    readModuleLiveState.mockImplementation(async () => ({ enabled: true, epochs: { 'module:MOD-1': 1 }, epoch: epoch++, pollMs: 2000 }));
    const onChange = vi.fn();
    renderHook(() => useModuleLiveSync({ moduleId: 'MOD-1', enabled: true, onChange }));
    await flush(0);
    await flush(58_000);
    expect(onChange).not.toHaveBeenCalled();
    await flush(4_000);
    expect(onChange).toHaveBeenCalledWith('backstop');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not poll a hidden tab, and asks at once when it comes back', async () => {
    readModuleLiveState.mockResolvedValue({ enabled: true, epochs: {}, epoch: 1, pollMs: 2000 });
    renderHook(() => useModuleLiveSync({ moduleId: 'MOD-1', enabled: true, onChange: vi.fn() }));
    await flush(0);
    expect(readModuleLiveState).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await flush(20_000);
    expect(readModuleLiveState).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush(0);
    expect(readModuleLiveState).toHaveBeenCalledTimes(2);
  });

  it('hears another tab of this browser at once, for this module only', async () => {
    readModuleLiveState.mockResolvedValue({ enabled: true, epochs: {}, epoch: 1, pollMs: 2000 });
    const onChange = vi.fn();
    renderHook(() => useModuleLiveSync({ moduleId: 'MOD-1', enabled: true, onChange }));
    await flush(0);
    crossTab.forEach(listener => listener({ scope: 'module-live', path: 'module:MOD-2', at: 0 }));
    expect(onChange).not.toHaveBeenCalled();
    crossTab.forEach(listener => listener({ scope: 'module-live', path: 'module:MOD-1', at: 0 }));
    expect(onChange).toHaveBeenCalledWith('tab');
  });

  it('backs off after errors instead of hammering the server', async () => {
    readModuleLiveState.mockRejectedValue(new Error('offline'));
    renderHook(() => useModuleLiveSync({ moduleId: 'MOD-1', enabled: true, onChange: vi.fn() }));
    await flush(0);
    await flush(10_000);
    // 0s, then 4s, then 8s later: three asks in ten seconds, not five.
    expect(readModuleLiveState.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('asks nothing for no module', async () => {
    renderHook(() => useModuleLiveSync({ moduleId: '', enabled: true, onChange: vi.fn() }));
    await flush(10_000);
    expect(readModuleLiveState).not.toHaveBeenCalled();
  });
});
