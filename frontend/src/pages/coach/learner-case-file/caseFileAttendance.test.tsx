import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchLearnerAttendance: vi.fn() }));

vi.mock('@/api/learnerAttendance', () => ({ fetchLearnerAttendance: mocks.fetchLearnerAttendance }));

import { useCaseFileAttendance } from './useCaseFileAttendance';

const attendance = {
  learnerEmail: 'learner@example.test', learnerId: 5170, learnerName: 'Learner',
  sessions: 4, present: 3, absent: 1, late: 1, catchup: 0, risk: 'green',
  lastSessionDate: '2026-09-20', consecutiveMissed: 0, updatedAt: null,
  attendanceRate: 75, source: 'combined' as const,
  sessionHistory: [
    { id: 'session-1', date: '2026-09-20', title: 'Session 1', sessionType: 'Live', status: 'attended' as const, startTime: '09:00', endTime: '10:00', module: 'Module 1', coach: 'Coach' },
  ],
};

describe('Case File canonical attendance cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLearnerAttendance.mockResolvedValue(attendance);
  });

  it.each(['apprenticeship', 'commercial'] as const)('loads the canonical %s learner summary and history once', async kind => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCaseFileAttendance(kind, '5170', enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ enabled: true });

    expect(result.current.data).toEqual(attendance);
    expect(mocks.fetchLearnerAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.fetchLearnerAttendance).toHaveBeenCalledWith(kind, '5170', expect.any(AbortSignal), false);
  });

  it('keeps missing attendance unavailable instead of manufacturing zeroes', async () => {
    mocks.fetchLearnerAttendance.mockResolvedValue(null);
    const { result } = renderHook(() => useCaseFileAttendance('apprenticeship', '5170', true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('isolates a failure and refetches only after explicit retry', async () => {
    mocks.fetchLearnerAttendance.mockRejectedValueOnce(new Error('Attendance unavailable')).mockResolvedValueOnce(attendance);
    const { result } = renderHook(() => useCaseFileAttendance('apprenticeship', '5170', true));
    await waitFor(() => expect(result.current.error).toBe('Attendance unavailable'));
    expect(mocks.fetchLearnerAttendance).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toEqual(attendance));
    expect(mocks.fetchLearnerAttendance).toHaveBeenCalledTimes(2);
    expect(mocks.fetchLearnerAttendance.mock.calls[1][3]).toBe(true);
  });
});
