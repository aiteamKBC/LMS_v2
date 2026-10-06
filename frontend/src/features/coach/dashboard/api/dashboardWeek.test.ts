import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { dashboardBusinessDate, dashboardWorkWeek, millisecondsUntilBusinessMidnight, useDashboardBusinessDate } from './dashboardWeek';
import { dashboardMeetingsQuery } from './dashboardMeetings';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('uses the London date when UTC/device dates differ and advances weeks dynamically', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T23:00:00Z'));
  expect(dashboardBusinessDate()).toBe('2026-10-05');
  expect(dashboardWorkWeek().start.getDate()).toBe(5);
  expect(dashboardMeetingsQuery()).toBe('?from=2026-10-12&to=2026-10-16');
  vi.setSystemTime(new Date('2026-10-11T23:00:00Z'));
  expect(dashboardWorkWeek().start.getDate()).toBe(12);
  expect(dashboardMeetingsQuery()).toBe('?from=2026-10-19&to=2026-10-23');
});

it('refreshes an already mounted page at the business-week boundary without interaction', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T22:59:59Z'));
  const { result } = renderHook(useDashboardBusinessDate);
  expect(result.current).toBe('2026-10-04');
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe('2026-10-05');
});

it('schedules midnight correctly across both daylight saving transitions', () => {
  expect(millisecondsUntilBusinessMidnight(new Date('2026-03-29T00:00:00Z'))).toBe(23 * 60 * 60 * 1000);
  expect(millisecondsUntilBusinessMidnight(new Date('2026-10-24T23:00:00Z'))).toBe(25 * 60 * 60 * 1000);
});

it('refreshes on returning to a suspended tab', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  const { result } = renderHook(useDashboardBusinessDate);
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(result.current).toBe('2026-10-12');
});
