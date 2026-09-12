import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '@/api/cachedRequest';
import { fetchLearnerDetail, invalidateLearnerDetailCache, type LearnerDetail } from '@/api/learnerDetail';
import { fetchStudentActivity } from '@/api/studentActivity';
import { useLearnerDetailParam } from '../useLearnerDetailParam';
import { usePrefetchStudentActivity } from '../usePrefetchStudentActivity';

const learner = { id: '125', name: 'Learner', studentActivityAvailable: true, components: [] } as unknown as LearnerDetail;
const reply = (data: unknown) => new Response(JSON.stringify(data));
let now = 1_000_000;

beforeEach(() => {
  clearAllCachedResources();
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('learner navigation with the real request cache', () => {
  it('shows the prior plan immediately after expiry while a single refresh is in flight', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(reply(learner))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await fetchLearnerDetail('commercial', '125');
    now += 31_000;
    const frames: boolean[] = [];
    const { result } = renderHook(() => {
      const data = useLearnerDetailParam('commercial', '125');
      frames.push(data.loading);
      return data;
    });
    const other = renderHook(() => useLearnerDetailParam('commercial', '125'));
    expect(frames.every(loading => !loading)).toBe(true);
    expect(result.current.real?.name).toBe('Learner');
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => finish(reply({ ...learner, name: 'Updated learner' })));
    expect(result.current.real?.name).toBe('Updated learner');
    expect(other.result.current.real?.name).toBe('Updated learner');
    expect(frames.every(loading => !loading)).toBe(true);
  });

  it.each(['expired', 'invalidated', 'different learner'] as const)('does not show a snapshot that is %s', async reason => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(learner));
    await fetchLearnerDetail('commercial', '125');
    if (reason === 'expired') now += 331_000;
    if (reason === 'invalidated') invalidateLearnerDetailCache('commercial', '125');
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const id = reason === 'different learner' ? '132' : '125';
    const { result } = renderHook(() => useLearnerDetailParam('commercial', id));
    expect(result.current.real).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => finish(reply({ ...learner, id })));
    expect(result.current.real?.id).toBe(id);
  });

  it('starts activity before the slow plan resolves and shares it with the page', async () => {
    let finishPlan!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(url => {
      const path = String(url);
      if (path.includes('/learner-summary/')) return Promise.resolve(reply(learner));
      if (path.includes('/student-activity/')) return Promise.resolve(reply({ activities: [], subjects: [] }));
      if (path.includes('/learner-detail/')) return new Promise(resolve => { finishPlan = resolve; });
      throw new Error(`Unexpected read: ${path}`);
    });
    const { result } = renderHook(() => {
      usePrefetchStudentActivity('commercial', '125');
      return useLearnerDetailParam('commercial', '125');
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(result.current.loading).toBe(true);
    await fetchStudentActivity('commercial', '125');
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => finishPlan(reply(learner)));
    expect(result.current.loading).toBe(false);
  });

  it('does not prefetch unavailable history', async () => {
    vi.mocked(fetch).mockResolvedValue(reply({ ...learner, studentActivityAvailable: false }));
    renderHook(() => usePrefetchStudentActivity('commercial', '125'));
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/learner-summary/');
  });
});
