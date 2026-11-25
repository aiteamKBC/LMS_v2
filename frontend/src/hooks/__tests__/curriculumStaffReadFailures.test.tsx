import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchCurriculumOverview: vi.fn(), fetchCurriculumTutors: vi.fn(),
  fetchCurriculumCoaches: vi.fn(), fetchCurriculumHolidays: vi.fn(),
  fetchCurriculumTeamsMeetingSummaries: vi.fn(),
}));
vi.mock('@/lib/curriculumApi', () => api);
vi.mock('@/hooks/useRefreshOnReturn', () => ({ useLiveRefresh: vi.fn(), useRefreshOnReturn: vi.fn() }));
import { useCurriculumEntities } from '../useCurriculumEntities';
import { useCurriculumStaffProfiles } from '../useCurriculumStaffProfiles';

const overview = { programmes: [{ id: 'P' }], cohorts: [], groups: [{ id: 'G' }], modules: [] };
const tutors = [{ id: 'T', name: 'Synthetic Tutor' }];
const coaches = [{ id: 'C', name: 'Synthetic Coach' }];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset());
  api.fetchCurriculumOverview.mockResolvedValue(overview);
  api.fetchCurriculumTutors.mockResolvedValue(tutors);
  api.fetchCurriculumCoaches.mockResolvedValue(coaches);
  api.fetchCurriculumHolidays.mockResolvedValue([]);
  api.fetchCurriculumTeamsMeetingSummaries.mockImplementation(() => { throw new Error('Excluded from staff tests'); });
});

describe('staff reads alongside curriculum structure', () => {
  it('shows a first-load directory failure without discarding structure or the other role', async () => {
    api.fetchCurriculumTutors.mockRejectedValue(new Error('directory offline'));
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true }));
    await waitFor(() => expect(result.current.staffError).toContain('Unable to load tutors'));
    expect(result.current.error).toBe(result.current.staffError);
    expect(result.current.loaded).toBe(true);
    expect(result.current.groups).toEqual(overview.groups);
    expect(result.current.coaches).toEqual(coaches);
    expect(result.current.tutors).toEqual([]);
  });

  it('preserves the last successful failed role, updates the other role and clears errors on retry', async () => {
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true }));
    await waitFor(() => expect(result.current.tutors).toEqual(tutors));
    api.fetchCurriculumTutors.mockRejectedValue(new Error('offline'));
    api.fetchCurriculumCoaches.mockResolvedValue([{ id: 'NEW' }]);
    await act(async () => { await result.current.reload({ silent: true }); });
    expect(result.current.tutors).toEqual(tutors);
    expect(result.current.coaches).toEqual([{ id: 'NEW' }]);
    expect(result.current.error).toContain('out of date');
    api.fetchCurriculumTutors.mockResolvedValue([]);
    await act(async () => { await result.current.reload(); });
    expect(result.current.error).toBeNull();
    expect(result.current.tutors).toEqual([]);
  });

  it('renders structure before a pending directory and does not clear an existing warning prematurely', async () => {
    api.fetchCurriculumTutors.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true }));
    await waitFor(() => expect(result.current.staffError).not.toBeNull());
    const pending = deferred<typeof tutors>();
    api.fetchCurriculumTutors.mockReturnValue(pending.promise);
    let loading: ReturnType<typeof result.current.reload>;
    act(() => { loading = result.current.reload(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.programmes).toEqual(overview.programmes);
    expect(result.current.staffError).not.toBeNull();
    await act(async () => { pending.resolve(tutors); await loading; });
    expect(result.current.staffError).toBeNull();
  });

  it('does not report a tutor failure when only coaches were requested', async () => {
    api.fetchCurriculumTutors.mockRejectedValue(new Error('not requested'));
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true, includeTutors: false }));
    await waitFor(() => expect(result.current.coaches).toEqual(coaches));
    expect(api.fetchCurriculumTutors).not.toHaveBeenCalled();
    expect(result.current.staffError).toBeNull();
  });

  it('ignores stale directory failures after a newer successful load', async () => {
    const old = deferred<typeof tutors>();
    api.fetchCurriculumTutors.mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.reload(); });
    await act(async () => { old.reject(new Error('old failure')); });
    expect(result.current.tutors).toEqual(tutors);
    expect(result.current.staffError).toBeNull();
  });

  it('handles staff rejection even when the overview fails before staff settle', async () => {
    const pending = deferred<typeof tutors>();
    api.fetchCurriculumOverview.mockRejectedValue(new Error('structure unavailable'));
    api.fetchCurriculumTutors.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useCurriculumEntities({ includeStaff: true }));
    await waitFor(() => expect(result.current.error).toBe('structure unavailable'));
    await act(async () => { pending.reject(new Error('staff also unavailable')); });
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toBe('structure unavailable');
  });

  it('cancels the initial load without publishing a late staff error', async () => {
    const pending = deferred<typeof tutors>();
    api.fetchCurriculumTutors.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useCurriculumEntities({ includeStaff: true }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const signal = api.fetchCurriculumTutors.mock.calls[0][0] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.reject(new Error('late failure')); });
    expect(result.current.staffError).toBeNull();
  });
});

describe('staff profile picker reads', () => {
  it('retains a successful role and reports a failed role', async () => {
    api.fetchCurriculumCoaches.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCurriculumStaffProfiles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tutors).toEqual(tutors);
    expect(result.current.error).toContain('Unable to load coaches');
  });

  it('preserves previous options on failed refresh and accepts a genuine empty retry', async () => {
    const { result } = renderHook(() => useCurriculumStaffProfiles());
    await waitFor(() => expect(result.current.tutors).toEqual(tutors));
    api.fetchCurriculumTutors.mockRejectedValue(new Error('offline'));
    act(() => { result.current.reload(); });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.tutors).toEqual(tutors);
    api.fetchCurriculumTutors.mockResolvedValue([]);
    act(() => { result.current.reload(); });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.tutors).toEqual([]);
  });

  it('ignores an older request after a newer retry succeeds', async () => {
    const old = deferred<typeof tutors>();
    api.fetchCurriculumTutors.mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useCurriculumStaffProfiles());
    await waitFor(() => expect(api.fetchCurriculumTutors).toHaveBeenCalledOnce());
    act(() => { result.current.reload(); });
    await waitFor(() => expect(result.current.tutors).toEqual(tutors));
    await act(async () => { old.reject(new Error('old failure')); });
    expect(result.current.error).toBeNull();
    expect(result.current.tutors).toEqual(tutors);
  });

  it('respects autoLoad=false and the returned cleanup for a manual read', async () => {
    const pending = deferred<typeof tutors>();
    api.fetchCurriculumTutors.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useCurriculumStaffProfiles({ autoLoad: false }));
    expect(api.fetchCurriculumTutors).not.toHaveBeenCalled();
    let cancel!: () => void;
    act(() => { cancel = result.current.reload(); });
    cancel();
    await act(async () => { pending.reject(new Error('cancelled')); });
    expect(result.current.error).toBeNull();
    expect(result.current.tutors).toEqual([]);
  });
});
