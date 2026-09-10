import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import * as api from '@/api/learnerDetail';
import { useLearnerDetailParam } from '../useLearnerDetailParam';

const first = { id: '125', name: 'First learner', components: [{ componentId: 'FIRST' }] } as LearnerDetail;
const second = { id: '132', name: 'Second learner', components: [{ componentId: 'SECOND' }] } as LearnerDetail;

describe('learner View identity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refreshes module views when returning from Builder and coalesces browser focus events', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const updated = { ...first, modules: ['New assignment'] };
    const fetch = vi.spyOn(api, 'fetchLearnerDetail').mockResolvedValueOnce(first).mockResolvedValue(updated);
    const { result, unmount } = renderHook(() => useLearnerDetailParam('commercial', '125', true));
    await waitFor(() => expect(result.current.real).toBe(first));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.real).toBe(updated));
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('hides the previous learner in every render while a new View is loading', async () => {
    let resolve!: (data: LearnerDetail) => void;
    vi.spyOn(api, 'fetchLearnerDetail').mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const renders: { requested: string; actual: string | undefined }[] = [];
    const { result, rerender } = renderHook(({ id }) => {
      const value = useLearnerDetailParam('commercial', id);
      renders.push({ requested: id, actual: value.real?.id });
      return value;
    }, { initialProps: { id: '125' } });
    await waitFor(() => expect(result.current.real).toBe(first));
    rerender({ id: '132' });
    expect(result.current.real).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(renders.some((r) => r.requested === '132' && r.actual === '125')).toBe(false);
    await act(async () => resolve(second));
    expect(result.current.real).toBe(second);
  });

  it('ignores late responses and errors from a previous learner', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(api, 'fetchLearnerDetail').mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }))
      .mockResolvedValueOnce(second);
    const { result, rerender } = renderHook(({ id }) => useLearnerDetailParam('commercial', id), { initialProps: { id: '125' } });
    rerender({ id: '132' });
    await waitFor(() => expect(result.current.real).toBe(second));
    await act(async () => reject(new Error('Old request failed')));
    expect(result.current.real).toBe(second);
    expect(result.current.loadError).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('keeps the same learner visible on refresh and invalidates only their cache', async () => {
    const invalidate = vi.spyOn(api, 'invalidateLearnerDetailCache');
    let resolve!: (data: LearnerDetail) => void;
    vi.spyOn(api, 'fetchLearnerDetail').mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useLearnerDetailParam('commercial', '125'));
    await waitFor(() => expect(result.current.real).toBe(first));
    act(() => result.current.refresh());
    expect(result.current.real).toBe(first);
    expect(result.current.loading).toBe(true);
    expect(invalidate).toHaveBeenCalledWith('commercial', '125');
    await act(async () => resolve({ ...first, name: 'Updated learner' }));
    expect(result.current.real?.name).toBe('Updated learner');
  });
});
