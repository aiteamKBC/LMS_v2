import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAssignmentTimer } from './useAssignmentTimer';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T10:00:00Z')); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('counts background-tab wall time and excludes paused and overnight absence', () => {
  const view = renderHook(() => useAssignmentTimer('assignment:one'));
  act(() => view.result.current.restore(0, true));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => { vi.setSystemTime(new Date('2026-10-02T10:02:00Z')); vi.advanceTimersByTime(1000); });
  expect(view.result.current.elapsed).toBe(121);
  act(() => view.result.current.pause());
  act(() => vi.advanceTimersByTime(60_000));
  expect(view.result.current.elapsed).toBe(121);
  view.unmount();
  vi.setSystemTime(new Date('2026-10-03T10:00:00Z'));
  const next = renderHook(() => useAssignmentTimer('assignment:one'));
  act(() => vi.advanceTimersByTime(2000)); // Loading must not overwrite stored time.
  act(() => next.result.current.restore(100, false));
  expect(next.result.current.elapsed).toBe(121);
  act(() => { next.result.current.resume(); vi.advanceTimersByTime(4000); });
  expect(next.result.current.elapsed).toBe(125);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

it('restores a server draft on another device and keeps another learner separate', () => {
  localStorage.setItem('assignment:other', '400');
  const view = renderHook(() => useAssignmentTimer('assignment:one'));
  act(() => view.result.current.restore(90, false));
  expect(view.result.current.elapsed).toBe(90);
  act(() => { view.result.current.resume(); vi.advanceTimersByTime(2000); });
  expect(view.result.current.elapsed).toBe(92);
  expect(localStorage.getItem('assignment:other')).toBe('400');
});
