import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveRefresh, useRefreshOnRemoteWrite, useRefreshOnReturn } from '@/hooks/useRefreshOnReturn';

/**
 * The hook side of the same bug: a page that read once on mount has to notice
 * when the reader comes back to the tab, and when somebody else writes, without
 * doing either so eagerly that alt-tabbing costs a rebuild.
 *
 * curriculumApi is stubbed here so these stay tests of the hook rather than of
 * the request layer, which has its own file.
 */

const remoteListeners = new Set<(path: string) => void>();
const UNKNOWN = '*';

vi.mock('@/lib/curriculumApi', () => ({
  UNKNOWN_WRITE_PATH: '*',
  subscribeCurriculumRemoteWrites: (listener: (path: string) => void) => {
    remoteListeners.add(listener);
    return () => { remoteListeners.delete(listener); };
  },
}));

function remoteWrite(path: string) {
  remoteListeners.forEach(listener => listener(path));
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('useRefreshOnReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    remoteListeners.clear();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('re-reads when the reader comes back to the tab', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));

    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the tab becomes visible and when the connection returns', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));

    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    vi.advanceTimersByTime(1_100);
    act(() => { window.dispatchEvent(new Event('online')); });

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('reads once for the burst of events one alt-tab produces', () => {
    // Returning to a tab fires focus and visibilitychange together. Reading
    // twice for one glance is a wasted rebuild.
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));

    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads again once the throttle window has passed', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));

    act(() => { window.dispatchEvent(new Event('focus')); });
    vi.advanceTimersByTime(1_100);
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not read while the tab is hidden', () => {
    // visibilitychange fires on the way out as well as the way back.
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));
    setVisibility('hidden');

    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('binds nothing while the page has nothing to refresh', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh, { enabled: false }));

    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('calls the current refresh, not the one from the first render', () => {
    // The callback is a new closure every render; binding the first one would
    // refresh with the props the page had when it mounted.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ refresh }) => useRefreshOnReturn(refresh), {
      initialProps: { refresh: first },
    });

    rerender({ refresh: second });
    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the page is gone', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useRefreshOnReturn(refresh));
    unmount();

    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('useRefreshOnRemoteWrite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    remoteListeners.clear();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('re-reads after somebody else writes', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnRemoteWrite(refresh));

    act(() => { remoteWrite('/curriculum/programmes/p1/'); });
    expect(refresh).not.toHaveBeenCalled(); // debounced, not dropped

    act(() => { vi.advanceTimersByTime(300); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads once for a save that writes several times', () => {
    // Saving a programme tree is many calls; the page wants one refresh.
    const refresh = vi.fn();
    renderHook(() => useRefreshOnRemoteWrite(refresh));

    act(() => {
      remoteWrite('/curriculum/programmes/p1/');
      remoteWrite('/curriculum/cohorts/c1/');
      remoteWrite('/curriculum/groups/g1/');
    });
    act(() => { vi.advanceTimersByTime(300); });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores a write to something this page does not show', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnRemoteWrite(refresh, {
      match: path => path.includes('/ksb-'),
    }));

    act(() => { remoteWrite('/curriculum/programmes/p1/'); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('honours the filter when the path does match', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnRemoteWrite(refresh, {
      match: path => path.includes('/ksb-'),
    }));

    act(() => { remoteWrite('/curriculum/ksb-sets/1/'); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('lets a write from another machine through a path filter', () => {
    // The epoch poll knows that something changed, never what. A page that
    // filters on paths has nothing to match on and must not filter it out.
    const refresh = vi.fn();
    renderHook(() => useRefreshOnRemoteWrite(refresh, {
      match: path => path.includes('/ksb-'),
    }));

    act(() => { remoteWrite(UNKNOWN); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not read while the tab is hidden', () => {
    // The return listener covers it the moment the reader looks again; reading
    // now would spend a rebuild on a screen nobody is watching.
    const refresh = vi.fn();
    renderHook(() => useRefreshOnRemoteWrite(refresh));
    setVisibility('hidden');

    act(() => { remoteWrite('/curriculum/programmes/p1/'); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not subscribe while disabled', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnRemoteWrite(refresh, { enabled: false }));

    expect(remoteListeners.size).toBe(0);
    act(() => { remoteWrite('/curriculum/programmes/p1/'); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('unsubscribes and drops a pending read when the page goes', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useRefreshOnRemoteWrite(refresh));

    act(() => { remoteWrite('/curriculum/programmes/p1/'); });
    unmount();
    act(() => { vi.advanceTimersByTime(300); });

    expect(remoteListeners.size).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('useLiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    remoteListeners.clear();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('covers both the reader coming back and somebody else writing', () => {
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh));

    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => { remoteWrite('/curriculum/programmes/p1/'); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('turns both triggers off together', () => {
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh, { enabled: false }));

    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { remoteWrite('/curriculum/programmes/p1/'); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(refresh).not.toHaveBeenCalled();
    expect(remoteListeners.size).toBe(0);
  });
});
