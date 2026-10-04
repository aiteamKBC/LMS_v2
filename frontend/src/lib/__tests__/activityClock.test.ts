import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startActivityClock } from '../activityClock';

describe('activity elapsed time', () => {
  let now: number;
  let visible: 'visible' | 'hidden';
  let clock: ReturnType<typeof startActivityClock> | undefined;
  const remainder = { milliseconds: 0 };
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0; visible = 'visible'; remainder.milliseconds = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  });
  afterEach(() => { clock?.stop(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const hide = () => { visible = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };
  const show = () => { visible = 'visible'; document.dispatchEvent(new Event('visibilitychange')); };

  it('flushes five minutes of background playback even if the interval never fires', () => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: true, onElapsed: elapsed, remainder });
    hide();
    now = 300000; // Simulate a throttled muted tab, without invoking a timer.
    clock.stop();
    expect(elapsed).toHaveBeenCalledExactlyOnceWith(300);
    show(); clock.stop();
    expect(elapsed).toHaveBeenCalledOnce();
  });

  it('keeps sub-second playback over pauses and excludes buffering gaps', () => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: true, onElapsed: elapsed, remainder });
    now = 700; clock.stop();
    now = 60000;
    clock = startActivityClock({ countInBackground: true, onElapsed: elapsed, remainder });
    now = 60300; clock.stop();
    expect(elapsed).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('counts visible reading time only, including the final partial interval', () => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: false, onElapsed: elapsed, remainder });
    now = 2200; hide();
    now = 122200; show();
    now = 125000; clock.stop();
    expect(elapsed.mock.calls.flat().reduce((sum, n) => sum + n, 0)).toBe(5);
  });

  it('excludes time away from a page restored from browser cache', () => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: true, onElapsed: elapsed, remainder });
    now = 10000; window.dispatchEvent(new Event('pagehide'));
    now = 86410000; window.dispatchEvent(new Event('pageshow'));
    now += 5000; clock.stop();
    expect(elapsed.mock.calls.flat().reduce((sum, n) => sum + n, 0)).toBe(15);
  });

  it('pauses reading at refresh start, before a delayed pagehide, and resumes without the loading gap', () => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: false, pauseOnUnload: true, onElapsed: elapsed, remainder });
    now = 31000;
    const refresh = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(refresh);
    expect(refresh.defaultPrevented).toBe(false);
    expect(elapsed).toHaveBeenCalledExactlyOnceWith(31);
    now = 61000;
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('pagehide'));
    clock.stop();
    expect(elapsed).toHaveBeenCalledOnce();
    // A new document loads the saved 31 seconds; only new visible study counts.
    now = 121000;
    clock = startActivityClock({ countInBackground: false, pauseOnUnload: true, onElapsed: elapsed, remainder });
    now = 123000;
    clock.stop();
    expect(elapsed.mock.calls.flat().reduce((sum, n) => sum + n, 0)).toBe(33);
  });

  it('resumes reading after a cancelled refresh without adding its waiting time', () => {
    const navigation = new EventTarget();
    vi.stubGlobal('navigation', navigation);
    try {
      const elapsed = vi.fn();
      clock = startActivityClock({ countInBackground: false, pauseOnUnload: true, onElapsed: elapsed, remainder });
      now = 31000;
      window.dispatchEvent(new Event('beforeunload'));
      now = 61000;
      navigation.dispatchEvent(new Event('navigateerror'));
      now = 63000;
      clock.stop();
      expect(elapsed.mock.calls.flat().reduce((sum, n) => sum + n, 0)).toBe(33);
      // A late navigation event must not reactivate a disposed clock.
      now = 90000;
      navigation.dispatchEvent(new Event('navigateerror'));
      window.dispatchEvent(new Event('beforeunload'));
      clock.stop();
      expect(elapsed).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['pointerdown', 'keydown'])('resumes reading on %s if a cancelled toolbar refresh has no navigation error event', eventType => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: false, pauseOnUnload: true, onElapsed: elapsed, remainder });
    now = 31000;
    window.dispatchEvent(new Event('beforeunload'));
    now = 61000;
    document.dispatchEvent(new Event(eventType));
    now = 63000;
    clock.stop();
    expect(elapsed.mock.calls.flat().reduce((sum, n) => sum + n, 0)).toBe(33);
  });

  it('keeps media playback counting until it actually stops during navigation', () => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: true, onElapsed: elapsed, remainder });
    now = 1000;
    window.dispatchEvent(new Event('beforeunload'));
    now = 3000;
    clock.stop();
    expect(elapsed).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('does not add wall clock changes to the measured time', () => {
    const elapsed = vi.fn();
    clock = startActivityClock({ countInBackground: true, onElapsed: elapsed, remainder });
    vi.setSystemTime(new Date('2030-01-01'));
    now = 1200; clock.stop();
    expect(elapsed).toHaveBeenCalledExactlyOnceWith(1);
  });
});
