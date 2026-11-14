import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewTutorAvailabilityRoster, type CurriculumTutorAvailabilityRoster } from '@/lib/curriculumApi';
import { useTutorAvailability } from '../useTutorAvailability';

vi.mock('@/lib/curriculumApi', () => ({ previewTutorAvailabilityRoster: vi.fn() }));

const busy: CurriculumTutorAvailabilityRoster = {
  results: [{ tutor: 'Tutor One', available: false, message: 'Already teaching', conflicts: [] }],
  sessionDates: ['2026-09-02'], bookable: true, startTime: '10:00', endTime: '12:00', availableCount: 0, busyCount: 1,
};

describe('tutor availability belongs to the current destination', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(previewTutorAvailabilityRoster).mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('never authorizes a busy-tutor override using the previous group preview', async () => {
    vi.mocked(previewTutorAvailabilityRoster).mockResolvedValueOnce(busy).mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ groupId }) => useTutorAvailability({ moduleCatalogueId: 'FREE-1', groupId }), {
      initialProps: { groupId: 'G1' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.verdictFor('Tutor One')?.available).toBe(false);
    rerender({ groupId: 'G2' });
    expect(result.current.verdictFor('Tutor One')).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(previewTutorAvailabilityRoster).toHaveBeenLastCalledWith({ moduleCatalogueId: 'FREE-1', groupId: 'G2' });
    expect(result.current.verdictFor('Tutor One')).toBeNull();
  });

  it('ignores a late answer from the previous destination and reports failed checks', async () => {
    let resolveOld!: (value: CurriculumTutorAvailabilityRoster) => void;
    vi.mocked(previewTutorAvailabilityRoster).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockRejectedValueOnce(new Error('Preview unavailable'));
    const { result, rerender } = renderHook(({ groupId }) => useTutorAvailability({ moduleCatalogueId: 'FREE-1', groupId }), {
      initialProps: { groupId: 'G1' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    rerender({ groupId: 'G2' });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); resolveOld(busy); });
    expect(result.current.failed).toBe(true);
    expect(result.current.verdictFor('Tutor One')).toBeNull();
    expect(result.current.bookable).toBe(false);
  });
});
