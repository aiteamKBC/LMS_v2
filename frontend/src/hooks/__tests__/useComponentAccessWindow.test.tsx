import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readLearnerJson } from '@/api/learnerRead';
import { useComponentAccessWindow } from '../useComponentAccessWindow';

vi.mock('@/api/learnerRead', () => ({ readLearnerJson: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('loads both-source ranges and identifies a holiday without closing the content', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-25T12:00:00Z'));
  vi.mocked(readLearnerJson).mockResolvedValue({ holidays: [{ start: '2026-12-25', end: '2026-12-31' }] });
  const { result } = renderHook(() => useComponentAccessWindow());
  await waitFor(() => expect(result.current.holidayCalendarReady).toBe(true));
  expect(result.current).toMatchObject({ open: true, outsideWorkingHours: true, outsideReason: 'holiday' });
});

it('surfaces failures and recovers on retry', async () => {
  vi.mocked(readLearnerJson).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ holidays: [] });
  const { result } = renderHook(() => useComponentAccessWindow());
  await waitFor(() => expect(result.current.holidayError).toContain('Retry'));
  expect(result.current.holidayCalendarReady).toBe(false);
  act(() => result.current.refreshHolidays?.());
  await waitFor(() => expect(result.current.holidayCalendarReady).toBe(true));
  expect(result.current.holidayError).toBe('');
});
